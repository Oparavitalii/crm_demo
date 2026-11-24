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

vi.mock('../services/documents.service', () => ({
  createMarkdownDocument: vi.fn(),
  createFileDocument: vi.fn(),
  getDocumentByIdAdmin: vi.fn(),
  updateDocument: vi.fn(),
  publishDocument: vi.fn(),
  softDeleteDocument: vi.fn(),
  listAcceptancesForDocument: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({ findById: vi.fn() }));
vi.mock('../repositories/sessions.repo', () => ({ findById: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as service from '../services/documents.service';
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
  const { adminDocumentsRouter } = await import('../routes/admin/documents');
  app.route('/admin/documents', adminDocumentsRouter);
  return app;
}

const validMd = {
  slug: 'regulamin-crm',
  title: 'Regulamin CRM',
  category: 'regulamin',
  contentMd: '# Regulamin',
  requiresAcceptance: true,
  visibleToRoles: ['admin', 'recruiter', 'coordinator', 'readonly'],
};

const sampleDoc = {
  id: '00000000-0000-0000-0000-00000000abcd',
  slug: 'regulamin-crm',
  title: 'Regulamin CRM',
  category: 'regulamin',
  contentMd: '# Regulamin',
  fileKey: null,
  fileMime: null,
  fileSizeBytes: null,
  version: 1,
  requiresAcceptance: true,
  visibleToRoles: ['admin', 'recruiter', 'coordinator', 'readonly'],
  publishedAt: null,
  createdBy: 'u',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('admin/documents routes — auth + role gating', () => {
  // Longer timeout — first test in the file pays the cold-start cost of dynamic
  // imports (router + transitively zod schemas), which can exceed 5s when
  // vitest runs many files in parallel under load.
  it('GET /admin/documents/:id without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/admin/documents/00000000-0000-0000-0000-00000000abcd');
    expect(res.status).toBe(401);
  }, 30_000);

  it('GET /admin/documents/:id with recruiter → 403', async () => {
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request('/admin/documents/00000000-0000-0000-0000-00000000abcd', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(403);
    expect(service.getDocumentByIdAdmin).not.toHaveBeenCalled();
  });

  it('POST /admin/documents/markdown without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/admin/documents/markdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validMd),
    });
    expect(res.status).toBe(401);
  });

  it('POST /admin/documents/markdown with recruiter → 403', async () => {
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request('/admin/documents/markdown', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(validMd),
    });
    expect(res.status).toBe(403);
    expect(service.createMarkdownDocument).not.toHaveBeenCalled();
  });

  it('DELETE /admin/documents/:id with recruiter → 403', async () => {
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request('/admin/documents/00000000-0000-0000-0000-00000000abcd', {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(403);
    expect(service.softDeleteDocument).not.toHaveBeenCalled();
  });
});

describe('admin/documents routes — POST /markdown', () => {
  it('creates a document and returns 201', async () => {
    vi.mocked(service.createMarkdownDocument).mockResolvedValue(sampleDoc as never);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/markdown', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(validMd),
    });
    expect(res.status).toBe(201);
    expect(service.createMarkdownDocument).toHaveBeenCalledOnce();
    const arg = vi.mocked(service.createMarkdownDocument).mock.calls[0]?.[0] as {
      slug: string;
    };
    expect(arg.slug).toBe('regulamin-crm');
  });

  it('rejects invalid body (missing required fields) with 400', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/markdown', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x' }), // no title, no category, no contentMd
    });
    expect(res.status).toBe(400);
    expect(service.createMarkdownDocument).not.toHaveBeenCalled();
  });

  it('rejects invalid slug format with 400', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/markdown', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validMd, slug: 'NOT_LOWERCASE_KEBAB' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('admin/documents routes — GET /:id', () => {
  it('returns document for admin', async () => {
    vi.mocked(service.getDocumentByIdAdmin).mockResolvedValue(sampleDoc as never);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/00000000-0000-0000-0000-00000000abcd', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(sampleDoc.id);
  });

  it('rejects invalid id (non-uuid) with 400', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/not-a-uuid', {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(400);
  });
});

describe('admin/documents routes — PATCH /:id', () => {
  it('updates document and returns 200', async () => {
    vi.mocked(service.updateDocument).mockResolvedValue({
      ...sampleDoc,
      title: 'New Title',
    } as never);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/00000000-0000-0000-0000-00000000abcd', {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Title' }),
    });
    expect(res.status).toBe(200);
    expect(service.updateDocument).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-00000000abcd',
      expect.objectContaining({ title: 'New Title' }),
      expect.objectContaining({ id: 'u', role: 'admin' }),
      expect.any(Object),
    );
  });

  it('rejects unknown body keys (strict schema) with 400', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/00000000-0000-0000-0000-00000000abcd', {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unknownField: 'x' }),
    });
    expect(res.status).toBe(400);
    expect(service.updateDocument).not.toHaveBeenCalled();
  });
});

describe('admin/documents routes — POST /:id/publish', () => {
  it('publishes document for admin', async () => {
    vi.mocked(service.publishDocument).mockResolvedValue({
      ...sampleDoc,
      publishedAt: new Date(),
    } as never);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request(
      '/admin/documents/00000000-0000-0000-0000-00000000abcd/publish',
      {
        method: 'POST',
        headers: { Authorization: auth },
      },
    );
    expect(res.status).toBe(200);
    expect(service.publishDocument).toHaveBeenCalledOnce();
  });

  it('rejects publish without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request(
      '/admin/documents/00000000-0000-0000-0000-00000000abcd/publish',
      { method: 'POST' },
    );
    expect(res.status).toBe(401);
  });
});

describe('admin/documents routes — DELETE /:id', () => {
  it('soft-deletes document and returns 204', async () => {
    vi.mocked(service.softDeleteDocument).mockResolvedValue(undefined);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/admin/documents/00000000-0000-0000-0000-00000000abcd', {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(204);
    expect(service.softDeleteDocument).toHaveBeenCalledOnce();
  });
});

describe('admin/documents routes — GET /:id/acceptances', () => {
  it('returns acceptances list for admin', async () => {
    const item = {
      id: 'acc-1',
      documentId: 'doc-1',
      version: 1,
      userId: 'u-1',
      userEmail: 'jan@example.com',
      userFirstName: 'Jan',
      userLastName: 'Nowak',
      acceptedAt: new Date('2026-05-01T10:00:00Z'),
      ip: '1.2.3.4',
      userAgent: 'jest',
    };
    vi.mocked(service.listAcceptancesForDocument).mockResolvedValue([item] as never);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request(
      '/admin/documents/00000000-0000-0000-0000-00000000abcd/acceptances',
      { headers: { Authorization: auth } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ userEmail: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.userEmail).toBe('jan@example.com');
  });

  it('returns CSV with correct content-type and header row', async () => {
    const item = {
      id: 'acc-1',
      documentId: 'doc-1',
      version: 1,
      userId: 'u-1',
      userEmail: 'jan@example.com',
      userFirstName: 'Jan',
      userLastName: 'Nowak',
      acceptedAt: new Date('2026-05-01T10:00:00Z'),
      ip: '1.2.3.4',
      userAgent: 'jest',
    };
    vi.mocked(service.listAcceptancesForDocument).mockResolvedValue([item] as never);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request(
      '/admin/documents/00000000-0000-0000-0000-00000000abcd/acceptances.csv',
      { headers: { Authorization: auth } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const body = await res.text();
    expect(body.split('\n')[0]).toBe(
      'wersja,email,imie,nazwisko,zaakceptowano_o,ip,user_agent',
    );
    expect(body).toContain('jan@example.com');
  });

  it('CSV endpoint rejects non-admin with 403', async () => {
    const auth = await authHeader('recruiter');
    const app = await makeApp();
    const res = await app.request(
      '/admin/documents/00000000-0000-0000-0000-00000000abcd/acceptances.csv',
      { headers: { Authorization: auth } },
    );
    expect(res.status).toBe(403);
  });
});
