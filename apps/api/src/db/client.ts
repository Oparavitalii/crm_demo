import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import { logger } from '../lib/logger';
import * as schema from './schema';

const { Pool } = pg;

// Exported so lib/resource-monitor.ts can report totalCount / idleCount /
// waitingCount. A persistently non-zero waitingCount is the leading indicator
// of the starvation that surfaced on 2026-07-28 as pg-pool's
// `timeout exceeded when trying to connect` — until now that queue depth was
// unobservable, so pool sizing was argued rather than measured.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Sized against the worst-case concurrent demand of a single request, not
  // against average load. The dashboard is the heaviest caller: it runs
  // DASHBOARD_QUERY_CONCURRENCY (4) repo calls at a time and the widest of
  // those fans out to 5 queries internally, so ~20 connections. Add the two
  // parallel lookups requireAuth performs per authenticated request and 25 is
  // the floor that keeps one dashboard load from starving everything else.
  //
  // At 10 it did starve: 2026-07-25 saw /analytics/dashboard return 500 after
  // 54.7s and /tasks after 42.1s, because waiters blocked on the pool until
  // connectionTimeoutMillis below expired. Neon's limit is 894 direct
  // connections and prod runs 2 app machines + 1 cron (3 x 25 = 75), so there
  // is ample headroom. Re-check this arithmetic before scaling the app group.
  max: 25,
  idleTimeoutMillis: 30_000,
  // Measured against a genuinely SUSPENDED compute on 2026-07-25: the request
  // that had to wake Neon took 507ms end-to-end, the next one 193ms. The wake
  // itself is therefore ~300ms — not the "10-20s in practice" this comment
  // claimed for months, which was never measured.
  //
  // That older note justified 25s by "5s was too aggressive — every first
  // request after idle returned 500". Those 500s were almost certainly the pool
  // starvation fixed in c882c85: a dashboard load demanded more connections than
  // the pool held and the waiters timed out. Raising this value masked that bug
  // rather than fixing it.
  //
  // 25s is kept deliberately, not by inertia. Now that keep-warm is gone, cold
  // starts are routine rather than exceptional, so the margin covers a Neon
  // hiccup on the very path users hit first every morning. Worth revisiting once
  // there are a few weeks of evidence about how long a bad wake actually takes.
  connectionTimeoutMillis: 25_000,
  // Per-query timeout — protects against a runaway query holding a pool slot
  // indefinitely. 30s is generous; long-running analytics should be paged.
  //
  // This MUST be `query_timeout` (driver-side), not `statement_timeout`.
  // DATABASE_URL points at Neon's pooler, which is PgBouncer in transaction
  // mode: it silently drops a `statement_timeout` startup parameter, and
  // passing one via `options` is rejected outright with "unsupported startup
  // parameter in options". Verified against prod on 2026-07-25 — the pool had
  // carried `statement_timeout: 30_000` for months while `SHOW
  // statement_timeout` on that connection returned `0`, i.e. no limit at all.
  // `query_timeout` is enforced by node-postgres itself, so the pooler cannot
  // swallow it; the same check confirmed it fires. Server-side
  // `statement_timeout` still works on DATABASE_URL_DIRECT (migrations,
  // backups), which does not go through the pooler.
  query_timeout: 30_000,
});

// Neon kills idle pooled connections during scale-to-zero. Without this
// listener, pg surfaces the drop as an unhandled error event → Node turns
// it into uncaughtException → index.ts exits the process → Fly restarts
// the machine (~25s of 5xx + missing CORS headers visible to the browser).
// The pool itself rotates the dead client; we just need to absorb the event.
pool.on('error', (err) => {
  logger.warn({ err }, 'pg_pool_idle_client_error');
});

export const db = drizzle(pool, {
  schema,
  logger: env.NODE_ENV === 'development',
});
export type DB = typeof db;

// Type of the transaction object handed to `db.transaction((tx) => ...)`.
// Repository functions accept `Executor = DB | Tx` so the same call works in
// either context — service code can opt into transactional behavior by passing
// the tx through, without each repo branching on undefined.
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Executor = DB | Tx;
