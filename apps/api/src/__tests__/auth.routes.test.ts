import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env BEFORE importing modules that touch env.ts
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// Mock services BEFORE importing the router (critical order)
vi.mock('../services/auth.service', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({ findById: vi.fn() }));

// Mock logger to prevent env.ts loading via logger chain
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock all rate limiters to avoid rate limiting in tests.
// Keep this list in sync with middleware/rate-limit.ts exports.
vi.mock('../middleware/rate-limit', () => {
  const passthrough = vi.fn((_c: unknown, next: () => Promise<void>) => next());
  return {
    loginRateLimiter: passthrough,
    verify2faRateLimiter: passthrough,
    passwordResetRateLimiter: passthrough,
    acceptInviteRateLimiter: passthrough,
    publicFormRateLimiter: passthrough,
  };
});

import { Hono } from 'hono';
import * as authService from '../services/auth.service';
import { errorHandler } from '../middleware/error-handler';

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /auth/login', () => {
  it('returns 400 on invalid body', async () => {
    const { authRouter } = await import('../routes/auth');
    const app = makeApp();
    app.route('/auth', authRouter);
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-email', password: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 + sets cookie on valid login', async () => {
    vi.mocked(authService.login).mockResolvedValue({
      user: { id: 'u1', email: 'admin@example.com', firstName: 'A', lastName: 'B', role: 'admin', isActive: true, lastLoginAt: null, createdAt: new Date().toISOString(), has2FA: false, publicSlug: null },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    const { authRouter } = await import('../routes/auth');
    const app = makeApp();
    app.route('/auth', authRouter);
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'pass1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['accessToken']).toBe('access-token');
    expect((body['user'] as Record<string, unknown>)['id']).toBe('u1');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('refresh_token=');
    expect(cookie).toContain('HttpOnly');
    // Non-prod (test) env → 'Lax' (same-site localhost dev). Production uses
    // 'None' so the cookie survives the cross-site SPA→API refresh call.
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/auth');
  });
});

describe('POST /auth/reset-password/request', () => {
  it('always returns 200 (no enumeration)', async () => {
    vi.mocked(authService.requestPasswordReset).mockResolvedValue(undefined);
    const { authRouter } = await import('../routes/auth');
    const app = makeApp();
    app.route('/auth', authRouter);
    const res = await app.request('/auth/reset-password/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'whoever@nowhere.com' }),
    });
    expect(res.status).toBe(200);
  });
});
