import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// consents.service does not touch `db` directly — it delegates to repos
// and anonymize.service (both mocked below). The db mock stays for safety
// in case a future path reaches the client; it returns empty stubs.
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/client', () => ({
  db: {
    get select() { return mockSelect; },
    get insert() { return mockInsert; },
    get update() { return mockUpdate; },
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    })),
    query: {
      consents: { findFirst: vi.fn() },
      candidates: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('../repositories/consents.repo', () => ({
  findActiveByToken: vi.fn(),
  markWithdrawn: vi.fn(),
}));

vi.mock('../repositories/candidates.repo', () => ({
  findActiveByEmailCi: vi.fn(),
}));

vi.mock('../services/anonymize.service', () => ({
  anonymizeCandidate: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as consentsRepo from '../repositories/consents.repo';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as anonymizeService from '../services/anonymize.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../lib/errors';

const ctx = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (withdraw-link)' };

const activeConsent = {
  id: 'consent-uuid-1',
  candidateEmail: 'jan@example.com',
  candidatePhone: null,
  consentType: 'marketing',
  version: '1.0',
  source: null,
  acceptedAt: new Date('2024-01-01T10:00:00Z'),
  withdrawnAt: null,
  withdrawalToken: '11111111-1111-1111-1111-111111111111',
  ip: null,
  userAgent: null,
};

const fakeCandidate = {
  id: 'cand-uuid-9',
  name: 'Jan Kowalski',
  email: 'jan@example.com',
  phone: '+48123456789',
  anonymizedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('withdrawConsent — happy path', () => {
  it('returns { withdrawn: true, anonymized: true } when consent is valid and a candidate is linked', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(fakeCandidate as any);
    vi.mocked(anonymizeService.anonymizeCandidate).mockResolvedValue({
      alreadyAnonymized: false,
      anonymizedAt: new Date().toISOString(),
    });

    const { withdrawConsent } = await import('../services/consents.service');
    const result = await withdrawConsent(activeConsent.withdrawalToken, ctx);

    expect(result).toEqual({ withdrawn: true, anonymized: true });
    expect(consentsRepo.findActiveByToken).toHaveBeenCalledWith(activeConsent.withdrawalToken);
    expect(consentsRepo.markWithdrawn).toHaveBeenCalledWith(activeConsent.id, ctx);
  });

  it('returns { withdrawn: true, anonymized: false } when no candidate exists for the consent email', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(undefined);

    const { withdrawConsent } = await import('../services/consents.service');
    const result = await withdrawConsent(activeConsent.withdrawalToken, ctx);

    expect(result).toEqual({ withdrawn: true, anonymized: false });
    expect(consentsRepo.markWithdrawn).toHaveBeenCalledOnce();
    expect(anonymizeService.anonymizeCandidate).not.toHaveBeenCalled();
  });

  it('returns anonymized: false when candidate was ALREADY anonymized (idempotent)', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(fakeCandidate as any);
    vi.mocked(anonymizeService.anonymizeCandidate).mockResolvedValue({
      alreadyAnonymized: true,
      anonymizedAt: new Date('2024-05-01').toISOString(),
    });

    const { withdrawConsent } = await import('../services/consents.service');
    const result = await withdrawConsent(activeConsent.withdrawalToken, ctx);

    expect(result).toEqual({ withdrawn: true, anonymized: false });
  });
});

describe('withdrawConsent — invalid / withdrawn token (RODO opacity)', () => {
  it('throws AppError(INVALID_TOKEN, 400) when token is unknown', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(undefined);

    const { withdrawConsent } = await import('../services/consents.service');
    await expect(
      withdrawConsent('22222222-2222-2222-2222-222222222222', ctx),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 400 });
  });

  it('throws same INVALID_TOKEN error when token belongs to an already-withdrawn consent', async () => {
    // The repo applies `withdrawnAt IS NULL` — a withdrawn row returns undefined.
    // The service must NOT leak whether the token was ever real.
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(undefined);

    const { withdrawConsent } = await import('../services/consents.service');
    let caught: unknown;
    try {
      await withdrawConsent(activeConsent.withdrawalToken, ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('INVALID_TOKEN');
    // No mutation should have happened.
    expect(consentsRepo.markWithdrawn).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(anonymizeService.anonymizeCandidate).not.toHaveBeenCalled();
  });
});

describe('withdrawConsent — audit log (RODO compliance)', () => {
  it('writes a withdraw_consent audit row with actorId: null and the request ctx', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(undefined);

    const { withdrawConsent } = await import('../services/consents.service');
    await withdrawConsent(activeConsent.withdrawalToken, ctx);

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        action: 'withdraw_consent',
        entityType: 'consent',
        entityId: activeConsent.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
    );
  });

  it('audit newValue carries boolean flag hadEmail: true, NOT the raw email (PII)', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(undefined);

    const { withdrawConsent } = await import('../services/consents.service');
    await withdrawConsent(activeConsent.withdrawalToken, ctx);

    const call = vi.mocked(auditService.log).mock.calls[0]?.[0];
    expect(call?.newValue).toMatchObject({
      hadEmail: true,
      consentType: 'marketing',
      version: '1.0',
    });
    // Hard assertion: no raw email or candidate name in the audit payload
    expect(JSON.stringify(call?.newValue)).not.toContain('jan@example.com');
    expect(JSON.stringify(call?.newValue)).not.toContain('Jan Kowalski');
  });

  it('records audit BEFORE attempting candidate anonymization (audit-first ordering)', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(fakeCandidate as any);
    vi.mocked(anonymizeService.anonymizeCandidate).mockResolvedValue({
      alreadyAnonymized: false,
      anonymizedAt: new Date().toISOString(),
    });

    const order: string[] = [];
    vi.mocked(consentsRepo.markWithdrawn).mockImplementation(async () => {
      order.push('markWithdrawn');
    });
    vi.mocked(auditService.log).mockImplementation(async () => {
      order.push('audit.log');
    });
    vi.mocked(anonymizeService.anonymizeCandidate).mockImplementation(async () => {
      order.push('anonymizeCandidate');
      return { alreadyAnonymized: false, anonymizedAt: new Date().toISOString() };
    });

    const { withdrawConsent } = await import('../services/consents.service');
    await withdrawConsent(activeConsent.withdrawalToken, ctx);

    // markWithdrawn → audit.log → anonymizeCandidate
    expect(order).toEqual(['markWithdrawn', 'audit.log', 'anonymizeCandidate']);
  });

  it('does NOT write an audit row when token is invalid', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(undefined);
    const { withdrawConsent } = await import('../services/consents.service');
    await expect(withdrawConsent('bad-token', ctx)).rejects.toThrow(AppError);
    expect(auditService.log).not.toHaveBeenCalled();
  });
});

describe('withdrawConsent — anonymization delegation', () => {
  it('calls anonymizeCandidate with the synthetic PUBLIC_SELF actor (admin role, zero-uuid id)', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(fakeCandidate as any);
    vi.mocked(anonymizeService.anonymizeCandidate).mockResolvedValue({
      alreadyAnonymized: false,
      anonymizedAt: new Date().toISOString(),
    });

    const { withdrawConsent } = await import('../services/consents.service');
    await withdrawConsent(activeConsent.withdrawalToken, ctx);

    expect(anonymizeService.anonymizeCandidate).toHaveBeenCalledWith(
      fakeCandidate.id,
      expect.objectContaining({
        id: '00000000-0000-0000-0000-000000000000',
        role: 'admin',
      }),
      ctx,
    );
  });

  it('looks up the candidate case-insensitively by the consent email', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(undefined);

    const { withdrawConsent } = await import('../services/consents.service');
    await withdrawConsent(activeConsent.withdrawalToken, ctx);

    expect(candidatesRepo.findActiveByEmailCi).toHaveBeenCalledWith(activeConsent.candidateEmail);
  });
});

describe('withdrawConsent — ctx propagation', () => {
  it('forwards ip + userAgent to markWithdrawn (proof-of-action trail)', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(undefined);

    const { withdrawConsent } = await import('../services/consents.service');
    await withdrawConsent(activeConsent.withdrawalToken, ctx);

    expect(consentsRepo.markWithdrawn).toHaveBeenCalledWith(activeConsent.id, ctx);
  });

  it('handles null ip / userAgent gracefully', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(undefined);

    const nullCtx = { ip: null, userAgent: null };
    const { withdrawConsent } = await import('../services/consents.service');
    const result = await withdrawConsent(activeConsent.withdrawalToken, nullCtx);

    expect(result).toEqual({ withdrawn: true, anonymized: false });
    expect(consentsRepo.markWithdrawn).toHaveBeenCalledWith(activeConsent.id, nullCtx);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ ip: null, userAgent: null }),
    );
  });
});

describe('withdrawConsent — error propagation', () => {
  it('propagates errors from markWithdrawn (DB failure) without writing audit', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    vi.mocked(consentsRepo.markWithdrawn).mockRejectedValue(new Error('DB down'));

    const { withdrawConsent } = await import('../services/consents.service');
    await expect(withdrawConsent(activeConsent.withdrawalToken, ctx)).rejects.toThrow('DB down');
    expect(auditService.log).not.toHaveBeenCalled();
    expect(anonymizeService.anonymizeCandidate).not.toHaveBeenCalled();
  });

  it('propagates errors from anonymizeCandidate (after audit row was written)', async () => {
    vi.mocked(consentsRepo.findActiveByToken).mockResolvedValue(activeConsent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(candidatesRepo.findActiveByEmailCi).mockResolvedValue(fakeCandidate as any);
    vi.mocked(anonymizeService.anonymizeCandidate).mockRejectedValue(new Error('anon failed'));

    const { withdrawConsent } = await import('../services/consents.service');
    await expect(withdrawConsent(activeConsent.withdrawalToken, ctx)).rejects.toThrow('anon failed');
    // The withdrawal audit row must already exist — the trail survives.
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'withdraw_consent' }),
    );
  });
});
