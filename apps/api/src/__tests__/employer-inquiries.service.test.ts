import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/employer-inquiries.repo', () => ({
  list: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  recentSubmissionsCount: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/employer-inquiries.repo';
import * as audit from '../services/audit.service';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const readonlyUser = { id: 'ro-1', role: 'readonly' as const };

const ctx = { ip: '1.2.3.4', userAgent: 'jest' };

const baseInquiry = {
  id: 'inq-1',
  companyName: 'Acme Sp. z o.o.',
  contactPerson: 'Jan Kowalski',
  email: 'jan@acme.example.com',
  phone: '+48555111222',
  message: 'Looking for warehouse workers',
  privacyAccepted: true,
  status: 'new' as const,
  source: 'web' as const,
  assignedToId: null,
  internalNotes: null,
  contactedAt: null,
  closedAt: null,
  ipAddress: null,
  userAgent: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => vi.clearAllMocks());

describe('employer-inquiries.service.listInquiries', () => {
  it('returns paginated result and forwards page/pageSize from query', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [baseInquiry], total: 1 });
    const { listInquiries } = await import('../services/employer-inquiries.service');
    const result = await listInquiries(
      { page: 2, pageSize: 25 } as never,
      adminUser,
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(25);
    expect(repo.list).toHaveBeenCalledOnce();
  });

  it('passes filter through to repo (status, q)', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [], total: 0 });
    const { listInquiries } = await import('../services/employer-inquiries.service');
    const query = { page: 1, pageSize: 20, status: 'contacted', q: 'Acme' } as never;
    await listInquiries(query, adminUser);
    expect(vi.mocked(repo.list).mock.calls[0]?.[0]).toEqual(query);
  });
});

describe('employer-inquiries.service.getInquiry', () => {
  it('returns inquiry when found', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseInquiry);
    const { getInquiry } = await import('../services/employer-inquiries.service');
    const result = await getInquiry('inq-1', adminUser);
    expect(result.id).toBe('inq-1');
  });

  it('throws NotFoundError when missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { getInquiry } = await import('../services/employer-inquiries.service');
    await expect(getInquiry('inq-missing', adminUser)).rejects.toThrow(NotFoundError);
  });
});

describe('employer-inquiries.service.submitFromPublic', () => {
  const submitInput = {
    companyName: 'Acme',
    contactPerson: 'Jan Kowalski',
    email: 'jan@acme.example.com',
    phone: '+48555111222',
    message: 'Need 10 warehouse workers',
    privacyAccepted: true as const,
  };

  it('inserts row, writes audit with actorId=null, and returns id', async () => {
    vi.mocked(repo.recentSubmissionsCount).mockResolvedValue(0);
    vi.mocked(repo.insert).mockResolvedValue(baseInquiry);
    const { submitFromPublic } = await import('../services/employer-inquiries.service');
    const result = await submitFromPublic(submitInput, ctx);
    expect(result.id).toBe('inq-1');

    expect(repo.insert).toHaveBeenCalledOnce();
    const insertArg = vi.mocked(repo.insert).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertArg.source).toBe('web');
    expect(insertArg.status).toBe('new');
    expect(insertArg.ipAddress).toBe('1.2.3.4');

    expect(audit.log).toHaveBeenCalledOnce();
    const auditArg = vi.mocked(audit.log).mock.calls[0]?.[0];
    expect(auditArg?.actorId).toBeNull();
    expect(auditArg?.action).toBe('submit_employer_inquiry');
    expect(auditArg?.entityId).toBe('inq-1');
  });

  it('throws 429 VALIDATION error when spam threshold exceeded', async () => {
    vi.mocked(repo.recentSubmissionsCount).mockResolvedValue(5);
    const { submitFromPublic } = await import('../services/employer-inquiries.service');
    await expect(submitFromPublic(submitInput, ctx)).rejects.toThrow(AppError);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('attaches 429 status on the AppError when spam-blocked', async () => {
    vi.mocked(repo.recentSubmissionsCount).mockResolvedValue(99);
    const { submitFromPublic } = await import('../services/employer-inquiries.service');
    try {
      await submitFromPublic(submitInput, ctx);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(429);
      expect((err as AppError).code).toBe('VALIDATION');
    }
  });
});

describe('employer-inquiries.service.createInquiry', () => {
  const createInput = {
    companyName: 'Acme',
    contactPerson: 'Jan Kowalski',
    email: 'jan@acme.example.com',
    phone: '+48555111222',
    message: 'Need workers',
    privacyAccepted: true,
    source: 'manual' as const,
    internalNotes: null,
  };

  it('admin can create and audit is written', async () => {
    vi.mocked(repo.insert).mockResolvedValue(baseInquiry);
    const { createInquiry } = await import('../services/employer-inquiries.service');
    const result = await createInquiry(createInput, adminUser, ctx);
    expect(result.id).toBe('inq-1');
    expect(audit.log).toHaveBeenCalledOnce();
    const auditArg = vi.mocked(audit.log).mock.calls[0]?.[0];
    expect(auditArg?.actorId).toBe('admin-1');
    expect(auditArg?.action).toBe('create_employer_inquiry');
  });

  it('readonly user cannot create', async () => {
    const { createInquiry } = await import('../services/employer-inquiries.service');
    await expect(createInquiry(createInput, readonlyUser, ctx)).rejects.toThrow(
      ForbiddenError,
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe('employer-inquiries.service.updateInquiry', () => {
  it('stamps contactedAt on first transition to contacted', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseInquiry);
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) => ({ ...baseInquiry, ...patch } as never),
    );
    const { updateInquiry } = await import('../services/employer-inquiries.service');
    await updateInquiry('inq-1', { status: 'contacted' }, adminUser, ctx);
    const updateArg = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateArg.contactedAt).toBeInstanceOf(Date);
  });

  it('stamps closedAt on transition to accepted', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseInquiry);
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) => ({ ...baseInquiry, ...patch } as never),
    );
    const { updateInquiry } = await import('../services/employer-inquiries.service');
    await updateInquiry('inq-1', { status: 'accepted' }, adminUser, ctx);
    const updateArg = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateArg.closedAt).toBeInstanceOf(Date);
  });

  it('does NOT re-stamp closedAt if it was already set', async () => {
    const alreadyClosed = {
      ...baseInquiry,
      status: 'rejected' as const,
      closedAt: new Date('2025-12-01T00:00:00Z'),
    };
    vi.mocked(repo.findById).mockResolvedValue(alreadyClosed);
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) => ({ ...alreadyClosed, ...patch } as never),
    );
    const { updateInquiry } = await import('../services/employer-inquiries.service');
    await updateInquiry('inq-1', { status: 'archived' }, adminUser, ctx);
    const updateArg = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateArg.closedAt).toBeUndefined();
  });

  it('throws NotFoundError when inquiry does not exist', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { updateInquiry } = await import('../services/employer-inquiries.service');
    await expect(
      updateInquiry('inq-missing', { status: 'contacted' }, adminUser, ctx),
    ).rejects.toThrow(NotFoundError);
  });

  it('readonly user cannot update', async () => {
    const { updateInquiry } = await import('../services/employer-inquiries.service');
    await expect(
      updateInquiry('inq-1', { status: 'contacted' }, readonlyUser, ctx),
    ).rejects.toThrow(ForbiddenError);
    expect(repo.findById).not.toHaveBeenCalled();
  });
});

describe('employer-inquiries.service.deleteInquiry', () => {
  it('admin can delete + audit BEFORE remove', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseInquiry);
    vi.mocked(repo.remove).mockResolvedValue(true);
    const order: string[] = [];
    vi.mocked(audit.log).mockImplementation(async () => {
      order.push('audit');
    });
    vi.mocked(repo.remove).mockImplementation(async () => {
      order.push('remove');
      return true;
    });
    const { deleteInquiry } = await import('../services/employer-inquiries.service');
    await deleteInquiry('inq-1', adminUser, ctx);
    expect(order).toEqual(['audit', 'remove']);
  });

  it('recruiter cannot delete (admin-only)', async () => {
    const { deleteInquiry } = await import('../services/employer-inquiries.service');
    await expect(deleteInquiry('inq-1', recruiterUser, ctx)).rejects.toThrow(
      ForbiddenError,
    );
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when inquiry missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { deleteInquiry } = await import('../services/employer-inquiries.service');
    await expect(deleteInquiry('inq-missing', adminUser, ctx)).rejects.toThrow(
      NotFoundError,
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
