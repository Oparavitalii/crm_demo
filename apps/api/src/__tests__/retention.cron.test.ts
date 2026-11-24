import { describe, it, expect, vi, beforeEach } from 'vitest';

// Env stubs MUST be in place before any module under test imports `env`.
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// db is reached only transitively by anonymize.service (which we mock here).
// Stub it anyway so any accidental import does not blow up at module-load.
vi.mock('../db/client', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      }),
    ),
  },
}));

vi.mock('../repositories/sessions.repo', () => ({
  deleteExpired: vi.fn(),
  deleteRotatedBefore: vi.fn(),
}));
vi.mock('../repositories/password-reset-tokens.repo', () => ({
  deleteExpired: vi.fn(),
}));
vi.mock('../repositories/audit-log.repo', () => ({
  purgeOlderThan: vi.fn(),
  insert: vi.fn(),
}));
vi.mock('../repositories/candidates.repo', () => ({
  findInactiveCandidateIds: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../services/anonymize.service', () => ({
  anonymizeCandidate: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as sessionsRepo from '../repositories/sessions.repo';
import * as resetRepo from '../repositories/password-reset-tokens.repo';
import * as auditLogRepo from '../repositories/audit-log.repo';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as auditService from '../services/audit.service';
import * as anonymizeService from '../services/anonymize.service';
import { runRetention } from '../cron/retention';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults — individual tests override per-branch.
  vi.mocked(sessionsRepo.deleteExpired).mockResolvedValue(0);
  vi.mocked(sessionsRepo.deleteRotatedBefore).mockResolvedValue(0);
  vi.mocked(resetRepo.deleteExpired).mockResolvedValue(0);
  vi.mocked(auditLogRepo.purgeOlderThan).mockResolvedValue(0);
  vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue([]);
  vi.mocked(anonymizeService.anonymizeCandidate).mockResolvedValue({
    alreadyAnonymized: false,
    anonymizedAt: new Date().toISOString(),
  });
  vi.mocked(auditService.log).mockResolvedValue(undefined);
});

describe('cron/retention — session + token cleanup', () => {
  it('calls sessionsRepo.deleteExpired exactly once per sweep', async () => {
    vi.mocked(sessionsRepo.deleteExpired).mockResolvedValue(17);

    await runRetention();

    expect(sessionsRepo.deleteExpired).toHaveBeenCalledTimes(1);
    expect(sessionsRepo.deleteExpired).toHaveBeenCalledWith();
  });

  it('calls password-reset deleteExpired exactly once per sweep', async () => {
    vi.mocked(resetRepo.deleteExpired).mockResolvedValue(5);

    await runRetention();

    expect(resetRepo.deleteExpired).toHaveBeenCalledTimes(1);
    expect(resetRepo.deleteExpired).toHaveBeenCalledWith();
  });

  it('sweeps rotation tombstones with a ~24h cutoff', async () => {
    const before = Date.now();
    await runRetention();
    const after = Date.now();

    expect(sessionsRepo.deleteRotatedBefore).toHaveBeenCalledTimes(1);
    const cutoff = vi.mocked(sessionsRepo.deleteRotatedBefore).mock.calls[0]?.[0];
    expect(cutoff).toBeInstanceOf(Date);
    // Cutoff must sit ~24h in the past (well above access TTL + grace window).
    expect(cutoff!.getTime()).toBeGreaterThanOrEqual(before - DAY_MS - 1000);
    expect(cutoff!.getTime()).toBeLessThanOrEqual(after - DAY_MS + 1000);
  });
});

describe('cron/retention — audit log purge', () => {
  it('passes a cutoff ~5 years in the past to purgeOlderThan', async () => {
    const before = Date.now();
    await runRetention();
    const after = Date.now();

    expect(auditLogRepo.purgeOlderThan).toHaveBeenCalledTimes(1);
    const cutoff = vi.mocked(auditLogRepo.purgeOlderThan).mock.calls[0]?.[0];
    expect(cutoff).toBeInstanceOf(Date);
    const cutoffMs = (cutoff as Date).getTime();

    // 5y window with a day of slack on both sides for leap years + clock drift.
    const fiveYearsBefore = before - 5 * YEAR_MS;
    const fiveYearsAfter = after - 5 * YEAR_MS;
    expect(cutoffMs).toBeGreaterThanOrEqual(fiveYearsBefore - DAY_MS);
    expect(cutoffMs).toBeLessThanOrEqual(fiveYearsAfter + DAY_MS);
  });

  it('does NOT call purgeOlderThan with a cutoff < 5 years ago (rows under retention stay)', async () => {
    await runRetention();
    const cutoff = vi.mocked(auditLogRepo.purgeOlderThan).mock.calls[0]?.[0] as Date;
    const fourYearsAgo = Date.now() - 4 * YEAR_MS;
    // The retention cutoff must be older than 4 years ago — anything newer than
    // the cutoff is kept, so a < 4y row is provably untouched.
    expect(cutoff.getTime()).toBeLessThan(fourYearsAgo);
  });
});

describe('cron/retention — anonymize inactive candidates', () => {
  it('anonymizes every id returned by the repo (inactive > 3 years branch)', async () => {
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue([
      'cand-1',
      'cand-2',
      'cand-3',
    ]);

    await runRetention();

    expect(anonymizeService.anonymizeCandidate).toHaveBeenCalledTimes(3);
    const calledIds = vi
      .mocked(anonymizeService.anonymizeCandidate)
      .mock.calls.map((c) => c[0]);
    expect(calledIds).toEqual(['cand-1', 'cand-2', 'cand-3']);
  });

  it('passes a cutoff ~3 years in the past to findInactiveCandidateIds', async () => {
    const before = Date.now();
    await runRetention();
    const after = Date.now();

    expect(candidatesRepo.findInactiveCandidateIds).toHaveBeenCalledTimes(1);
    const [cutoff, limit] = vi.mocked(candidatesRepo.findInactiveCandidateIds).mock
      .calls[0]!;
    expect(cutoff).toBeInstanceOf(Date);
    const cutoffMs = (cutoff as Date).getTime();
    const threeYearsBefore = before - 3 * YEAR_MS;
    const threeYearsAfter = after - 3 * YEAR_MS;
    expect(cutoffMs).toBeGreaterThanOrEqual(threeYearsBefore - DAY_MS);
    expect(cutoffMs).toBeLessThanOrEqual(threeYearsAfter + DAY_MS);
    // Batch limit is bounded — proves we never sweep unbounded.
    expect(limit).toBe(200);
  });

  it('SKIPS anonymization branch entirely when the repo returns 0 inactive candidates', async () => {
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue([]);

    await runRetention();

    expect(anonymizeService.anonymizeCandidate).not.toHaveBeenCalled();
    // No retention_sweep audit row is written for empty batches — keeps the
    // audit log clean when there's nothing to do.
    const sweepCalls = vi
      .mocked(auditService.log)
      .mock.calls.filter((c) => c[0]?.action === 'retention_sweep');
    expect(sweepCalls).toHaveLength(0);
  });

  it('treats already-anonymized rows as idempotent (does NOT inflate anonymized counter)', async () => {
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue([
      'cand-fresh',
      'cand-already',
    ]);
    vi.mocked(anonymizeService.anonymizeCandidate)
      .mockResolvedValueOnce({ alreadyAnonymized: false, anonymizedAt: '2026-01-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ alreadyAnonymized: true, anonymizedAt: '2024-01-01T00:00:00.000Z' });

    await runRetention();

    const sweepCall = vi
      .mocked(auditService.log)
      .mock.calls.find((c) => c[0]?.action === 'retention_sweep');
    expect(sweepCall).toBeDefined();
    const newValue = sweepCall![0].newValue as {
      candidatesAnonymized: number;
      batchSize: number;
    };
    // Only the first call counted; the already-anonymized one is a no-op.
    expect(newValue.candidatesAnonymized).toBe(1);
    expect(newValue.batchSize).toBe(2);
  });

  it('writes retention_sweep audit row with actorId=null (system actor) and cron marker', async () => {
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue(['cand-1']);

    await runRetention();

    const sweepCall = vi
      .mocked(auditService.log)
      .mock.calls.find((c) => c[0]?.action === 'retention_sweep');
    expect(sweepCall).toBeDefined();
    const entry = sweepCall![0];
    expect(entry.actorId).toBeNull();
    expect(entry.entityType).toBe('system');
    expect(entry.entityId).toBeNull();
    expect(entry.userAgent).toBe('cron/retention');
    expect(entry.ip).toBeNull();
    const newValue = entry.newValue as {
      candidatesAnonymized: number;
      batchSize: number;
      cutoffYears: number;
      sourceHash: string;
    };
    expect(newValue.cutoffYears).toBe(3);
    expect(newValue.sourceHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('one candidate failing does NOT abort the batch — remaining ids still processed', async () => {
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue([
      'cand-a',
      'cand-boom',
      'cand-c',
    ]);
    vi.mocked(anonymizeService.anonymizeCandidate)
      .mockResolvedValueOnce({ alreadyAnonymized: false, anonymizedAt: 't' })
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockResolvedValueOnce({ alreadyAnonymized: false, anonymizedAt: 't' });

    await runRetention();

    expect(anonymizeService.anonymizeCandidate).toHaveBeenCalledTimes(3);
    const sweepCall = vi
      .mocked(auditService.log)
      .mock.calls.find((c) => c[0]?.action === 'retention_sweep');
    expect(sweepCall).toBeDefined();
    const newValue = sweepCall![0].newValue as {
      candidatesAnonymized: number;
      batchSize: number;
    };
    expect(newValue.candidatesAnonymized).toBe(2);
    expect(newValue.batchSize).toBe(3);
  });
});

describe('cron/retention — step isolation', () => {
  it('failure in session cleanup does NOT prevent reset-token / audit-purge / anonymize from running', async () => {
    vi.mocked(sessionsRepo.deleteExpired).mockRejectedValueOnce(
      new Error('db down'),
    );
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue(['cand-1']);

    await expect(runRetention()).resolves.toBeUndefined();

    expect(resetRepo.deleteExpired).toHaveBeenCalledTimes(1);
    expect(auditLogRepo.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(candidatesRepo.findInactiveCandidateIds).toHaveBeenCalledTimes(1);
    expect(anonymizeService.anonymizeCandidate).toHaveBeenCalledTimes(1);
  });

  it('failure in audit-log purge does NOT prevent the anonymize branch', async () => {
    vi.mocked(auditLogRepo.purgeOlderThan).mockRejectedValueOnce(
      new Error('purge boom'),
    );
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockResolvedValue(['cand-x']);

    await expect(runRetention()).resolves.toBeUndefined();

    expect(anonymizeService.anonymizeCandidate).toHaveBeenCalledWith(
      'cand-x',
      expect.objectContaining({ role: 'admin' }),
      expect.objectContaining({ userAgent: 'cron/retention' }),
    );
  });

  it('failure in findInactiveCandidateIds does NOT propagate out of runRetention', async () => {
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockRejectedValueOnce(
      new Error('query boom'),
    );

    await expect(runRetention()).resolves.toBeUndefined();
    // Earlier branches still ran.
    expect(sessionsRepo.deleteExpired).toHaveBeenCalledTimes(1);
    expect(resetRepo.deleteExpired).toHaveBeenCalledTimes(1);
    expect(auditLogRepo.purgeOlderThan).toHaveBeenCalledTimes(1);
  });
});

describe('cron/retention — order of operations', () => {
  it('runs steps in order: sessions → reset tokens → audit purge → anonymize', async () => {
    const callOrder: string[] = [];
    vi.mocked(sessionsRepo.deleteExpired).mockImplementation(async () => {
      callOrder.push('sessions');
      return 0;
    });
    vi.mocked(resetRepo.deleteExpired).mockImplementation(async () => {
      callOrder.push('reset');
      return 0;
    });
    vi.mocked(auditLogRepo.purgeOlderThan).mockImplementation(async () => {
      callOrder.push('audit-purge');
      return 0;
    });
    vi.mocked(candidatesRepo.findInactiveCandidateIds).mockImplementation(async () => {
      callOrder.push('find-inactive');
      return [];
    });

    await runRetention();

    expect(callOrder).toEqual(['sessions', 'reset', 'audit-purge', 'find-inactive']);
  });
});
