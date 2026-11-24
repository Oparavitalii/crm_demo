// Long-running worker process — runs as Fly.io `cron` machine (see fly.toml
// `[processes]`). Single replica, no advisory lock required for cross-machine
// concurrency. In-process overlap is guarded explicitly by `runOnce` below.
//
// Why setInterval instead of node-cron: every job in this scheduler runs on a
// fixed daily cadence — there's no need for cron-string parsing. Plain
// setInterval keeps the dep-graph one library smaller and the timing rules
// trivial to reason about.
import { env } from '../env';
import { logger } from '../lib/logger';
import { startResourceMonitor } from '../lib/resource-monitor';
import { runRetention } from './retention';

const DAY_MS = 24 * 60 * 60 * 1000;

// In-process overlap guard. If a tick exceeds its interval the next tick is
// skipped rather than running concurrently — concurrent ticks against the same
// retention windows would race and produce duplicate audit rows.
const running = new Map<string, boolean>();

async function runOnce(jobName: string, fn: () => Promise<void>): Promise<void> {
  if (running.get(jobName)) {
    logger.warn({ jobName }, 'cron_skip_overlap');
    return;
  }
  running.set(jobName, true);
  const startedAt = Date.now();
  try {
    await fn();
    logger.info({ jobName, durationMs: Date.now() - startedAt }, 'cron_job_completed');
  } catch (err) {
    // Final safety net — the job is expected to handle its own errors but if
    // something escapes we log here so the scheduler stays alive.
    logger.error({ err, jobName, durationMs: Date.now() - startedAt }, 'cron_job_threw');
  } finally {
    running.set(jobName, false);
  }
}

logger.info({ env: env.NODE_ENV }, 'cron_scheduler_starting');

// Retention sweep — every 24h. RODO-driven: stale sessions, expired reset
// tokens, audit log > 5y, candidates inactive > 3y. First tick fires 60s after
// boot so a freshly-restarted machine doesn't hit Neon while still warming up.
//
// IMPORTANT: do NOT .unref() these timers. Since keep-warm was removed they are
// the ONLY thing keeping the event loop alive in this worker — without an active
// handle Node exits immediately after the initial logger.info call (signal
// listeners don't count as keep-alive). Graceful shutdown still works via the
// SIGTERM handler below, which calls process.exit() explicitly.
setTimeout(() => {
  void runOnce('retention', runRetention);
  setInterval(() => {
    void runOnce('retention', runRetention);
  }, DAY_MS);
}, 60_000);

// Public demo only: seed once shortly after boot (no-op when the data is
// already there), then rebuild the demo database every night at 03:00 UTC so
// whatever visitors changed during the day is gone by morning. Loaded lazily —
// a real deployment never pulls the demo module into memory.
if (env.DEMO_MODE) {
  const demoJob = (name: string, mode: 'seed' | 'reset') =>
    runOnce(name, async () => {
      const summary =
        mode === 'seed'
          ? await (await import('../demo/seed')).seedDemo()
          : await (await import('../demo/reset')).resetDemo();
      logger.info({ jobName: name, ...summary }, 'demo_job_done');
    });
  const msUntilNext3amUtc = () => {
    const next = new Date();
    next.setUTCHours(3, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - Date.now();
  };
  setTimeout(() => void demoJob('demo_seed', 'seed'), 30_000);
  setTimeout(() => {
    void demoJob('demo_reset', 'reset');
    setInterval(() => void demoJob('demo_reset', 'reset'), DAY_MS);
  }, msUntilNext3amUtc());
}

// A Neon keep-warm job used to live here, pinging `select 1` every 4 minutes.
// Removed 2026-07-25 after finally measuring the thing it defended against.
//
// Against a genuinely SUSPENDED compute, a request that had to wake Neon took
// 507ms end-to-end and the next one 193ms — so the wake costs ~300ms, not the
// 10-20s the surrounding code had assumed for months. Holding the compute up to
// avoid a third of a second on the first request after a lull cost ~197 CU-hrs
// per month (the compute had not scaled to zero once in 25 days).
//
// What still smooths the edges, at zero standing cost: LoginPage.tsx fires
// /health/ready while the user types their credentials, and index.ts warms the
// pool once at boot. If cold starts ever do become a complaint, track last
// request time in the app machines' memory and ping from there — never poll the
// database to find out whether the database is busy, which is the trap that made
// the previous two attempts at this job useless.

// Same telemetry as the API machines. The cron worker runs the identical
// image on an identically-sized VM and its memory has never been measured
// once — it is exactly the kind of long-lived process that produced the
// 2026-07-28 wedge on the app side.
startResourceMonitor();

logger.info('cron_scheduler_started');

// Last-line-of-defense handlers — without these a stray rejection kills the
// worker silently and Fly restarts with no log of the cause.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'cron_unhandled_rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'cron_uncaught_exception');
  // A cron in a poisoned state is more dangerous than a clean restart.
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'cron_scheduler_shutting_down');
    // Give in-flight ticks up to 30s to settle.
    setTimeout(() => process.exit(0), 30_000).unref();
  });
}
