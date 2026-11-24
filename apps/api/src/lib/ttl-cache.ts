// Tiny in-memory TTL cache (no external dependencies).
//
// Exists to cut redundant per-request lookups against Neon. The auth
// middleware loads the same user row on every authenticated request; under
// Neon's scale-to-zero / EU latency that repeated PK lookup is pure overhead.
// A short-lived TTL cache absorbs the burst of requests a single user makes
// within a few seconds while keeping staleness bounded (and writes bust the
// affected key explicitly, see users.repo.ts).
//
// Single-process only — there is no cross-instance invalidation. Keep TTLs
// short so a stale entry self-heals quickly even without an explicit bust.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  // In-flight loads, keyed the same as `store`. Without this, N concurrent
  // requests that all miss the same key issue N identical queries and take N
  // pool connections.
  //
  // That is precisely what happened on 2026-07-28: one page open fires ~39
  // authenticated requests, requireAuth loads the acting user on every one of
  // them, and with a cold cache all 39 queued for their own connection against
  // a pool of 25 until waiters hit connectionTimeoutMillis. 20 of the 23
  // unhandled errors in that window came from this exact call site.
  private readonly inFlight = new Map<string, Promise<T | undefined>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  // Returns the cached value, or undefined when missing or expired. Expired
  // entries are evicted lazily on read so the map never grows unbounded for
  // keys that are still being requested.
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  // Cache-aside with single-flight: concurrent misses on the same key share
  // one `load()` call instead of each issuing its own.
  //
  // A rejected load is neither cached nor left in `inFlight`, so the next
  // caller retries. That matters here — the failures this absorbs are
  // transient pool/connection timeouts, and a sticky rejection would turn one
  // bad second into a full TTL of guaranteed 500s.
  async getOrLoad(key: string, load: () => Promise<T | undefined>): Promise<T | undefined> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = load()
      .then((value) => {
        // Never cache a not-found, so a freshly created or restored row is
        // visible on its next lookup without waiting out a TTL.
        if (value !== undefined) this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}
