import { describe, it, expect, vi } from 'vitest';
import { TtlCache } from '../lib/ttl-cache';

describe('TtlCache.getOrLoad', () => {
  it('issues exactly one load for many concurrent misses on the same key', async () => {
    const cache = new TtlCache<{ id: string }>(60_000);
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { id: 'u1' };
    };
    const results = await Promise.all(
      Array.from({ length: 39 }, () => cache.getOrLoad('u1', load)),
    );
    expect(calls).toBe(1);
    expect(results.every((r) => r?.id === 'u1')).toBe(true);
  });

  it('serves later calls from the cache without loading again', async () => {
    const cache = new TtlCache<{ id: string }>(60_000);
    const load = vi.fn(async () => ({ id: 'u1' }));
    await cache.getOrLoad('u1', load);
    await cache.getOrLoad('u1', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a not-found result', async () => {
    const cache = new TtlCache<{ id: string }>(60_000);
    const load = vi.fn(async () => undefined);
    await cache.getOrLoad('missing', load);
    await cache.getOrLoad('missing', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('propagates a load failure to every awaiter and retries next time', async () => {
    const cache = new TtlCache<{ id: string }>(60_000);
    let calls = 0;
    const failing = async (): Promise<{ id: string } | undefined> => {
      calls += 1;
      throw new Error('connection timeout');
    };
    const settled = await Promise.allSettled([
      cache.getOrLoad('u1', failing),
      cache.getOrLoad('u1', failing),
    ]);
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    expect(calls).toBe(1);

    // A failure must not be sticky — the pool timeouts this exists to absorb
    // are transient, so the next caller has to try again.
    await expect(cache.getOrLoad('u1', failing)).rejects.toThrow('connection timeout');
    expect(calls).toBe(2);
  });

  it('keys are independent — two ids load in parallel', async () => {
    const cache = new TtlCache<{ id: string }>(60_000);
    const seen: string[] = [];
    const load = (id: string) => async () => {
      seen.push(id);
      return { id };
    };
    await Promise.all([cache.getOrLoad('a', load('a')), cache.getOrLoad('b', load('b'))]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('an expired entry reloads, and concurrent callers still share one load', async () => {
    const cache = new TtlCache<{ id: string }>(10);
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { id: 'u1' };
    };
    await cache.getOrLoad('u1', load);
    await new Promise((r) => setTimeout(r, 20));
    await Promise.all(Array.from({ length: 5 }, () => cache.getOrLoad('u1', load)));
    expect(calls).toBe(2);
  });
});
