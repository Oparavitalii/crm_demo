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

vi.mock('../repositories/users.repo', () => ({
  findById: vi.fn(),
}));

vi.mock('../repositories/sessions.repo', () => ({
  findById: vi.fn(),
}));

// Mock logger to prevent env.ts loading via logger→env chain
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { Hono } from 'hono';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import { errorHandler } from '../middleware/error-handler';

const validSession = (userId = 'u', sid = 's') => ({
  id: sid,
  userId,
  refreshTokenHash: 'hash',
  expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
  rotatedAt: null,
  replacedById: null,
  ip: null,
  userAgent: null,
  createdAt: new Date(),
});

beforeEach(() => vi.clearAllMocks());

function makeApp() {
  const app = new Hono();
  app.onError(errorHandler);
  return app;
}

describe('requireAuth + requireRole', () => {
  it('rejects missing token', async () => {
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true, role: c.var.userRole }));
    const res = await app.request('/secret');
    expect(res.status).toBe(401);
  });

  it('rejects malformed bearer', async () => {
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true, role: c.var.userRole }));
    const res = await app.request('/secret', { headers: { Authorization: 'NotBearer xxx' } });
    expect(res.status).toBe(401);
  });

  it('rejects invalid token', async () => {
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true, role: c.var.userRole }));
    const res = await app.request('/secret', { headers: { Authorization: 'Bearer bogus' } });
    expect(res.status).toBe(401);
  });

  it('rejects when user not found', async () => {
    vi.mocked(sessionsRepo.findById).mockResolvedValue(validSession());
    vi.mocked(usersRepo.findById).mockResolvedValue(undefined);
    const { signAccess } = await import('../lib/jwt');
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const token = await signAccess({ sub: 'u', role: 'admin', sid: 's' });
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true, role: c.var.userRole }));
    const res = await app.request('/secret', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('rejects inactive user', async () => {
    vi.mocked(sessionsRepo.findById).mockResolvedValue(validSession());
    vi.mocked(usersRepo.findById).mockResolvedValue({
      id: 'u', email: 'x@y', role: 'admin', isActive: false,
    } as never);
    const { signAccess } = await import('../lib/jwt');
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const token = await signAccess({ sub: 'u', role: 'admin', sid: 's' });
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true, role: c.var.userRole }));
    const res = await app.request('/secret', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('rejects when session was revoked (deleted from DB)', async () => {
    vi.mocked(sessionsRepo.findById).mockResolvedValue(undefined);
    // After the parallelization (Promise.all), users.findById fires alongside
    // sessions.findById regardless of outcome. Provide a value so the parallel
    // branch resolves cleanly — the 401 must still come from the missing session.
    vi.mocked(usersRepo.findById).mockResolvedValue({
      id: 'u', email: 'x@y', role: 'admin', isActive: true,
    } as never);
    const { signAccess } = await import('../lib/jwt');
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const token = await signAccess({ sub: 'u', role: 'admin', sid: 's' });
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true }));
    const res = await app.request('/secret', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('runs session + user lookups in parallel (both called even when session missing)', async () => {
    vi.mocked(sessionsRepo.findById).mockResolvedValue(undefined);
    vi.mocked(usersRepo.findById).mockResolvedValue({
      id: 'u', email: 'x@y', role: 'admin', isActive: true,
    } as never);
    const { signAccess } = await import('../lib/jwt');
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const token = await signAccess({ sub: 'u', role: 'admin', sid: 's' });
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true }));
    await app.request('/secret', { headers: { Authorization: `Bearer ${token}` } });
    // Both lookups must fire — guard against accidental re-introduction of a
    // sequential short-circuit that would cost ~5-10ms on every request.
    expect(vi.mocked(sessionsRepo.findById)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(usersRepo.findById)).toHaveBeenCalledTimes(1);
  });

  it('rejects when session subject mismatches token', async () => {
    vi.mocked(sessionsRepo.findById).mockResolvedValue(validSession('other-user'));
    const { signAccess } = await import('../lib/jwt');
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const token = await signAccess({ sub: 'u', role: 'admin', sid: 's' });
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true }));
    const res = await app.request('/secret', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('allows admin to access', async () => {
    vi.mocked(sessionsRepo.findById).mockResolvedValue(validSession());
    vi.mocked(usersRepo.findById).mockResolvedValue({
      id: 'u', email: 'x@y', role: 'admin', isActive: true,
    } as never);
    const { signAccess } = await import('../lib/jwt');
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const token = await signAccess({ sub: 'u', role: 'admin', sid: 's' });
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true, role: c.var.userRole }));
    const res = await app.request('/secret', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: 'admin' });
  });

  it('forbids non-admin role', async () => {
    vi.mocked(sessionsRepo.findById).mockResolvedValue(validSession());
    vi.mocked(usersRepo.findById).mockResolvedValue({
      id: 'u', email: 'x@y', role: 'recruiter', isActive: true,
    } as never);
    const { signAccess } = await import('../lib/jwt');
    const { requireAuth, requireRole } = await import('../middleware/auth');
    const token = await signAccess({ sub: 'u', role: 'recruiter', sid: 's' });
    const app = makeApp();
    app.get('/secret', requireAuth, requireRole(['admin']), (c) => c.json({ ok: true, role: c.var.userRole }));
    const res = await app.request('/secret', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
  });
});
