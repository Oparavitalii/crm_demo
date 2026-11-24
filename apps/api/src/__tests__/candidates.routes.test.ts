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

vi.mock('../services/candidates.service', () => ({
  listCandidates: vi.fn(),
  getCandidate: vi.fn(),
  createCandidate: vi.fn(),
  updateCandidate: vi.fn(),
  deleteCandidate: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({ findById: vi.fn() }));
vi.mock('../repositories/sessions.repo', () => ({ findById: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as service from '../services/candidates.service';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import { errorHandler } from '../middleware/error-handler';

beforeEach(() => vi.clearAllMocks());

async function authHeader(role: 'admin' | 'recruiter' = 'admin'): Promise<string> {
  vi.mocked(sessionsRepo.findById).mockResolvedValue({
    id: 's', userId: 'u', refreshTokenHash: 'h', rotatedAt: null, replacedById: null,
    expiresAt: new Date(Date.now() + 86_400_000), ip: null, userAgent: null, createdAt: new Date(),
  });
  vi.mocked(usersRepo.findById).mockResolvedValue({
    id: 'u', email: 'a@b.com', role, isActive: true,
  } as never);
  const { signAccess } = await import('../lib/jwt');
  const token = await signAccess({ sub: 'u', role, sid: 's' });
  return `Bearer ${token}`;
}

async function makeApp(): Promise<Hono> {
  const app = new Hono();
  app.onError(errorHandler);
  const { candidatesRouter } = await import('../routes/candidates');
  app.route('/candidates', candidatesRouter);
  return app;
}

describe('candidates routes', () => {
  it('GET /candidates without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/candidates');
    expect(res.status).toBe(401);
  });

  it('GET /candidates with auth → 200', async () => {
    vi.mocked(service.listCandidates).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request('/candidates', { headers: { Authorization: auth } });
    expect(res.status).toBe(200);
  });

  it('POST /candidates with invalid body → 400', async () => {
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request('/candidates', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /candidates/:id by recruiter → 403', async () => {
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request('/candidates/abc', { method: 'DELETE', headers: { Authorization: auth } });
    expect(res.status).toBe(403);
  });
});
