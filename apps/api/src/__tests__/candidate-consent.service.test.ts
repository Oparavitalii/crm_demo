import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// Staff-side consent actions on candidates.service: adminSetConsent (admin
// override, ensure/withdraw + audit), sendConsentRequest (mint token + email a
// confirm link) and sendConsentRequestsBulk (best-effort fan-out). All
// collaborators are mocked at the module boundary.
vi.mock('../db/client', () => ({
  db: {
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
    insert: vi.fn(() => ({ values: () => ({ returning: async () => [{ id: 'x' }] }) })),
  },
}));

vi.mock('../repositories/candidates.repo', () => ({
  findByIdEnriched: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('../repositories/consents.repo', () => ({
  findActiveConsentByType: vi.fn(),
  insertConsent: vi.fn(),
  withdrawActiveConsentByType: vi.fn(),
  createOptinToken: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../services/onboarding.service', () => ({ sendWelcomeEmailOnCreate: vi.fn() }));
vi.mock('../services/email.service', () => ({
  sendConsentRequestEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendInvitationEmail: vi.fn(),
  sendAccountLockedEmail: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/candidates.repo';
import * as consentsRepo from '../repositories/consents.repo';
import * as audit from '../services/audit.service';
import { sendConsentRequestEmail } from '../services/email.service';
import { CONSENT_SOURCES, CONSENT_TYPES, CONSENT_VERSIONS } from '@opushr/shared';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const ctx = { ip: '203.0.113.9', userAgent: 'staff-ua' };

// Minimal EnrichedCandidate — only the fields adminSetConsent / send* read
// (email, phone, name, recruiterId/coordinatorId for canSee). Cast to `never`
// so we don't have to spell the whole row.
function enriched(overrides: Record<string, unknown>) {
  return {
    id: 'cand-1',
    name: 'Anna Kowalska',
    email: 'anna@example.com',
    phone: '+48555111222',
    recruiterId: null,
    coordinatorId: null,
    kind: 'candidate',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe('candidates.service.adminSetConsent', () => {
  it('email:true inserts an admin_override consent when none is active', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({ phone: null }));
    vi.mocked(consentsRepo.findActiveConsentByType).mockResolvedValue(undefined);

    const { adminSetConsent } = await import('../services/candidates.service');
    const result = await adminSetConsent('cand-1', { email: true, sms: false }, adminUser, ctx);

    expect(consentsRepo.insertConsent).toHaveBeenCalledTimes(1);
    expect(consentsRepo.insertConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateEmail: 'anna@example.com',
        consentType: CONSENT_TYPES.emailMarketing,
        version: CONSENT_VERSIONS.emailMarketing,
        source: CONSENT_SOURCES.adminOverride,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'admin_set_consent',
        entityType: 'candidate',
        entityId: 'cand-1',
        newValue: { email: true, sms: false },
      }),
    );
    expect(result).toEqual({ emailConsent: true, smsConsent: false });
  });

  it('email:true skips the insert when an active email consent already exists', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({ phone: null }));
    // The single findActiveConsentByType call (email) already returns an active row.
    vi.mocked(consentsRepo.findActiveConsentByType).mockResolvedValue({ id: 'c-existing' } as never);

    const { adminSetConsent } = await import('../services/candidates.service');
    const result = await adminSetConsent('cand-1', { email: true, sms: false }, adminUser, ctx);

    expect(consentsRepo.insertConsent).not.toHaveBeenCalled();
    expect(result.emailConsent).toBe(true);
  });

  it('email:false withdraws the active email consent (set-state OFF)', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({ phone: null }));

    const { adminSetConsent } = await import('../services/candidates.service');
    const result = await adminSetConsent('cand-1', { email: false, sms: false }, adminUser, ctx);

    expect(consentsRepo.insertConsent).not.toHaveBeenCalled();
    expect(consentsRepo.withdrawActiveConsentByType).toHaveBeenCalledWith(
      { consentType: CONSENT_TYPES.emailMarketing, email: 'anna@example.com', phone: null },
      ctx,
    );
    expect(result).toEqual({ emailConsent: false, smsConsent: false });
  });

  it('sms:true on a phone-only candidate inserts an sms admin_override consent', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({ email: null }));
    vi.mocked(consentsRepo.findActiveConsentByType).mockResolvedValue(undefined);

    const { adminSetConsent } = await import('../services/candidates.service');
    const result = await adminSetConsent('cand-1', { email: false, sms: true }, adminUser, ctx);

    // Email branch skipped (no email); sms inserted keyed on phone.
    expect(consentsRepo.insertConsent).toHaveBeenCalledTimes(1);
    expect(consentsRepo.insertConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateEmail: null,
        candidatePhone: '+48555111222',
        consentType: CONSENT_TYPES.smsMarketing,
        source: CONSENT_SOURCES.adminOverride,
      }),
    );
    expect(result).toEqual({ emailConsent: false, smsConsent: true });
  });

  it('throws NOT_FOUND when the candidate is not visible to the actor', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({ recruiterId: 'someone-else' }));

    const { adminSetConsent } = await import('../services/candidates.service');
    await expect(
      adminSetConsent('cand-1', { email: true, sms: true }, recruiterUser, ctx),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(consentsRepo.insertConsent).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('candidates.service.sendConsentRequest', () => {
  it('candidate with no email → AppError VALIDATION candidate_has_no_email, nothing sent', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({ email: null }));

    const { sendConsentRequest } = await import('../services/candidates.service');
    await expect(sendConsentRequest('cand-1', adminUser, ctx)).rejects.toMatchObject({
      code: 'VALIDATION',
      status: 400,
      meta: { reason: 'candidate_has_no_email' },
    });
    expect(consentsRepo.createOptinToken).not.toHaveBeenCalled();
    expect(sendConsentRequestEmail).not.toHaveBeenCalled();
  });

  it('with email → mints a token, emails the confirm link, audits send_consent_request', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({}));
    vi.mocked(consentsRepo.createOptinToken).mockResolvedValue({ token: 'tok-xyz' } as never);

    const { sendConsentRequest } = await import('../services/candidates.service');
    const result = await sendConsentRequest('cand-1', adminUser, ctx);

    expect(consentsRepo.createOptinToken).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-1',
        candidateEmail: 'anna@example.com',
        candidatePhone: '+48555111222',
        expiresAt: expect.any(Date),
      }),
    );
    expect(sendConsentRequestEmail).toHaveBeenCalledWith(
      'anna@example.com',
      expect.stringContaining('/consent/confirm/tok-xyz'),
      'Anna Kowalska',
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'send_consent_request',
        entityType: 'candidate',
        entityId: 'cand-1',
      }),
    );
    expect(result).toEqual({ sent: true });
  });
});

describe('candidates.service.sendConsentRequestsBulk', () => {
  it('mix of visible-with-email / visible-no-email / not-visible → {sent, skippedNoEmail, failed}', async () => {
    vi.mocked(repo.findByIdEnriched).mockImplementation(async (id: string) => {
      if (id === 'c-has') return enriched({ id: 'c-has', email: 'a@x.com', phone: null, recruiterId: 'rec-1' });
      if (id === 'c-noemail') return enriched({ id: 'c-noemail', email: null, recruiterId: 'rec-1' });
      // c-hidden: owned by another recruiter → canSee false for recruiterUser.
      return enriched({ id: 'c-hidden', email: 'c@x.com', recruiterId: 'rec-other' });
    });
    vi.mocked(consentsRepo.createOptinToken).mockResolvedValue({ token: 'tok-1' } as never);
    vi.mocked(sendConsentRequestEmail).mockResolvedValue(undefined);

    const { sendConsentRequestsBulk } = await import('../services/candidates.service');
    const result = await sendConsentRequestsBulk(
      ['c-has', 'c-noemail', 'c-hidden'],
      recruiterUser,
      ctx,
    );

    expect(result).toEqual({ sent: 1, skippedNoEmail: 1, failed: 1 });
    expect(consentsRepo.createOptinToken).toHaveBeenCalledTimes(1);
    expect(sendConsentRequestEmail).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send_consent_requests_bulk',
        entityId: null,
        newValue: { requested: 3, sent: 1, skippedNoEmail: 1, failed: 1 },
      }),
    );
  });

  it('counts a per-recipient send exception as failed (best-effort, keeps going)', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enriched({ recruiterId: 'rec-1' }));
    vi.mocked(consentsRepo.createOptinToken).mockResolvedValue({ token: 'tok-1' } as never);
    vi.mocked(sendConsentRequestEmail).mockRejectedValue(new Error('smtp down'));

    const { sendConsentRequestsBulk } = await import('../services/candidates.service');
    const result = await sendConsentRequestsBulk(['cand-1'], recruiterUser, ctx);

    expect(result).toEqual({ sent: 0, skippedNoEmail: 0, failed: 1 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'send_consent_requests_bulk',
        newValue: { requested: 1, sent: 0, skippedNoEmail: 0, failed: 1 },
      }),
    );
  });
});
