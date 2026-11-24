import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/candidates.repo', () => ({
  findById: vi.fn(),
}));
vi.mock('../repositories/dismissals.repo', () => ({
  listByCandidate: vi.fn(),
}));
vi.mock('../repositories/audit-log.repo', () => ({
  insert: vi.fn(),
  list: vi.fn(),
  listAll: vi.fn(),
  listByEntityIds: vi.fn(),
}));
vi.mock('../db/client', () => ({
  db: {
    query: {
      messages: { findMany: vi.fn() },
      consents: { findFirst: vi.fn() },
    },
  },
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as candidatesRepo from '../repositories/candidates.repo';
import * as dismissalsRepo from '../repositories/dismissals.repo';
import * as auditLogRepo from '../repositories/audit-log.repo';
import { db } from '../db/client';
import { NotFoundError, ForbiddenError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };

const baseCandidate = {
  id: 'cand-1',
  name: 'Anna Kowalska',
  email: 'anna@example.com',
  phone: '+48555111222',
  birthDate: null,
  nationality: null,
  status: 'new' as const,
  recruiterId: null,
  freelancerId: null,
  source: null,
  notes: null,
  consentId: null,
  processingRestricted: false,
  anonymizedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  workStartDate: null,
  workEndDate: null,
  workEndReason: null,
  projectId: null,
  reasonNote: null,
  kind: 'candidate' as const,
  coordinatorId: null,
  housingType: null,
  documentsSubmittedAt: null,
  arrivedAt: null,
  position: null,
  legalStatus: null,
  reconciliationPeriod: null,
  workOutcome: null,
  payoutStatus: null,
  paymentStatus: null,
  retention: null,
  messenger: null,
  experience: null,
};

beforeEach(() => vi.clearAllMocks());

describe('export.service.exportCandidate', () => {
  it('returns complete export shape for admin', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue(baseCandidate);
    vi.mocked(dismissalsRepo.listByCandidate).mockResolvedValue([]);
    vi.mocked(auditLogRepo.listByEntityIds).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked((db.query.messages as any).findMany).mockResolvedValue([]);

    const { exportCandidate } = await import('../services/export.service');
    const result = await exportCandidate('cand-1', adminUser);

    expect(result.candidate).toMatchObject({ id: 'cand-1', email: 'anna@example.com' });
    expect(result.dismissals).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(result.auditLog).toEqual([]);
    expect(result.consent).toBeNull();
  });

  it('throws NotFoundError if candidate does not exist', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue(undefined);
    const { exportCandidate } = await import('../services/export.service');
    await expect(exportCandidate('no-such', adminUser)).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError for non-admin', async () => {
    const { exportCandidate } = await import('../services/export.service');
    await expect(exportCandidate('cand-1', recruiterUser)).rejects.toThrow(ForbiddenError);
    expect(candidatesRepo.findById).not.toHaveBeenCalled();
  });

  it('fetches audit entries for all related entity IDs (C-1+C-2: no pagination cap, cross-entity)', async () => {
    const dismissal = { id: 'dis-1', candidateId: 'cand-1' };
    const message = { id: 'msg-1', candidateId: 'cand-1' };

    vi.mocked(candidatesRepo.findById).mockResolvedValue(baseCandidate);
    vi.mocked(dismissalsRepo.listByCandidate).mockResolvedValue([dismissal as never]);
    vi.mocked(auditLogRepo.listByEntityIds).mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked((db.query.messages as any).findMany).mockResolvedValue([message]);

    const { exportCandidate } = await import('../services/export.service');
    await exportCandidate('cand-1', adminUser);

    // Should call listByEntityIds with candidate + dismissal + message IDs
    expect(auditLogRepo.listByEntityIds).toHaveBeenCalledWith(
      expect.arrayContaining(['cand-1', 'dis-1', 'msg-1']),
    );
    // Must NOT fall back to old single-entity list()
    expect(auditLogRepo.list).not.toHaveBeenCalled();
  });
});
