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

vi.mock('../services/message-templates.service', () => ({
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('../services/bulk-send.service', () => ({
  previewRecipients: vi.fn(),
  sendBulk: vi.fn(),
  getHistory: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({ findById: vi.fn() }));
vi.mock('../repositories/sessions.repo', () => ({ findById: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as templatesService from '../services/message-templates.service';
import * as bulkSendService from '../services/bulk-send.service';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import { errorHandler } from '../middleware/error-handler';

beforeEach(() => vi.clearAllMocks());

async function authHeader(role: 'admin' | 'recruiter' | 'coordinator' = 'admin'): Promise<string> {
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
  const { communicationsRouter } = await import('../routes/communications');
  app.route('/communications', communicationsRouter);
  return app;
}

const TEMPLATE_ID = '00000000-0000-0000-0000-000000000010';
const CANDIDATE_ID = '00000000-0000-0000-0000-000000000020';

const baseTemplate = {
  id: TEMPLATE_ID,
  name: 'Welcome',
  channel: 'email' as const,
  subject: 'Hello {{firstName}}',
  body: '<p>Welcome {{firstName}}!</p>',
  variables: ['firstName'],
  createdById: 'u',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('communications/templates routes', () => {
  it('GET /communications/templates without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/communications/templates');
    expect(res.status).toBe(401);
  });

  it('GET /communications/templates with auth → 200', async () => {
    vi.mocked(templatesService.listTemplates).mockResolvedValue({
      items: [], total: 0, page: 1, pageSize: 20,
    });
    const auth = await authHeader();
    const app = await makeApp();
    const res = await app.request('/communications/templates', { headers: { Authorization: auth } });
    expect(res.status).toBe(200);
  });

  it('POST /communications/templates with invalid body (missing name) → 400', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/communications/templates', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'email', body: 'Hi' }), // missing name
    });
    expect(res.status).toBe(400);
  });

  it('POST /communications/templates happy path (admin) → 201', async () => {
    vi.mocked(templatesService.createTemplate).mockResolvedValue(baseTemplate as never);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/communications/templates', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Welcome',
        channel: 'email',
        subject: 'Hello {{firstName}}',
        body: '<p>Welcome {{firstName}}!</p>',
        variables: ['firstName'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(TEMPLATE_ID);
    expect(templatesService.createTemplate).toHaveBeenCalled();
  });

  it('POST /communications/templates by coordinator → 403 (admin or recruiter only)', async () => {
    const auth = await authHeader('coordinator');
    const app = await makeApp();
    const res = await app.request('/communications/templates', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Welcome',
        channel: 'email',
        body: '<p>Welcome!</p>',
      }),
    });
    expect(res.status).toBe(403);
    expect(templatesService.createTemplate).not.toHaveBeenCalled();
  });

  it('DELETE /communications/templates/:id by coordinator → 403', async () => {
    const auth = await authHeader('coordinator');
    const app = await makeApp();
    const res = await app.request(`/communications/templates/${TEMPLATE_ID}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(403);
    expect(templatesService.deleteTemplate).not.toHaveBeenCalled();
  });

  it('DELETE /communications/templates/:id by admin → 204', async () => {
    vi.mocked(templatesService.deleteTemplate).mockResolvedValue(undefined);
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request(`/communications/templates/${TEMPLATE_ID}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(204);
    expect(templatesService.deleteTemplate).toHaveBeenCalled();
  });
});

describe('communications/send routes', () => {
  it('POST /communications/send-bulk without auth → 401', async () => {
    const app = await makeApp();
    const res = await app.request('/communications/send-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TEMPLATE_ID }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /communications/send-bulk with entityType=lead and empty recipientIds → 400 (schema refine)', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/communications/send-bulk', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: TEMPLATE_ID,
        entityType: 'lead',
        recipientIds: [],
      }),
    });
    expect(res.status).toBe(400);
    expect(bulkSendService.sendBulk).not.toHaveBeenCalled();
  });

  it('POST /communications/send-bulk exceeding recipient cap (>100) → 400', async () => {
    const auth = await authHeader('admin');
    const app = await makeApp();
    // bulkSendInputSchema caps recipientIds at .max(100); 101 ids must fail Zod.
    const recipientIds = Array.from({ length: 101 }, (_, i) => {
      const hex = i.toString(16).padStart(12, '0');
      return `00000000-0000-0000-0000-${hex}`;
    });
    const res = await app.request('/communications/send-bulk', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: TEMPLATE_ID,
        entityType: 'candidate',
        recipientIds,
      }),
    });
    expect(res.status).toBe(400);
    expect(bulkSendService.sendBulk).not.toHaveBeenCalled();
  });

  it('POST /communications/send-bulk by coordinator → 403', async () => {
    const auth = await authHeader('coordinator');
    const app = await makeApp();
    const res = await app.request('/communications/send-bulk', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: TEMPLATE_ID,
        entityType: 'candidate',
        filters: {},
        dryRun: true,
      }),
    });
    expect(res.status).toBe(403);
    expect(bulkSendService.sendBulk).not.toHaveBeenCalled();
  });

  it('POST /communications/send-bulk happy path (admin, mock bulkSendService) → 200', async () => {
    vi.mocked(bulkSendService.sendBulk).mockResolvedValue({
      recipientsTotal: 1,
      sentCount: 1,
      failedCount: 0,
      sentWithoutConsent: 0,
      dryRun: false,
      messageIds: [CANDIDATE_ID],
    });
    const auth = await authHeader('admin');
    const app = await makeApp();
    const res = await app.request('/communications/send-bulk', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: TEMPLATE_ID,
        entityType: 'candidate',
        filters: {},
        dryRun: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sentCount: number };
    expect(body.sentCount).toBe(1);
    expect(bulkSendService.sendBulk).toHaveBeenCalled();
  });
});
