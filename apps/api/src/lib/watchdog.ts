import { monitorEventLoopDelay } from 'node:perf_hooks';
import { logger } from './logger';

interface WatchdogOptions {
  intervalMs?: number;
  lagThresholdMs?: number;
  strikes?: number;
  // Injected by tests; production reads the perf_hooks histogram.
  readLagMs?: () => number;
  // Injected by tests; production exits so Fly's restart policy takes over.
  onTrip?: () => void;
}

const NS_PER_MS = 1e6;
const MB = 1024 * 1024;

const DEFAULTS = {
  intervalMs: 10_000,
  // Fly's health check times out at 5s (fly.toml http_service.checks). A loop
  // that cannot service a no-op route inside that window is, as far as the
  // proxy is concerned, dead.
  lagThresholdMs: 5_000,
  // Three consecutive strikes ≈ 30s — long enough that a legitimate burst
  // (an XLSX export, a bulk send, a pile of logins) cannot kill a healthy
  // machine.
  strikes: 3,
};

// On 2026-07-28 a production machine sat in state `started` for over ten
// minutes with a `critical` health check — `context deadline exceeded` on
// GET /health, a route that performs no I/O at all — while still receiving
// proxied traffic and answering none of it. Fly's http_service checks drop
// such a machine from routing but never restart it, and the process never
// crashed, so the machine's on-failure restart policy never fired.
//
// LIMITATION, deliberately not papered over: this runs on the event loop it
// watches. A *slow* loop (GC thrash, CPU oversubscribed, work queued behind
// long tasks) still reaches this callback and trips it. A loop that is
// *synchronously blocked* never reaches it, and the watchdog stays silent
// through exactly the outage it was meant to catch. Detecting that needs an
// observer outside the loop — a worker thread or a supervisor. This is not
// complete protection; it is the case we actually observed.
export function startWatchdog(opts: WatchdogOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULTS.intervalMs;
  const lagThresholdMs = opts.lagThresholdMs ?? DEFAULTS.lagThresholdMs;
  const maxStrikes = opts.strikes ?? DEFAULTS.strikes;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  const readLagMs = opts.readLagMs ?? (() => histogram.max / NS_PER_MS);
  const onTrip = opts.onTrip ?? (() => process.exit(1));

  let strikes = 0;

  const timer = setInterval(() => {
    const lagMs = readLagMs();
    histogram.reset();

    if (lagMs < lagThresholdMs) {
      strikes = 0;
      return;
    }

    strikes += 1;
    logger.warn({ lagMs: Math.round(lagMs), strikes, maxStrikes }, 'watchdog_strike');

    if (strikes >= maxStrikes) {
      logger.fatal(
        {
          lagMs: Math.round(lagMs),
          strikes,
          rssMb: Math.round(process.memoryUsage().rss / MB),
          uptimeS: Math.round(process.uptime()),
        },
        'watchdog_tripped_exiting',
      );
      onTrip();
    }
  }, intervalMs);

  timer.unref();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
