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
  findDuplicatesOf: vi.fn(),
}));
vi.mock('../repositories/duplicate-ignores.repo', () => ({
  add: vi.fn(),
  remove: vi.fn(),
  listIgnored: vi.fn(),
  pairKey: vi.fn((a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as candidatesRepo from '../repositories/candidates.repo';
import * as ignoresRepo from '../repositories/duplicate-ignores.repo';
import * as audit from '../services/audit.service';
import { NotFoundError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };

const ctx = { ip: '1.2.3.4', userAgent: 'jest' };

// 2026-06-12: candidates.first_name + last_name collapsed into single `name` column.
const baseCandidate: Record<string, unknown> = {
  id: 'cand-1',
  name: 'Anna Kowalska',
  email: 'anna@example.com',
  phone: '+48555111222',
  recruiterId: 'rec-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const dupCandidate: Record<string, unknown> = {
  id: 'cand-2',
  name: 'anna kowalska',
  email: 'ANNA@example.com',
  phone: '+48555111222',
  recruiterId: 'rec-2',
  createdAt: new Date('2026-02-01T00:00:00Z'),
};

beforeEach(() => vi.clearAllMocks());

describe('duplicates.service.getCandidateDuplicates', () => {
  it('returns enriched duplicate records with matchedBy reasons', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue(baseCandidate as never);
    vi.mocked(candidatesRepo.findDuplicatesOf).mockResolvedValue([dupCandidate] as never);
    const { getCandidateDuplicates } = await import('../services/duplicates.service');
    const result = await getCandidateDuplicates('cand-1', adminUser);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('cand-2');
    expect(result[0]?.displayName).toBe('anna kowalska');
    // case-insensitive email match, exact phone, and name match — all 3 reasons
    expect(result[0]?.matchedBy).toEqual(
      expect.arrayContaining(['email', 'phone', 'name']),
    );
  });

  it('throws NotFoundError when target candidate missing', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue(undefined);
    const { getCandidateDuplicates } = await import('../services/duplicates.service');
    await expect(getCandidateDuplicates('cand-x', adminUser)).rejects.toThrow(
      NotFoundError,
    );
    expect(candidatesRepo.findDuplicatesOf).not.toHaveBeenCalled();
  });

  it('recruiter cannot view duplicates of another recruiters candidate (404)', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: 'someone-else',
    } as never);
    const { getCandidateDuplicates } = await import('../services/duplicates.service');
    await expect(
      getCandidateDuplicates('cand-1', recruiterUser),
    ).rejects.toThrow(NotFoundError);
  });

  it('recruiter sees duplicates for their own candidate', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: 'rec-1',
    } as never);
    vi.mocked(candidatesRepo.findDuplicatesOf).mockResolvedValue([dupCandidate] as never);
    const { getCandidateDuplicates } = await import('../services/duplicates.service');
    const result = await getCandidateDuplicates('cand-1', recruiterUser);
    expect(result).toHaveLength(1);
  });

  it('recruiter sees duplicates for unassigned candidate (recruiterId null)', async () => {
    vi.mocked(candidatesRepo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: null,
    } as never);
    vi.mocked(candidatesRepo.findDuplicatesOf).mockResolvedValue([]);
    const { getCandidateDuplicates } = await import('../services/duplicates.service');
    const result = await getCandidateDuplicates('cand-1', recruiterUser);
    expect(result).toEqual([]);
  });
});

describe('duplicates.service.markNotDuplicate', () => {
  it('persists ignore pair and writes audit (candidate type)', async () => {
    vi.mocked(ignoresRepo.add).mockResolvedValue({} as never);
    const { markNotDuplicate } = await import('../services/duplicates.service');
    await markNotDuplicate(
      { entityType: 'candidate', idA: 'cand-1', idB: 'cand-2' },
      adminUser,
      ctx,
    );
    expect(ignoresRepo.add).toHaveBeenCalledWith({
      entityType: 'candidate',
      idA: 'cand-1',
      idB: 'cand-2',
      createdById: 'admin-1',
    });
    expect(audit.log).toHaveBeenCalledOnce();
    const auditArg = vi.mocked(audit.log).mock.calls[0]?.[0];
    expect(auditArg?.action).toBe('mark_not_duplicate');
    expect(auditArg?.entityType).toBe('candidate');
    expect(auditArg?.entityId).toBe('cand-1');
    expect(auditArg?.newValue).toEqual({ otherId: 'cand-2' });
  });

});
