import { ofetch, type FetchOptions } from 'ofetch';
import { clearAuth, getAccessToken, setAccessTokenSync } from './auth-store';
import type { RouteDescriptor } from '@opushr/shared';

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

// ---------------------------------------------------------------------------
// Token refresh.
//
// 'unauthorized' — the server said the session is dead (401/403): clear auth,
//   the user must log in again.
// 'failed' — transport-level failure (API unreachable right after laptop
//   wake-up, Fly cold start, 5xx): retried a couple of times, and auth state
//   is NOT cleared — the refresh cookie is likely still valid, so the next
//   attempt (or reload) can succeed.
//
// The whole attempt runs under a Web Lock shared by ALL tabs of this origin.
// Without it, tabs restored together each fire /auth/refresh with the same
// cookie; the server rotates on the first one and the rest present an
// already-rotated token. The server has a grace window for that race too —
// the lock keeps the normal path clean, the grace window covers the rest.
// ---------------------------------------------------------------------------
type RefreshOutcome = 'ok' | 'unauthorized' | 'failed';

const REFRESH_LOCK_NAME = 'opushr:auth-refresh';
const REFRESH_RETRY_DELAYS_MS = [1000, 2000];
// Bound each refresh attempt: a hung connection (Fly cold start stuck,
// network black hole after laptop wake) must fail fast into the retry loop
// instead of stalling app boot for the browser's default timeout.
const REFRESH_TIMEOUT_MS = 10_000;

function extractStatus(err: unknown): number | undefined {
  return err &&
    typeof err === 'object' &&
    'response' in err &&
    err.response &&
    typeof err.response === 'object' &&
    'status' in err.response
    ? (err.response as { status: number }).status
    : undefined;
}

async function refreshOnce(): Promise<RefreshOutcome> {
  try {
    const res = await ofetch<{ accessToken: string }>('/auth/refresh', {
      baseURL,
      method: 'POST',
      credentials: 'include',
      timeout: REFRESH_TIMEOUT_MS,
    });
    setAccessTokenSync(res.accessToken);
    return 'ok';
  } catch (err) {
    const status = extractStatus(err);
    if (status === 401 || status === 403) return 'unauthorized';
    return 'failed';
  }
}

async function refreshWithRetry(): Promise<RefreshOutcome> {
  let outcome = await refreshOnce();
  for (const delayMs of REFRESH_RETRY_DELAYS_MS) {
    if (outcome !== 'failed') break;
    await new Promise((r) => setTimeout(r, delayMs));
    outcome = await refreshOnce();
  }
  return outcome;
}

export async function performTokenRefresh(): Promise<RefreshOutcome> {
  // Web Locks API is available in all evergreen browsers on secure contexts;
  // fall back to an unserialized refresh elsewhere (tests, old Safari) — the
  // server-side grace window still absorbs cross-tab races there.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const outcome = locks
    ? await locks.request(REFRESH_LOCK_NAME, () => refreshWithRetry())
    : await refreshWithRetry();
  if (outcome === 'unauthorized') clearAuth();
  return outcome;
}

// ---------------------------------------------------------------------------
// Single-flight refresh promise — prevents stampede when multiple requests
// 401 simultaneously. Module-level singleton; cleared after resolution.
// (Intra-tab dedup; the Web Lock above is the cross-tab counterpart.)
// ---------------------------------------------------------------------------
let refreshInFlight: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async (): Promise<boolean> => {
    try {
      return (await performTokenRefresh()) === 'ok';
    } finally {
      // Clear the singleton after a tick so concurrent awaiters see resolved promise
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Base ofetch instance — adds Bearer token + credentials to every request.
// Retry is disabled here; retry-after-refresh is handled in apiFetch().
// ---------------------------------------------------------------------------
export const http = ofetch.create({
  baseURL,
  credentials: 'include',
  retry: 0,
  onRequest({ options }) {
    const token = getAccessToken();
    if (token) {
      const headers = new Headers(options.headers as HeadersInit | undefined);
      headers.set('Authorization', `Bearer ${token}`);
      options.headers = headers;
    }
  },
});

// ---------------------------------------------------------------------------
// apiFetch — public API that wraps http with transparent 401-refresh-retry.
//
// Deviation from plan's RetryRequest marker pattern:
//   The plan threw a RetryRequest Error from onResponseError and caught it in
//   apiFetch. This is fragile (ofetch may not propagate arbitrary throws from
//   the hook correctly across all environments). Instead we:
//   1. Catch FetchError with status 401 directly in apiFetch.
//   2. Skip retry if the failing URL was the refresh endpoint itself.
//   3. Call attemptRefresh() (single-flight).
//   4. On success: re-call http() with a fresh token; on fail: re-throw.
//
//   Security contract (unchanged from plan):
//   - Bearer header ALWAYS attached to every request (via onRequest hook).
//   - credentials: 'include' ALWAYS sent (via ofetch.create option).
//   - 401 triggers a single-flight refresh (attemptRefresh singleton).
//   - On refresh failure: store cleared (clearAuth in attemptRefresh catch).
// ---------------------------------------------------------------------------
export async function apiFetch<T>(
  url: string,
  options: FetchOptions<'json'> & { _retry?: boolean } = {},
): Promise<T> {
  try {
    return await http<T>(url, options);
  } catch (err: unknown) {
    const status = extractStatus(err);

    // Only intercept 401s, not after retry, not on the refresh endpoint itself
    const isRefreshUrl =
      typeof url === 'string' && url.includes('/auth/refresh');

    if (status === 401 && !options._retry && !isRefreshUrl) {
      const refreshed = await attemptRefresh();
      if (!refreshed) throw err;

      // Retry once with the new token (onRequest hook will attach it)
      return apiFetch<T>(url, { ...options, _retry: true } as FetchOptions<'json'> & { _retry?: boolean });
    }

    throw err;
  }
}

// ---------------------------------------------------------------------------
// api — type-safe wrapper around apiFetch driven by a routeRegistry descriptor.
// Inference flows: `routes.candidates.detail(id)` → response is `Candidate`,
// body shape (when present) is enforced by the descriptor's body phantom.
// The descriptor is the source of truth for path + method; callers can no
// longer mistype `'/candidate/' + id` and ship a runtime 404.
// ---------------------------------------------------------------------------
export function api<TResponse, TBody>(
  route: RouteDescriptor<TResponse, TBody>,
  options: Omit<FetchOptions<'json'>, 'method' | 'body'> & {
    body?: TBody;
  } = {},
): Promise<TResponse> {
  const { body, ...rest } = options;
  return apiFetch<TResponse>(route.path, {
    ...rest,
    method: route.method,
    ...(body !== undefined ? { body: body as FetchOptions<'json'>['body'] } : {}),
  });
}

// ---------------------------------------------------------------------------
// downloadFile — fetch a binary/text response from an authenticated endpoint
// and trigger a browser save dialog. Plain <a href> would lose the Bearer
// header on cross-tab navigation; this keeps the auth contract intact.
// No automatic 401-refresh-retry (the user can refresh + retry manually if
// their access token has just expired); the underlying http() instance still
// attaches the current token via onRequest.
// ---------------------------------------------------------------------------
export async function downloadFile(url: string, filename: string): Promise<void> {
  const token = getAccessToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${baseURL}${url}`, {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

// ---------------------------------------------------------------------------
// parseApiError — unify shape of errors thrown by ofetch.
// AppError responses from backend look like { error: ErrorCode, meta?: object }.
// `code` is narrowed to the shared ErrorCode union when it matches a known
// value, so callers can `code === ERROR_CODES.ALREADY_ASSIGNED` with safety.
// ---------------------------------------------------------------------------
import { type ErrorCode, isErrorCode } from '@opushr/shared';

export interface ApiErrorInfo {
  status?: number;
  code?: ErrorCode;
  meta?: Record<string, unknown>;
}

export function parseApiError(err: unknown): ApiErrorInfo {
  if (!err || typeof err !== 'object') return {};
  const response =
    'response' in err && err.response && typeof err.response === 'object'
      ? (err.response as { status?: number; _data?: unknown })
      : undefined;
  const status = response?.status;
  const data = response?._data;
  if (!data || typeof data !== 'object') return { status };
  const rawCode = 'error' in data && typeof data.error === 'string' ? data.error : undefined;
  const code = isErrorCode(rawCode) ? rawCode : undefined;
  const meta =
    'meta' in data && data.meta && typeof data.meta === 'object'
      ? (data.meta as Record<string, unknown>)
      : undefined;
  return { status, code, meta };
}

// True when the request never produced an HTTP response at all (connection
// drop, DNS failure, client offline) — as opposed to a server reply without
// a structured body (proxy 502, crash before the error handler).
export function isNetworkError(info: ApiErrorInfo): boolean {
  return info.status === undefined;
}

// Human-readable "CODE — key=value, key=value" detail line for error
// notifications. Falls back to "HTTP <status>" when the response carried a
// status but no structured code (proxy/5xx without a body) so users can tell
// a server-side failure from a dead connection. Empty string only when there
// was no response at all — callers show a network message in that case.
export function formatApiErrorDetail(info: ApiErrorInfo): string {
  const parts: string[] = [];
  if (info.code) parts.push(info.code);
  else if (info.status) parts.push(`HTTP ${info.status}`);
  if (info.meta) {
    const metaStr = Object.entries(info.meta)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(', ');
    if (metaStr) parts.push(metaStr);
  }
  return parts.join(' — ');
}
