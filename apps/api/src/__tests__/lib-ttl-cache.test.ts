import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from '../lib/ttl-cache';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for a missing key', () => {
    const cache = new TtlCache<string>(1000);
    expect(cache.get('nope')).toBeUndefined();
  });

  it('stores and returns a value within the TTL', () => {
    const cache = new TtlCache<number>(1000);
    cache.set('a', 42);
    expect(cache.get('a')).toBe(42);
  });

  it('expires entries once the TTL elapses', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'value');
    vi.advanceTimersByTime(999);
    expect(cache.get('a')).toBe('value');
    vi.advanceTimersByTime(1); // now at 1000ms == expiresAt
    expect(cache.get('a')).toBeUndefined();
  });

  it('deletes a single key', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'x');
    cache.set('b', 'y');
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('y');
  });

  it('clears all keys', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'x');
    cache.set('b', 'y');
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('set refreshes the expiry of an existing key', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'first');
    vi.advanceTimersByTime(800);
    cache.set('a', 'second'); // resets the 1000ms window
    vi.advanceTimersByTime(800); // 1600ms since first set, 800ms since second
    expect(cache.get('a')).toBe('second');
  });
});
