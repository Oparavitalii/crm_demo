/**
 * http.test.ts — tests for the HTTP client interceptor
 *
 * Strategy: vi.resetModules() before each test ensures the module-level
 * `refreshInFlight` singleton is reset. Because module reset also resets
 * auth-store, we re-import auth-store dynamically after reset so state is
 * set on the SAME store instance that http.ts will import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sampleUser = {
  id: 'u1',
  email: 'x@y.z',
  firstName: 'A',
  lastName: 'B',
  role: 'admin' as const,
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  has2FA: false,
};

function makeResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('http client', () => {
  it('attaches Authorization header when token present', async () => {
    // After resetModules, import fresh auth-store and set token
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'access-1');

    // Spy BEFORE importing http.ts so ofetch captures the spy
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse({}));

    const { apiFetch } = await import('../lib/http');
    await apiFetch('/test');

    expect(fetchSpy).toHaveBeenCalled();
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get('Authorization')).toBe('Bearer access-1');
  });

  it('omits Authorization when no token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse({}));

    const { apiFetch } = await import('../lib/http');
    await apiFetch('/test');

    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('includes credentials on every request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse({}));

    const { apiFetch } = await import('../lib/http');
    await apiFetch('/test');

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.credentials).toBe('include');
  });

  it('on 401: performs refresh, updates store token, retries with new token', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'old-token');

    let requestCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      requestCount++;

      if (url.includes('/auth/refresh')) {
        return makeResponse({ accessToken: 'new-token' });
      }
      // First /test call → 401; second → 200
      if (requestCount === 1) return makeResponse({}, 401);
      return makeResponse({ data: 'ok' });
    });

    const { apiFetch } = await import('../lib/http');
    const result = await apiFetch<{ data: string }>('/test');

    expect(result).toEqual({ data: 'ok' });
    expect(useAuthStore.getState().accessToken).toBe('new-token');

    // The last non-refresh call should carry the new token
    const nonRefreshCalls = fetchSpy.mock.calls.filter(([input]) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      return !url.includes('/auth/refresh');
    });
    const lastCall = nonRefreshCalls[nonRefreshCalls.length - 1]!;
    const headers = new Headers(lastCall[1]?.headers as HeadersInit);
    expect(headers.get('Authorization')).toBe('Bearer new-token');
  });

  it('on refresh failure: clears auth store and throws', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'old-token');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      // Both /test and /auth/refresh return 401
      if (url.includes('/auth/refresh')) return makeResponse({ error: 'Unauthorized' }, 401);
      return makeResponse({}, 401);
    });

    const { apiFetch } = await import('../lib/http');
    await expect(apiFetch('/test')).rejects.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('api() drives path + method from a routeRegistry descriptor', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'tok');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse({ id: 'c1', firstName: 'X', lastName: 'Y' }));

    const { api } = await import('../lib/http');
    const { routes } = await import('@opushr/shared');

    await api(routes.candidates.detail('c1'));

    const [url, init] = fetchSpy.mock.calls[0]!;
    const urlStr =
      typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.toString()
          : (url as Request).url;
    expect(urlStr).toContain('/candidates/c1');
    expect(init?.method).toBe('GET');
  });

  it('api() forwards body for mutation descriptors', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'tok');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse({ id: 'c1' }));

    const { api } = await import('../lib/http');
    const { routes } = await import('@opushr/shared');

    await api(routes.candidates.update('c1'), { body: { name: 'Anna' } });

    const [url, init] = fetchSpy.mock.calls[0]!;
    const urlStr =
      typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.toString()
          : (url as Request).url;
    expect(urlStr).toContain('/candidates/c1');
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBeDefined();
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Anna' });
  });

  it('performTokenRefresh: retries transport failures, then succeeds without clearing auth', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'old-token');

    let refreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      refreshCalls++;
      if (refreshCalls < 3) return makeResponse({ error: 'boom' }, 500);
      return makeResponse({ accessToken: 'fresh-token' });
    });

    const { performTokenRefresh } = await import('../lib/http');
    vi.useFakeTimers();
    const pending = performTokenRefresh();
    await vi.runAllTimersAsync(); // skip the 1s / 2s retry backoffs
    const outcome = await pending;

    expect(outcome).toBe('ok');
    expect(refreshCalls).toBe(3);
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
    expect(useAuthStore.getState().user).not.toBeNull();
  });

  it('performTokenRefresh: persistent 5xx returns "failed" and KEEPS auth state', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'old-token');

    let refreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      refreshCalls++;
      return makeResponse({ error: 'down' }, 503);
    });

    const { performTokenRefresh } = await import('../lib/http');
    vi.useFakeTimers();
    const pending = performTokenRefresh();
    await vi.runAllTimersAsync();
    const outcome = await pending;

    // Transport/server failure is NOT a dead session: token + session hint
    // must survive so the next attempt (or reload) can still use the cookie.
    expect(outcome).toBe('failed');
    expect(refreshCalls).toBe(3); // initial + 2 retries
    expect(useAuthStore.getState().accessToken).toBe('old-token');
    expect(useAuthStore.getState().user).not.toBeNull();
  });

  it('performTokenRefresh: 401 is definitive — no retry, auth cleared', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'old-token');

    let refreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      refreshCalls++;
      return makeResponse({ error: 'Unauthorized' }, 401);
    });

    const { performTokenRefresh } = await import('../lib/http');
    const outcome = await performTokenRefresh();

    expect(outcome).toBe('unauthorized');
    expect(refreshCalls).toBe(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('performTokenRefresh: the refresh request carries an abort signal (timeout bound)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse({ accessToken: 't' }));

    const { performTokenRefresh } = await import('../lib/http');
    await performTokenRefresh();

    const [, init] = fetchSpy.mock.calls[0]!;
    // ofetch materializes the `timeout` option as an AbortSignal — a hung
    // connection aborts after 10s instead of stalling app boot indefinitely.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('single-flight: two concurrent 401s trigger exactly ONE refresh', async () => {
    const { useAuthStore } = await import('../lib/auth-store');
    useAuthStore.getState().setSession(sampleUser, 'old-token');

    let refreshCallCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (url.includes('/auth/refresh')) {
        refreshCallCount++;
        // Simulate slight async work to make race condition visible
        await new Promise<void>((r) => setTimeout(r, 10));
        return makeResponse({ accessToken: 'refreshed-token' });
      }

      // Return 401 while old token is present (before refresh), 200 after
      const store = (await import('../lib/auth-store')).useAuthStore;
      if (store.getState().accessToken === 'old-token') {
        return makeResponse({}, 401);
      }
      return makeResponse({ ok: true });
    });

    const { apiFetch } = await import('../lib/http');

    // Fire two requests simultaneously — both will 401
    await Promise.all([apiFetch('/test'), apiFetch('/test')]);

    expect(refreshCallCount).toBe(1);
  });
});
