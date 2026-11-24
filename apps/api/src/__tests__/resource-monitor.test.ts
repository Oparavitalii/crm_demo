import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const infoSpy = vi.fn();
vi.mock('../lib/logger', () => ({
  logger: { info: (...a: unknown[]) => infoSpy(...a), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../db/client', () => ({
  pool: { totalCount: 7, idleCount: 2, waitingCount: 0 },
}));

const { startResourceMonitor } = await import('../lib/resource-monitor');

describe('startResourceMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    infoSpy.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('emits rss, heap, event-loop lag and pool stats on each tick', () => {
    const stop = startResourceMonitor(1000);
    vi.advanceTimersByTime(1000);
    const [fields, msg] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('resources');
    expect(typeof fields.rssMb).toBe('number');
    expect(typeof fields.heapUsedMb).toBe('number');
    expect(typeof fields.loopLagMs).toBe('number');
    expect(fields.poolTotal).toBe(7);
    expect(fields.poolIdle).toBe(2);
    expect(fields.poolWaiting).toBe(0);
    stop();
  });

  it('stops emitting after the returned stop function is called', () => {
    const stop = startResourceMonitor(1000);
    vi.advanceTimersByTime(1000);
    const first = infoSpy.mock.calls.length;
    stop();
    vi.advanceTimersByTime(5000);
    expect(infoSpy.mock.calls.length).toBe(first);
  });
});
