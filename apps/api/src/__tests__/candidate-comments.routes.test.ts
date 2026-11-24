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

vi.mock('../services/candidate-comments.service', () => ({
  listComments: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({ findById: vi.fn() }));
vi.mock('../repositories/sessions.repo', () => ({ findById: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as service from '../services/candidate-comments.service';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import { errorHandler } from '../middleware/error-handler';
import { ForbiddenError, NotFoundError } from '../lib/errors';

beforeEach(() => vi.clearAllMocks());

const candidateId = '00000000-0000-0000-0000-000000000001';
const commentId = '00000000-0000-0000-0000-000000000099';

async function authHeader(role: 'admin' | 'recruiter' | 'coordinator' | 'readonly' = 'admin'): Promise<string> {
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
  const { candidateCommentsRouter } = await import('../routes/candidate-comments');
  app.route('/candidates', candidateCommentsRouter);
  return app;
}

describe('candidate-comments routes', () => {
  it('GET /candidates/:id/comments without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request(`/candidates/${candidateId}/comments`);
    expect(res.status).toBe(401);
  });

  it('GET /candidates/:id/comments with auth → 200 and returns service result', async () => {
    vi.mocked(service.listComments).mockResolvedValue({ items: [], total: 0 });
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request(`/candidates/${candidateId}/comments`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], total: 0 });
  });

  it('GET with non-UUID :id → 400', async () => {
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request('/candidates/not-a-uuid/comments', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(400);
    expect(service.listComments).not.toHaveBeenCalled();
  });

  it('GET returns 404 when service throws NotFoundError (RBAC hidden candidate)', async () => {
    vi.mocked(service.listComments).mockRejectedValue(new NotFoundError('candidate'));
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request(`/candidates/${candidateId}/comments`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(404);
  });

  it('POST /candidates/:id/comments without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request(`/candidates/${candidateId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hello' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST with empty body → 400 (zod min(1))', async () => {
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request(`/candidates/${candidateId}/comments`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });
    expect(res.status).toBe(400);
    expect(service.createComment).not.toHaveBeenCalled();
  });

  it('POST happy path → 201 and forwards body to service', async () => {
    vi.mocked(service.createComment).mockResolvedValue({
      id: commentId,
      candidateId,
      authorId: 'u',
      body: 'Spoke with client',
      createdAt: new Date(),
      authorFirstName: 'Anna',
      authorLastName: 'Recruiter',
    } as never);
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request(`/candidates/${candidateId}/comments`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Spoke with client' }),
    });
    expect(res.status).toBe(201);
    expect(service.createComment).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(service.createComment).mock.calls[0];
    expect(callArgs?.[0]).toBe(candidateId);
    expect(callArgs?.[1]).toEqual({ body: 'Spoke with client' });
  });

  it('POST returns 404 when service throws NotFoundError', async () => {
    vi.mocked(service.createComment).mockRejectedValue(new NotFoundError('candidate'));
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request(`/candidates/${candidateId}/comments`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hi' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /candidates/:id/comments/:commentId returns 204 on success', async () => {
    vi.mocked(service.deleteComment).mockResolvedValue(undefined);
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request(
      `/candidates/${candidateId}/comments/${commentId}`,
      { method: 'DELETE', headers: { Authorization: auth } },
    );
    expect(res.status).toBe(204);
    expect(service.deleteComment).toHaveBeenCalledOnce();
    expect(vi.mocked(service.deleteComment).mock.calls[0]?.[0]).toBe(commentId);
  });

  it('DELETE returns 403 when service throws ForbiddenError (non-author non-admin)', async () => {
    vi.mocked(service.deleteComment).mockRejectedValue(
      new ForbiddenError('not your comment'),
    );
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request(
      `/candidates/${candidateId}/comments/${commentId}`,
      { method: 'DELETE', headers: { Authorization: auth } },
    );
    expect(res.status).toBe(403);
  });

  it('DELETE with non-UUID commentId → 400', async () => {
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request(
      `/candidates/${candidateId}/comments/not-a-uuid`,
      { method: 'DELETE', headers: { Authorization: auth } },
    );
    expect(res.status).toBe(400);
    expect(service.deleteComment).not.toHaveBeenCalled();
  });
});
