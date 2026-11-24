// Bounded-concurrency replacement for `Promise.all` over DB query thunks.
//
// Why this exists: the pg pool in `db/client.ts` is capped at `max`
// connections and is shared by every in-flight request on the process. An
// unbounded `Promise.all` over DB calls can demand more connections than the
// pool holds, and that failure mode is not fast — each waiter blocks until
// `connectionTimeoutMillis` expires, starving unrelated requests on the same
// process and surfacing to the browser as 500s. Bounding the fan-out keeps a
// single endpoint from monopolising the pool.
//
// Semantics match `Promise.all`: results keep input order and the first
// rejection rejects the whole call. The difference is that callers pass
// thunks, not already-started promises — a promise passed in has already
// issued its query, which is exactly what we are trying to avoid.

type Resolved<T extends ReadonlyArray<() => Promise<unknown>>> = {
  -readonly [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never;
};

// `readonly [...T]` rather than plain `T` — without the variadic-tuple form
// TypeScript widens the argument to an array and every result collapses into
// one union, which loses the per-position types the callers destructure.
export async function allLimited<T extends ReadonlyArray<() => Promise<unknown>>>(
  tasks: readonly [...T],
  limit: number,
): Promise<Resolved<T>> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`allLimited: limit must be a positive integer, got ${String(limit)}`);
  }

  const results = new Array<unknown>(tasks.length);
  let cursor = 0;

  // Each worker pulls the next index until the queue drains, so a slow task
  // never blocks a free slot — `limit` queries stay in flight until the end.
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];
      if (!task) continue;
      results[index] = await task();
    }
  }

  const workerCount = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results as Resolved<T>;
}
