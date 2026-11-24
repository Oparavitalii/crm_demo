import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';

// env.ts validates at module load — set required vars before any import that
// transitively touches `../env`.
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

const ALLOWED_PRIMARY = 'https://crm.crm-demo.example';
const ALLOWED_SECONDARY = 'https://staging.crm-demo.example';
const DISALLOWED = 'https://evil.example.com';

/**
 * Load `applySecurity` with a specific CORS_ORIGIN value. The security module
 * reads `env.CORS_ORIGIN` at construction time inside `applySecurity`, so each
 * describe block calls this to get a fresh module bound to its allowlist.
 */
async function loadSecurity(corsOrigin: string): Promise<(app: Hono) => void> {
  process.env.CORS_ORIGIN = corsOrigin;
  vi.resetModules();
  const mod = await import('../middleware/security');
  return mod.applySecurity;
}

function makeApp(applySecurity: (app: Hono) => void): Hono {
  const app = new Hono();
  applySecurity(app);
  app.get('/noop', (c) => c.json({ ok: true }));
  app.post('/noop', (c) => c.json({ ok: true }));
  return app;
}

describe('secureHeaders applied to every response', () => {
  let app: Hono;
  let res: Response;

  beforeAll(async () => {
    const applySecurity = await loadSecurity(ALLOWED_PRIMARY);
    app = makeApp(applySecurity);
    res = await app.request('/noop');
  });

  it('sets HSTS with 2-year max-age + preload', () => {
    expect(res.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
  });

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', () => {
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets CSP locking down default-src and frame-ancestors', () => {
    const csp = res.headers.get('content-security-policy');
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sets Permissions-Policy denying geolocation, microphone, camera', () => {
    const pp = res.headers.get('permissions-policy');
    expect(pp).not.toBeNull();
    // Hono renders empty array as `directive=()` — empty allowlist means
    // no origin (including same-origin) may use the feature.
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('camera=()');
  });
});

describe('CORS allowlist enforcement', () => {
  let app: Hono;

  beforeAll(async () => {
    const applySecurity = await loadSecurity(`${ALLOWED_PRIMARY},${ALLOWED_SECONDARY}`);
    app = makeApp(applySecurity);
  });

  it('echoes Allow-Origin for the first allowed origin', async () => {
    const res = await app.request('/noop', { headers: { Origin: ALLOWED_PRIMARY } });
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_PRIMARY);
  });

  it('echoes Allow-Origin for the second allowed origin', async () => {
    const res = await app.request('/noop', { headers: { Origin: ALLOWED_SECONDARY } });
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_SECONDARY);
  });

  it('omits Allow-Origin for a disallowed origin (simple request)', async () => {
    const res = await app.request('/noop', { headers: { Origin: DISALLOWED } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('handles preflight from an allowed origin with 204 + allow-methods/headers', async () => {
    const res = await app.request('/noop', {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_PRIMARY,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_PRIMARY);
    const methods = res.headers.get('access-control-allow-methods');
    expect(methods).not.toBeNull();
    // applySecurity configures these exact verbs.
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('PUT');
    expect(methods).toContain('PATCH');
    expect(methods).toContain('DELETE');
    const allowHeaders = res.headers.get('access-control-allow-headers');
    expect(allowHeaders).not.toBeNull();
    expect(allowHeaders).toContain('Content-Type');
    expect(allowHeaders).toContain('Authorization');
  });

  it('omits Allow-Origin on preflight from a disallowed origin (browser will block)', async () => {
    const res = await app.request('/noop', {
      method: 'OPTIONS',
      headers: {
        Origin: DISALLOWED,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('omits Allow-Origin when no Origin header is sent', async () => {
    const res = await app.request('/noop');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('CORS exposed headers (UI relies on these)', () => {
  let app: Hono;

  beforeAll(async () => {
    const applySecurity = await loadSecurity(ALLOWED_PRIMARY);
    app = makeApp(applySecurity);
  });

  it('exposes Content-Disposition and X-Row-Count', async () => {
    const res = await app.request('/noop', { headers: { Origin: ALLOWED_PRIMARY } });
    const exposed = res.headers.get('access-control-expose-headers');
    expect(exposed).not.toBeNull();
    expect(exposed).toContain('Content-Disposition');
    expect(exposed).toContain('X-Row-Count');
  });
});

describe('CORS credentials', () => {
  let app: Hono;

  beforeAll(async () => {
    const applySecurity = await loadSecurity(ALLOWED_PRIMARY);
    app = makeApp(applySecurity);
  });

  it('returns Allow-Credentials: true for allowed origins', async () => {
    const res = await app.request('/noop', { headers: { Origin: ALLOWED_PRIMARY } });
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  afterAll(() => {
    // Reset so later test files don't inherit our allowlist mutation.
    vi.resetModules();
  });
});
