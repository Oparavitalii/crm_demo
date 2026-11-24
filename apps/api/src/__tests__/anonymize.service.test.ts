import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// Mock the db module BEFORE any imports that use it
vi.mock('../db/client', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    })),
  },
}));

vi.mock('../repositories/candidates.repo', () => ({
  findById: vi.fn(),
  list: vi.fn(),
  findDuplicates: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as candidatesRepo from '../repositories/candidates.repo';
import * as auditService from '../services/audit.service';
import { NotFoundError, ForbiddenError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const ctx = { ip: '1.2.3.4', userAgent: 'test-agent' };

const baseCandidate = {
  id: 'cand-uuid-1234',
  name: 'Anna Kowalska',
  email: 'anna@example.com',
  phone: '+48555111222',
  birthDate: null,
  nationality: 'PL',
  status: 'new' as const,
  recruiterId: null,
  freelancerId: null,
  source: null,
  notes: 'some notes',
  consentId: null,
  processingRestricted: false,
  anonymizedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('anonymizeCandidate', () => {
  it('successfully anonymizes a candidate and returns alreadyAnonymized: false', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue(baseCandidate);
    const { anonymizeCandidate } = await import('../services/anonymize.service');
    const result = await anonymizeCandidate('cand-uuid-1234', adminUser, ctx);
    expect(result.alreadyAnonymized).toBe(false);
    expect(result.anonymizedAt).toBeTruthy();
  });

  it('logs anonymize_candidate audit entry with boolean flags (no PII)', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue(baseCandidate);
    const { anonymizeCandidate } = await import('../services/anonymize.service');
    await anonymizeCandidate('cand-uuid-1234', adminUser, ctx);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'anonymize_candidate',
        entityType: 'candidate',
        entityId: 'cand-uuid-1234',
        oldValue: expect.objectContaining({
          hadEmail: true,
          hadPhone: true,
        }),
      }),
    );
    // Make sure PII email is NOT in the audit oldValue
    const call = vi.mocked(auditService.log).mock.calls[0]?.[0];
    expect(JSON.stringify(call?.oldValue)).not.toContain('anna@example.com');
  });

  it('returns alreadyAnonymized: true and is a no-op when already anonymized', async () => {
    const anonymizedAt = new Date('2024-06-01');
    vi.mocked(candidatesRepo.findById).mockResolvedValue({
      ...baseCandidate,
      anonymizedAt,
      name: 'ANON',
    });
    const { anonymizeCandidate } = await import('../services/anonymize.service');
    const result = await anonymizeCandidate('cand-uuid-1234', adminUser, ctx);
    expect(result.alreadyAnonymized).toBe(true);
    expect(result.anonymizedAt).toBe(anonymizedAt.toISOString());
  });

  it('writes audit row even when candidate is already anonymized', async () => {
    const anonymizedAt = new Date('2024-06-01');
    vi.mocked(candidatesRepo.findById).mockResolvedValue({
      ...baseCandidate,
      anonymizedAt,
      name: 'ANON',
    });
    const { anonymizeCandidate } = await import('../services/anonymize.service');
    await anonymizeCandidate('cand-uuid-1234', adminUser, ctx);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'anonymize_candidate',
        entityId: 'cand-uuid-1234',
        oldValue: expect.objectContaining({ alreadyAnonymized: true }),
      }),
    );
  });

  it('throws NotFoundError if candidate does not exist', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue(undefined);
    const { anonymizeCandidate } = await import('../services/anonymize.service');
    await expect(anonymizeCandidate('no-such-id', adminUser, ctx)).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError if actor is not admin', async () => {
    const { anonymizeCandidate } = await import('../services/anonymize.service');
    await expect(anonymizeCandidate('cand-uuid-1234', recruiterUser, ctx)).rejects.toThrow(ForbiddenError);
    expect(candidatesRepo.findById).not.toHaveBeenCalled();
  });
});
