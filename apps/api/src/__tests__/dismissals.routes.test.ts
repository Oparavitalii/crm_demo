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

vi.mock('../services/dismissals.service', () => ({
  listDismissals: vi.fn(),
  listEnrichedDismissals: vi.fn(),
  getDismissal: vi.fn(),
  createDismissal: vi.fn(),
  updateDismissal: vi.fn(),
  deleteDismissal: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({ findById: vi.fn() }));
vi.mock('../repositories/sessions.repo', () => ({ findById: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as service from '../services/dismissals.service';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import { errorHandler } from '../middleware/error-handler';

beforeEach(() => vi.clearAllMocks());

async function authHeader(role: 'admin' | 'recruiter' | 'coordinator' = 'admin'): Promise<string> {
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
  const { dismissalsRouter } = await import('../routes/dismissals');
  app.route('/dismissals', dismissalsRouter);
  return app;
}

describe('dismissals routes', () => {
  it('GET /dismissals without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/dismissals');
    expect(res.status).toBe(401);
  });

  it('GET /dismissals/registry without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/dismissals/registry');
    expect(res.status).toBe(401);
  });

  it('GET /dismissals with auth → 200', async () => {
    vi.mocked(service.listDismissals).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request('/dismissals', { headers: { Authorization: auth } });
    expect(res.status).toBe(200);
  });

  it('GET /dismissals?recruiterId=... forwards filter to service', async () => {
    vi.mocked(service.listDismissals).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const auth = await authHeader();
    const app = await makeApp();
    const recId = '11111111-1111-1111-1111-111111111111';
    const res = await app.request(`/dismissals?recruiterId=${recId}`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const call = vi.mocked(service.listDismissals).mock.calls[0]?.[0];
    expect(call?.recruiterId).toBe(recId);
  });

  it('GET /dismissals?coordinatorId=... forwards NEW coordinator filter', async () => {
    vi.mocked(service.listDismissals).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const auth = await authHeader();
    const app = await makeApp();
    const coordId = '22222222-2222-2222-2222-222222222222';
    const res = await app.request(`/dismissals?coordinatorId=${coordId}`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const call = vi.mocked(service.listDismissals).mock.calls[0]?.[0];
    expect(call?.coordinatorId).toBe(coordId);
  });

  it('GET /dismissals/registry?coordinatorId=... forwards to enriched service', async () => {
    vi.mocked(service.listEnrichedDismissals).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    const auth = await authHeader();
    const app = await makeApp();
    const coordId = '33333333-3333-3333-3333-333333333333';
    const res = await app.request(`/dismissals/registry?coordinatorId=${coordId}`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const call = vi.mocked(service.listEnrichedDismissals).mock.calls[0]?.[0];
    expect(call?.coordinatorId).toBe(coordId);
  });

  it('POST /dismissals with custom (non-canonical) reasonCode → 201', async () => {
    vi.mocked(service.createDismissal).mockResolvedValue({
      id: 'd-1',
      candidateId: '44444444-4444-4444-4444-444444444444',
      dismissedAt: new Date('2024-03-01T00:00:00.000Z'),
      reason: 'Custom local reason',
      reasonCode: 'covid_leave',
      recordedById: 'u',
      notes: null,
      createdAt: new Date(),
    } as never);
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request('/dismissals', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: '44444444-4444-4444-4444-444444444444',
        dismissedAt: '2024-03-01T00:00:00.000Z',
        reason: 'Custom local reason',
        reasonCode: 'covid_leave',
      }),
    });
    expect(res.status).toBe(201);
    const call = vi.mocked(service.createDismissal).mock.calls[0]?.[0];
    expect(call?.reasonCode).toBe('covid_leave');
  });

  it('POST /dismissals with empty reason → 400', async () => {
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request('/dismissals', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateId: '44444444-4444-4444-4444-444444444444',
        dismissedAt: '2024-03-01T00:00:00.000Z',
        reason: '',
      }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(service.createDismissal)).not.toHaveBeenCalled();
  });

  it('DELETE /dismissals/:id by recruiter → 403', async () => {
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request('/dismissals/55555555-5555-5555-5555-555555555555', {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(403);
  });
});
