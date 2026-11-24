import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fatalSpy = vi.fn();
const warnSpy = vi.fn();
vi.mock('../lib/logger', () => ({
  logger: {
    fatal: (...a: unknown[]) => fatalSpy(...a),
    warn: (...a: unknown[]) => warnSpy(...a),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const { startWatchdog } = await import('../lib/watchdog');

describe('startWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fatalSpy.mockClear();
    warnSpy.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('does not trip while lag stays under the threshold', () => {
    const onTrip = vi.fn();
    const stop = startWatchdog({
      intervalMs: 1000,
      lagThresholdMs: 5000,
      strikes: 3,
      onTrip,
      readLagMs: () => 10,
    });
    vi.advanceTimersByTime(10_000);
    expect(onTrip).not.toHaveBeenCalled();
    stop();
  });

  it('trips only after the configured number of consecutive strikes', () => {
    const onTrip = vi.fn();
    const stop = startWatchdog({
      intervalMs: 1000,
      lagThresholdMs: 5000,
      strikes: 3,
      onTrip,
      readLagMs: () => 9000,
    });
    vi.advanceTimersByTime(2000);
    expect(onTrip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(fatalSpy).toHaveBeenCalled();
    stop();
  });

  it('resets the strike count when the loop recovers', () => {
    const onTrip = vi.fn();
    let lag = 9000;
    const stop = startWatchdog({
      intervalMs: 1000,
      lagThresholdMs: 5000,
      strikes: 3,
      onTrip,
      readLagMs: () => lag,
    });
    vi.advanceTimersByTime(2000);
    lag = 5;
    vi.advanceTimersByTime(1000);
    lag = 9000;
    vi.advanceTimersByTime(2000);
    expect(onTrip).not.toHaveBeenCalled();
    stop();
  });

  it('warns on every strike so the build-up is visible before the exit', () => {
    const stop = startWatchdog({
      intervalMs: 1000,
      lagThresholdMs: 5000,
      strikes: 3,
      onTrip: vi.fn(),
      readLagMs: () => 9000,
    });
    vi.advanceTimersByTime(2000);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    stop();
  });
});
