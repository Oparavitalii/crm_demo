import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/audit-log.repo', () => ({
  insert: vi.fn(),
  list: vi.fn(),
}));
vi.mock('../repositories/consent-history.repo', () => ({
  list: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/audit-log.repo';
import * as consentHistoryRepo from '../repositories/consent-history.repo';
import { ForbiddenError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };

const baseEntry = {
  id: 'audit-1',
  actorId: 'admin-1',
  action: 'create_candidate',
  entityType: 'candidate',
  entityId: 'cand-1',
  oldValue: null,
  newValue: { email: 'x@y.com' },
  ip: '1.2.3.4',
  userAgent: 'test',
  createdAt: new Date('2024-01-01'),
  actorFirstName: 'Anna',
  actorLastName: 'K.',
};

beforeEach(() => vi.clearAllMocks());

describe('audit-log.service.listAuditLog', () => {
  it('returns items and pagination for admin', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [baseEntry], total: 1 });
    const { listAuditLog } = await import('../services/audit-log.service');
    const result = await listAuditLog({ page: 1, pageSize: 20 }, adminUser);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('passes query filters to repo.list', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [], total: 0 });
    const { listAuditLog } = await import('../services/audit-log.service');
    const query = {
      page: 2,
      pageSize: 10,
      action: 'anonymize_candidate',
      entityType: 'candidate',
      entityId: 'cand-99',
    };
    await listAuditLog(query, adminUser);
    expect(repo.list).toHaveBeenCalledWith(query);
  });

  it('throws ForbiddenError for non-admin role', async () => {
    const { listAuditLog } = await import('../services/audit-log.service');
    await expect(listAuditLog({ page: 1, pageSize: 20 }, recruiterUser)).rejects.toThrow(ForbiddenError);
    expect(repo.list).not.toHaveBeenCalled();
  });
});

// "Історія згод" tab — admin-only list of consent grant/withdraw records.
describe('audit-log.service.listConsentHistory', () => {
  const consentItem = {
    id: 'consent-1',
    candidateName: 'Jan Kowalski',
    candidateEmail: 'jan@example.com',
    candidatePhone: null,
    consentType: 'email_marketing',
    source: 're_consent_email',
    acceptedAt: '2026-06-01T10:00:00.000Z',
    withdrawnAt: null,
    ip: '203.0.113.7',
  };

  it('returns the repo result shaped with pagination for admin', async () => {
    vi.mocked(consentHistoryRepo.list).mockResolvedValue({ items: [consentItem], total: 1 });
    const { listConsentHistory } = await import('../services/audit-log.service');
    const result = await listConsentHistory({ page: 1, pageSize: 20 }, adminUser);

    expect(result).toEqual({ items: [consentItem], total: 1, page: 1, pageSize: 20 });
    expect(consentHistoryRepo.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('passes filters (consentType / status / q) through to the repo', async () => {
    vi.mocked(consentHistoryRepo.list).mockResolvedValue({ items: [], total: 0 });
    const { listConsentHistory } = await import('../services/audit-log.service');
    const query = {
      page: 2,
      pageSize: 10,
      consentType: 'sms_marketing' as const,
      status: 'withdrawn' as const,
      q: 'jan',
    };
    await listConsentHistory(query, adminUser);
    expect(consentHistoryRepo.list).toHaveBeenCalledWith(query);
  });

  it('throws ForbiddenError for a non-admin role and never touches the repo', async () => {
    const { listConsentHistory } = await import('../services/audit-log.service');
    await expect(
      listConsentHistory({ page: 1, pageSize: 20 }, recruiterUser),
    ).rejects.toThrow(ForbiddenError);
    expect(consentHistoryRepo.list).not.toHaveBeenCalled();
  });
});
