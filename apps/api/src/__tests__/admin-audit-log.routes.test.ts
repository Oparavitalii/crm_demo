import { describe, it, expect, vi, beforeEach } from 'vitest';

// Env stubs BEFORE any module that imports env.ts.
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../services/audit-log.service', () => ({
  listAuditLog: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({ findById: vi.fn() }));
vi.mock('../repositories/sessions.repo', () => ({ findById: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as service from '../services/audit-log.service';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import { errorHandler } from '../middleware/error-handler';

beforeEach(() => vi.clearAllMocks());

async function authHeader(role: 'admin' | 'recruiter' = 'admin'): Promise<string> {
  vi.mocked(sessionsRepo.findById).mockResolvedValue({
    id: 's',
    userId: 'u',
    refreshTokenHash: 'h',
    expiresAt: new Date(Date.now() + 86_400_000),
    rotatedAt: null,
    replacedById: null,
    ip: null,
    userAgent: null,
    createdAt: new Date(),
  });
  vi.mocked(usersRepo.findById).mockResolvedValue({
    id: 'u',
    email: 'a@b.com',
    role,
    isActive: true,
  } as never);
  const { signAccess } = await import('../lib/jwt');
  const token = await signAccess({ sub: 'u', role, sid: 's' });
  return `Bearer ${token}`;
}

async function makeApp(): Promise<Hono> {
  const app = new Hono();
  app.onError(errorHandler);
  const { adminAuditLogRouter } = await import('../routes/admin/audit-log');
  app.route('/admin/audit-log', adminAuditLogRouter);
  return app;
}

describe('admin/audit-log routes', () => {
  it('GET /admin/audit-log without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/admin/audit-log');
    expect(res.status).toBe(401);
    expect(service.listAuditLog).not.toHaveBeenCalled();
  });

  it('GET /admin/audit-log with recruiter (non-admin) → 403', async () => {
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request('/admin/audit-log', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(403);
    expect(service.listAuditLog).not.toHaveBeenCalled();
  });

  it('GET /admin/audit-log with admin → 200', async () => {
    vi.mocked(service.listAuditLog).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/audit-log', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(service.listAuditLog).toHaveBeenCalledOnce();
  });

  it('forwards filter params (entityType, entityId, actorId, from/to) to service', async () => {
    vi.mocked(service.listAuditLog).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const auth = await authHeader('admin');
    const app = await makeApp();
    const qs = new URLSearchParams({
      page: '1',
      pageSize: '20',
      entityType: 'candidate',
      entityId: '00000000-0000-0000-0000-000000000001',
      actorId: '00000000-0000-0000-0000-000000000002',
      action: 'anonymize_candidate',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.000Z',
    });
    const res = await app.request(`/admin/audit-log?${qs.toString()}`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const call = vi.mocked(service.listAuditLog).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      entityType: 'candidate',
      entityId: '00000000-0000-0000-0000-000000000001',
      actorId: '00000000-0000-0000-0000-000000000002',
      action: 'anonymize_candidate',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.000Z',
    });
  });

  it('forwards pagination params (page, pageSize) to service', async () => {
    vi.mocked(service.listAuditLog).mockResolvedValue({
      items: [],
      total: 0,
      page: 3,
      pageSize: 50,
    });
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/audit-log?page=3&pageSize=50', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const call = vi.mocked(service.listAuditLog).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.page).toBe(3);
    expect(call.pageSize).toBe(50);
  });

  it('passes admin actor (id + role) to the service', async () => {
    vi.mocked(service.listAuditLog).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/audit-log', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const actor = vi.mocked(service.listAuditLog).mock.calls[0]?.[1] as {
      id: string;
      role: string;
    };
    expect(actor.id).toBe('u');
    expect(actor.role).toBe('admin');
  });

  it('rejects invalid query params (e.g. malformed date) with 400', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/audit-log?from=not-a-date', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(400);
    expect(service.listAuditLog).not.toHaveBeenCalled();
  });
});
