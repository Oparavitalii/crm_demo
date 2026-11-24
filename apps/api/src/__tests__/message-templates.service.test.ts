import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/message-templates.repo', () => ({
  list: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listAll: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// sanitize-html is a real package — no mock needed; the test verifies real behaviour

import * as repo from '../repositories/message-templates.repo';
import { NotFoundError, ForbiddenError } from '../lib/errors';

const admin = { id: 'admin-1', role: 'admin' as const };
const recruiter = { id: 'rec-1', role: 'recruiter' as const };
const coordinator = { id: 'coord-1', role: 'coordinator' as const };
const readonly = { id: 'ro-1', role: 'readonly' as const };

const baseTemplate = {
  id: 'tmpl-1',
  name: 'Welcome Email',
  channel: 'email' as const,
  subject: 'Hello {{firstName}}',
  body: '<p>Hi {{firstName}} {{lastName}}</p>',
  variables: ['firstName', 'lastName'],
  autoSendOnCreate: false,
  createdById: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ctx = { ip: null, userAgent: null };

beforeEach(() => vi.clearAllMocks());

describe('message-templates.service.createTemplate', () => {
  it('admin can create a template', async () => {
    vi.mocked(repo.insert).mockResolvedValue(baseTemplate);
    const { createTemplate } = await import('../services/message-templates.service');
    const result = await createTemplate(
      { name: 'Welcome Email', channel: 'email', subject: 'Hi', body: '<p>Hi</p>', variables: [] },
      admin,
      ctx,
    );
    expect(result.id).toBe('tmpl-1');
    expect(repo.insert).toHaveBeenCalledOnce();
  });

  it('recruiter can create a template', async () => {
    vi.mocked(repo.insert).mockResolvedValue({ ...baseTemplate, createdById: 'rec-1' });
    const { createTemplate } = await import('../services/message-templates.service');
    const result = await createTemplate(
      { name: 'Recruiter Template', channel: 'email', subject: null, body: '<p>Body</p>', variables: [] },
      recruiter,
      ctx,
    );
    expect(result.createdById).toBe('rec-1');
  });

  it('coordinator cannot create a template', async () => {
    const { createTemplate } = await import('../services/message-templates.service');
    await expect(
      createTemplate(
        { name: 'Test', channel: 'email', subject: null, body: '<p>Body</p>', variables: [] },
        coordinator,
        ctx,
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('readonly cannot create a template', async () => {
    const { createTemplate } = await import('../services/message-templates.service');
    await expect(
      createTemplate(
        { name: 'Test', channel: 'sms', subject: null, body: 'Body', variables: [] },
        readonly,
        ctx,
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('message-templates.service.getTemplate', () => {
  it('returns template when found', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseTemplate);
    const { getTemplate } = await import('../services/message-templates.service');
    const result = await getTemplate('tmpl-1', admin);
    expect(result.name).toBe('Welcome Email');
  });

  it('throws NOT_FOUND when template does not exist', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { getTemplate } = await import('../services/message-templates.service');
    await expect(getTemplate('tmpl-99', admin)).rejects.toThrow(NotFoundError);
  });
});

describe('message-templates.service.updateTemplate', () => {
  it('admin can update a template', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseTemplate);
    vi.mocked(repo.update).mockResolvedValue({ ...baseTemplate, name: 'Updated' });
    const { updateTemplate } = await import('../services/message-templates.service');
    const result = await updateTemplate('tmpl-1', { name: 'Updated' }, admin, ctx);
    expect(result.name).toBe('Updated');
  });

  it('coordinator cannot update a template', async () => {
    const { updateTemplate } = await import('../services/message-templates.service');
    await expect(updateTemplate('tmpl-1', { name: 'X' }, coordinator, ctx)).rejects.toThrow(ForbiddenError);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('message-templates.service XSS sanitization (I-1)', () => {
  it('strips <script> from body on createTemplate', async () => {
    const xssBody = '<p>Hello</p><script>alert("xss")</script>';
    let capturedBody: string | undefined;

    vi.mocked(repo.insert).mockImplementation(async (input) => {
      capturedBody = input.body as string;
      return { ...baseTemplate, body: input.body as string };
    });

    const { createTemplate } = await import('../services/message-templates.service');
    await createTemplate(
      { name: 'XSS Test', channel: 'email', subject: 'Hi', body: xssBody, variables: [] },
      admin,
      ctx,
    );

    expect(capturedBody).not.toContain('<script>');
    expect(capturedBody).not.toContain('alert');
    expect(capturedBody).toContain('<p>Hello</p>');
  });

  it('strips <script> from body on updateTemplate', async () => {
    const xssBody = '<p>Updated</p><script>alert("xss")</script>';
    let capturedBody: string | undefined;

    vi.mocked(repo.findById).mockResolvedValue(baseTemplate);
    vi.mocked(repo.update).mockImplementation(async (_id, patch) => {
      capturedBody = (patch as Record<string, unknown>).body as string;
      return { ...baseTemplate, body: capturedBody };
    });

    const { updateTemplate } = await import('../services/message-templates.service');
    await updateTemplate('tmpl-1', { body: xssBody }, admin, ctx);

    expect(capturedBody).not.toContain('<script>');
    expect(capturedBody).not.toContain('alert');
    expect(capturedBody).toContain('<p>Updated</p>');
  });
});

describe('message-templates.service.deleteTemplate', () => {
  it('admin can delete a template', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseTemplate);
    vi.mocked(repo.remove).mockResolvedValue(true);
    const { deleteTemplate } = await import('../services/message-templates.service');
    await expect(deleteTemplate('tmpl-1', admin, ctx)).resolves.toBeUndefined();
  });

  it('recruiter can delete a template', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseTemplate);
    vi.mocked(repo.remove).mockResolvedValue(true);
    const { deleteTemplate } = await import('../services/message-templates.service');
    await expect(deleteTemplate('tmpl-1', recruiter, ctx)).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND when template does not exist on delete', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { deleteTemplate } = await import('../services/message-templates.service');
    await expect(deleteTemplate('tmpl-99', admin, ctx)).rejects.toThrow(NotFoundError);
  });

  it('coordinator cannot delete a template', async () => {
    const { deleteTemplate } = await import('../services/message-templates.service');
    await expect(deleteTemplate('tmpl-1', coordinator, ctx)).rejects.toThrow(ForbiddenError);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
