import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// consents.service delegates everything to repos + audit (all mocked below);
// it never touches `db` directly. The db mock is a safety net in case a future
// path reaches the client.
vi.mock('../db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    query: {
      consents: { findFirst: vi.fn() },
      consentOptinTokens: { findFirst: vi.fn() },
      candidates: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('../repositories/consents.repo', () => ({
  // withdraw-flow exports (unused here, present so the module shape is complete)
  findActiveByToken: vi.fn(),
  markWithdrawn: vi.fn(),
  // preference-center (set-state) exports — the subject of this file
  findUsableOptinToken: vi.fn(),
  findActiveConsentByType: vi.fn(),
  insertConsent: vi.fn(),
  withdrawActiveConsentByType: vi.fn(),
  markOptinConsumed: vi.fn(),
  createOptinToken: vi.fn(),
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
import * as auditService from '../services/audit.service';
import { AppError } from '../lib/errors';
import { CONSENT_SOURCES, CONSENT_TYPES, CONSENT_VERSIONS } from '@opushr/shared';

const ctx = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (confirm-link)' };

interface TokenRowOpts {
  email?: string | null;
  phone?: string | null;
}
// Build a ConsentOptinToken-shaped row. Cast at the call site keeps the fixture
// terse while satisfying the repo's return type.
function tokenRow(opts: TokenRowOpts = {}) {
  return {
    id: 'optin-uuid-1',
    token: '11111111-1111-1111-1111-111111111111',
    candidateId: 'cand-uuid-9',
    candidateEmail: opts.email === undefined ? 'jan@example.com' : opts.email,
    candidatePhone: opts.phone === undefined ? '+48123456789' : opts.phone,
    createdAt: new Date('2026-06-01T10:00:00Z'),
    expiresAt: new Date('2026-08-01T10:00:00Z'),
    consumedAt: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// A stand-in for an ACTIVE consent row returned by findActiveConsentByType. The
// exact shape doesn't matter — the service only checks truthiness.
const activeConsent = {
  id: 'consent-existing-1',
  candidateEmail: 'jan@example.com',
  candidatePhone: '+48123456789',
  consentType: CONSENT_TYPES.emailMarketing,
  version: CONSENT_VERSIONS.emailMarketing,
  source: CONSENT_SOURCES.reConsentEmail,
  acceptedAt: new Date(),
  withdrawnAt: null,
  withdrawalToken: 'aaaa',
  ip: null,
  userAgent: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

beforeEach(() => {
  vi.resetAllMocks();
});

// confirmConsent is now a preference-center SET. `channels` is the desired ON
// set: an applicable channel present → ensured active, absent → withdrawn.
// The token is NEVER consumed (markOptinConsumed must not fire). The returned
// {confirmed, channels} is computed from a FRESH read of currentState, not from
// what was requested — so idempotent re-submits still report the true state.
//
// currentState AND ensureActiveConsent both call findActiveConsentByType, so we
// drive them by call ORDER: the ensure checks run first (sequential awaits),
// then the two currentState reads (email, then sms — Promise.all array order).

describe('confirmConsent — set-state: both channels ON', () => {
  it('ensures email + sms (both inserted), never withdraws, returns both channels', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(
      tokenRow({ email: 'jan@example.com', phone: '+48123456789' }),
    );
    // ensure-email (none) → insert, ensure-sms (none) → insert, then both
    // currentState reads report active.
    vi.mocked(consentsRepo.findActiveConsentByType)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(activeConsent);

    const { confirmConsent } = await import('../services/consents.service');
    const result = await confirmConsent(
      '11111111-1111-1111-1111-111111111111',
      ['email', 'sms'],
      ctx,
    );

    expect(result).toEqual({ confirmed: true, channels: ['email', 'sms'] });

    // Both channels ensured (inserted, since none existed).
    expect(consentsRepo.insertConsent).toHaveBeenCalledTimes(2);
    expect(consentsRepo.insertConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        consentType: CONSENT_TYPES.emailMarketing,
        version: CONSENT_VERSIONS.emailMarketing,
        source: CONSENT_SOURCES.reConsentEmail,
        candidateEmail: 'jan@example.com',
        candidatePhone: null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
    );
    expect(consentsRepo.insertConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        consentType: CONSENT_TYPES.smsMarketing,
        version: CONSENT_VERSIONS.smsMarketing,
        source: CONSENT_SOURCES.reConsentEmail,
        candidateEmail: 'jan@example.com',
        candidatePhone: '+48123456789',
      }),
    );

    // Nothing withdrawn — every requested channel was ON.
    expect(consentsRepo.withdrawActiveConsentByType).not.toHaveBeenCalled();
    // Token is NOT consumed — the manage link keeps working until it expires.
    expect(consentsRepo.markOptinConsumed).not.toHaveBeenCalled();

    // Audit trail: confirm_consent on the candidate, booleans not raw PII.
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        action: 'confirm_consent',
        entityType: 'candidate',
        entityId: 'cand-uuid-9',
        newValue: expect.objectContaining({ channels: ['email', 'sms'] }),
      }),
    );
  });
});

describe('confirmConsent — set-state: turn one channel OFF', () => {
  it('email ON keeps/creates email, sms absent WITHDRAWS the active sms consent', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(
      tokenRow({ email: 'jan@example.com', phone: '+48123456789' }),
    );
    // ensure-email (none) → insert email; currentState email → active, sms → gone.
    vi.mocked(consentsRepo.findActiveConsentByType)
      .mockResolvedValueOnce(undefined) // ensure email
      .mockResolvedValueOnce(activeConsent) // currentState email
      .mockResolvedValueOnce(undefined); // currentState sms

    const { confirmConsent } = await import('../services/consents.service');
    const result = await confirmConsent('11111111-1111-1111-1111-111111111111', ['email'], ctx);

    expect(result).toEqual({ confirmed: true, channels: ['email'] });

    // Email ensured.
    expect(consentsRepo.insertConsent).toHaveBeenCalledTimes(1);
    expect(consentsRepo.insertConsent).toHaveBeenCalledWith(
      expect.objectContaining({ consentType: CONSENT_TYPES.emailMarketing }),
    );

    // SMS (absent from the ON set) is explicitly withdrawn — set-state semantics.
    expect(consentsRepo.withdrawActiveConsentByType).toHaveBeenCalledTimes(1);
    expect(consentsRepo.withdrawActiveConsentByType).toHaveBeenCalledWith(
      {
        consentType: CONSENT_TYPES.smsMarketing,
        email: 'jan@example.com',
        phone: '+48123456789',
      },
      ctx,
    );
    expect(consentsRepo.markOptinConsumed).not.toHaveBeenCalled();
  });
});

describe('confirmConsent — set-state: empty channels turns everything OFF', () => {
  it('withdraws both email and sms, inserts nothing, returns confirmed=false', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(
      tokenRow({ email: 'jan@example.com', phone: '+48123456789' }),
    );
    // No active rows anywhere → currentState reads both undefined.
    vi.mocked(consentsRepo.findActiveConsentByType).mockResolvedValue(undefined);

    const { confirmConsent } = await import('../services/consents.service');
    const result = await confirmConsent('11111111-1111-1111-1111-111111111111', [], ctx);

    expect(result).toEqual({ confirmed: false, channels: [] });

    expect(consentsRepo.insertConsent).not.toHaveBeenCalled();
    expect(consentsRepo.withdrawActiveConsentByType).toHaveBeenCalledTimes(2);
    expect(consentsRepo.withdrawActiveConsentByType).toHaveBeenCalledWith(
      { consentType: CONSENT_TYPES.emailMarketing, email: 'jan@example.com', phone: null },
      ctx,
    );
    expect(consentsRepo.withdrawActiveConsentByType).toHaveBeenCalledWith(
      { consentType: CONSENT_TYPES.smsMarketing, email: 'jan@example.com', phone: '+48123456789' },
      ctx,
    );
    expect(consentsRepo.markOptinConsumed).not.toHaveBeenCalled();
  });
});

describe('confirmConsent — token is never consumed', () => {
  it('does NOT call markOptinConsumed even on a full happy-path set', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(
      tokenRow({ email: 'jan@example.com', phone: '+48123456789' }),
    );
    vi.mocked(consentsRepo.findActiveConsentByType).mockResolvedValue(activeConsent);

    const { confirmConsent } = await import('../services/consents.service');
    await confirmConsent('11111111-1111-1111-1111-111111111111', ['email', 'sms'], ctx);

    expect(consentsRepo.markOptinConsumed).not.toHaveBeenCalled();
  });
});

describe('confirmConsent — invalid / expired / consumed token', () => {
  it('throws AppError(INVALID_TOKEN, 400) and mutates nothing when the token is not usable', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(undefined);

    const { confirmConsent } = await import('../services/consents.service');
    let caught: unknown;
    try {
      await confirmConsent('22222222-2222-2222-2222-222222222222', ['email'], ctx);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('INVALID_TOKEN');
    expect((caught as AppError).status).toBe(400);

    expect(consentsRepo.insertConsent).not.toHaveBeenCalled();
    expect(consentsRepo.withdrawActiveConsentByType).not.toHaveBeenCalled();
    expect(consentsRepo.markOptinConsumed).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });
});

describe('getOptinTokenInfo', () => {
  it('returns hasEmail/hasPhone + current emailConsent/smsConsent (email + phone token)', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(
      tokenRow({ email: 'jan@example.com', phone: '+48123456789' }),
    );
    // currentState: email read → active, sms read → none.
    vi.mocked(consentsRepo.findActiveConsentByType)
      .mockResolvedValueOnce(activeConsent)
      .mockResolvedValueOnce(undefined);

    const { getOptinTokenInfo } = await import('../services/consents.service');
    const info = await getOptinTokenInfo('11111111-1111-1111-1111-111111111111');

    expect(info).toEqual({
      hasEmail: true,
      hasPhone: true,
      emailConsent: true,
      smsConsent: false,
    });
  });

  it('email-only token: no phone, reports email/sms consent state', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(
      tokenRow({ email: 'jan@example.com', phone: null }),
    );
    vi.mocked(consentsRepo.findActiveConsentByType)
      .mockResolvedValueOnce(activeConsent) // email read
      .mockResolvedValueOnce(undefined); // sms read (email-keyed)

    const { getOptinTokenInfo } = await import('../services/consents.service');
    const info = await getOptinTokenInfo('tok');

    expect(info).toEqual({
      hasEmail: true,
      hasPhone: false,
      emailConsent: true,
      smsConsent: false,
    });
  });

  it('phone-only token: no email read, sms consent reflected', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(
      tokenRow({ email: null, phone: '+48123456789' }),
    );
    // Only the sms read happens (email is null → skipped in currentState).
    vi.mocked(consentsRepo.findActiveConsentByType).mockResolvedValue(activeConsent);

    const { getOptinTokenInfo } = await import('../services/consents.service');
    const info = await getOptinTokenInfo('tok');

    expect(info).toEqual({
      hasEmail: false,
      hasPhone: true,
      emailConsent: false,
      smsConsent: true,
    });
  });

  it('throws AppError(INVALID_TOKEN, 400) for a missing / expired / consumed token', async () => {
    vi.mocked(consentsRepo.findUsableOptinToken).mockResolvedValue(undefined);

    const { getOptinTokenInfo } = await import('../services/consents.service');
    await expect(getOptinTokenInfo('bad')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      status: 400,
    });
  });
});
