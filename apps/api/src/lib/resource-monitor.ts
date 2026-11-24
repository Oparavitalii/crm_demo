import { monitorEventLoopDelay } from 'node:perf_hooks';
import { logger } from './logger';
import { pool } from '../db/client';

const MB = 1024 * 1024;
const NS_PER_MS = 1e6;
const DEFAULT_INTERVAL_MS = 60_000;

// Periodic snapshot of everything that was invisible during the 2026-07-28
// wedge: how much memory the process holds, whether the event loop is being
// serviced, and whether anything is queued for a pg connection.
//
// Event-loop lag is the honest health signal. A Fly machine can report state
// `started`, hold its TCP listener, and still fail its health check because
// nothing gets a turn on the single shared vCPU — which is exactly what
// `context deadline exceeded` meant on a production machine, on a /health route
// that performs no I/O whatsoever.
//
// Cheap enough to leave on permanently: one histogram read and one
// process.memoryUsage() per minute.
export function startResourceMonitor(intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    logger.info(
      {
        rssMb: Math.round(mem.rss / MB),
        heapUsedMb: Math.round(mem.heapUsed / MB),
        heapTotalMb: Math.round(mem.heapTotal / MB),
        externalMb: Math.round(mem.external / MB),
        loopLagMs: Math.round(histogram.mean / NS_PER_MS),
        loopLagMaxMs: Math.round(histogram.max / NS_PER_MS),
        poolTotal: pool.totalCount,
        poolIdle: pool.idleCount,
        poolWaiting: pool.waitingCount,
        uptimeS: Math.round(process.uptime()),
      },
      'resources',
    );
    histogram.reset();
  }, intervalMs);

  // Must not keep the process alive on its own — graceful shutdown closes the
  // server and expects the event loop to drain.
  timer.unref();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
