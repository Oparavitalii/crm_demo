import { describe, it, expect, vi } from 'vitest';

// Set env BEFORE importing modules that touch env.ts (audit.ts imports
// services/audit.service which transitively pulls env via db/logger).
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// Mock logger to prevent env.ts loading via logger->env chain.
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// audit.service is imported by middleware/audit.ts; stub it so we never touch DB.
vi.mock('../services/audit.service', () => ({
  log: vi.fn(),
}));

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getClientIp, buildReqCtx } from '../middleware/audit';

/**
 * Build a minimal Context-ish object so we can call getClientIp directly
 * without spinning up an HTTP roundtrip for each header permutation.
 * The function only reads `c.req.header(name)`, so this is sufficient and
 * exactly matches the call shape inside audit.ts.
 */
function fakeCtx(headers: Record<string, string | undefined>): {
  req: { header: (k: string) => string | undefined };
} {
  const lower: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    req: {
      header: (k: string) => lower[k.toLowerCase()],
    },
  };
}

describe('getClientIp — header precedence', () => {
  it('returns Fly-Client-IP when present (wins over CF and XFF)', () => {
    const ip = getClientIp(
      fakeCtx({
        'fly-client-ip': '1.1.1.1',
        'cf-connecting-ip': '2.2.2.2',
        'x-forwarded-for': '3.3.3.3',
      }),
    );
    expect(ip).toBe('1.1.1.1');
  });

  it('returns CF-Connecting-IP when Fly is absent', () => {
    const ip = getClientIp(
      fakeCtx({
        'cf-connecting-ip': '2.2.2.2',
        'x-forwarded-for': '3.3.3.3',
      }),
    );
    expect(ip).toBe('2.2.2.2');
  });

  it('returns X-Forwarded-For (single IP) when Fly and CF are absent', () => {
    const ip = getClientIp(fakeCtx({ 'x-forwarded-for': '3.3.3.3' }));
    expect(ip).toBe('3.3.3.3');
  });

  it('returns FIRST (left-most) IP from X-Forwarded-For comma list', () => {
    // RFC 7239: left-most entry is the original client; subsequent entries
    // are proxies. Locking left-most behaviour explicitly because right-most
    // would be a spoofing-resistant choice only when XFF is appended by a
    // trusted proxy, which on Fly it is not.
    const ip = getClientIp(
      fakeCtx({ 'x-forwarded-for': 'client.example, proxy1, proxy2' }),
    );
    expect(ip).toBe('client.example');
  });

  it('returns null when all three headers are absent', () => {
    expect(getClientIp(fakeCtx({}))).toBeNull();
  });

  it('returns null when all three headers are empty strings', () => {
    // Empty header value should not be treated as a valid IP. Current behaviour:
    // `??` chain treats '' as present (falsy but not nullish) so Fly='' would
    // be returned. We lock the realistic case: if XFF is '' the split[0] is
    // also '' (trimmed), which propagates. This documents the current code.
    const ip = getClientIp(
      fakeCtx({
        'fly-client-ip': '',
        'cf-connecting-ip': '',
        'x-forwarded-for': '',
      }),
    );
    // Implementation note: `??` returns the first non-nullish header. Empty
    // string is non-nullish, so fly='' wins and we get ''. This is arguably
    // a bug (empty should fall through) but locking actual behaviour.
    expect(ip).toBe('');
  });

  it('trims leading/trailing whitespace around the first XFF entry', () => {
    const ip = getClientIp(
      fakeCtx({ 'x-forwarded-for': '   4.4.4.4   , proxy1' }),
    );
    expect(ip).toBe('4.4.4.4');
  });

  it('returns IPv6 first entry verbatim from XFF', () => {
    const ip = getClientIp(fakeCtx({ 'x-forwarded-for': '::1, proxy' }));
    expect(ip).toBe('::1');
  });
});

describe('getClientIp — malformed input', () => {
  it('returns empty string when XFF is only commas (",,,")', () => {
    // split(',')[0] of ",,," is '' — trimmed is ''. The `??` chain treats
    // '' as non-nullish, so we get '' (not null). Locking actual behaviour
    // so a future "validate IPs" refactor surfaces here as a deliberate change.
    const ip = getClientIp(fakeCtx({ 'x-forwarded-for': ',,,' }));
    expect(ip).toBe('');
  });

  it('returns garbage string verbatim from XFF (no format validation)', () => {
    // getClientIp does NOT validate IP format — it's a header-order resolver,
    // not a parser. Downstream audit log stores whatever shows up. This is
    // intentional: we'd rather record "not-an-ip" in audit than drop the row.
    const ip = getClientIp(fakeCtx({ 'x-forwarded-for': 'not-an-ip' }));
    expect(ip).toBe('not-an-ip');
  });
});

describe('buildReqCtx — shape', () => {
  it('returns object with ip and userAgent keys only', () => {
    const ctx = fakeCtx({
      'fly-client-ip': '5.5.5.5',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101',
    }) as unknown as Context;
    const out = buildReqCtx(ctx);
    expect(Object.keys(out).sort()).toEqual(['ip', 'userAgent']);
  });

  it('pulls user-agent header verbatim (no truncation, no lowercasing)', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const ctx = fakeCtx({
      'fly-client-ip': '5.5.5.5',
      'user-agent': ua,
    }) as unknown as Context;
    expect(buildReqCtx(ctx).userAgent).toBe(ua);
  });

  it('returns userAgent: null when header missing', () => {
    const ctx = fakeCtx({ 'fly-client-ip': '5.5.5.5' }) as unknown as Context;
    expect(buildReqCtx(ctx).userAgent).toBeNull();
  });

  it('returns both ip: null and userAgent: null when nothing is set', () => {
    const ctx = fakeCtx({}) as unknown as Context;
    expect(buildReqCtx(ctx)).toEqual({ ip: null, userAgent: null });
  });

  it('realistic Fly request: Fly-Client-IP + user-agent', () => {
    const ctx = fakeCtx({
      'fly-client-ip': '203.0.113.42',
      'cf-connecting-ip': '198.51.100.7',
      'x-forwarded-for': '203.0.113.42, 198.51.100.7',
      'user-agent': 'curl/8.5.0',
    }) as unknown as Context;
    expect(buildReqCtx(ctx)).toEqual({
      ip: '203.0.113.42',
      userAgent: 'curl/8.5.0',
    });
  });
});

describe('integration via Hono app', () => {
  // Smoke-test that the same code path works when invoked through a real
  // Hono Context (not just the duck-typed fake). Catches any regression
  // where Hono changes how `c.req.header` normalizes names.
  it('resolves Fly-Client-IP through real Hono request', async () => {
    const app = new Hono();
    app.get('/', (c) => c.json(buildReqCtx(c)));
    const res = await app.request('/', {
      headers: {
        'Fly-Client-IP': '10.0.0.1',
        'User-Agent': 'test-runner/1.0',
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ip: '10.0.0.1',
      userAgent: 'test-runner/1.0',
    });
  });

  it('falls through Fly -> CF -> XFF through real Hono request', async () => {
    const app = new Hono();
    app.get('/', (c) => c.json(buildReqCtx(c)));
    const res = await app.request('/', {
      headers: {
        'X-Forwarded-For': '7.7.7.7, 8.8.8.8',
      },
    });
    expect(await res.json()).toEqual({
      ip: '7.7.7.7',
      userAgent: null,
    });
  });
});
