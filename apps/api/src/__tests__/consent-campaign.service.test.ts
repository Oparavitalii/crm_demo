import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// Chainable Drizzle query mock — the chain object itself is thenable so
// `await db.select()...` resolves to `resolvedValue`. Mirrors the harness used
// in bulk-send.service.test.ts (consent-campaign imports helpers from there).
function makeThenableChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'orderBy', 'limit', 'leftJoin', 'set'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(resolve);
  chain.catch = (reject: (e: unknown) => unknown) => Promise.resolve(resolvedValue).catch(reject);
  chain.finally = (cb: () => void) => Promise.resolve(resolvedValue).finally(cb);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/client', () => ({
  db: {
    get select() { return mockSelect; },
    get insert() { return mockInsert; },
    get update() { return mockUpdate; },
  },
}));

vi.mock('../repositories/message-templates.repo', () => ({
  findById: vi.fn(),
}));

vi.mock('../repositories/consents.repo', () => ({
  createOptinToken: vi.fn(),
}));

vi.mock('../clients/resend.client', () => ({
  sendEmail: vi.fn(),
}));

// bulk-send.service (imported transitively) pulls in the SMS client.
vi.mock('../clients/smsapi.client', () => ({
  sendSms: vi.fn(),
  mapSmsapiStatus: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as templatesRepo from '../repositories/message-templates.repo';
import * as consentsRepo from '../repositories/consents.repo';
import { sendEmail } from '../clients/resend.client';
import * as auditService from '../services/audit.service';

const admin = { id: 'admin-1', role: 'admin' as const };
const ctx = { ip: null, userAgent: null };

const CONFIRM_PLACEHOLDER = '{{consentConfirmUrl}}';

const baseTemplate = {
  id: 'tmpl-1',
  name: 'Re-consent',
  channel: 'email' as const,
  subject: 'Please confirm {{firstName}}',
  body: `<p>Hi {{firstName}}, confirm here: ${CONFIRM_PLACEHOLDER}</p>`,
  variables: ['firstName'],
  autoSendOnCreate: false,
  createdById: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const smsTemplate = { ...baseTemplate, id: 'tmpl-sms', channel: 'sms' as const };
const templateNoPlaceholder = {
  ...baseTemplate,
  id: 'tmpl-noph',
  body: '<p>Hi {{firstName}}, no link here.</p>',
};

const candidateRows = [
  { id: 'c-1', name: 'Jan Kowalski', email: 'jan@example.com', phone: '+48123456789' },
  { id: 'c-2', name: 'Anna Nowak', email: 'anna@example.com', phone: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendConsentCampaign — template validation', () => {
  it('rejects a non-email template with VALIDATION', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(smsTemplate);

    const { sendConsentCampaign } = await import('../services/consent-campaign.service');
    await expect(
      sendConsentCampaign({ templateId: 'tmpl-sms', filters: {}, dryRun: false }, admin, ctx),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      meta: { reason: 'template_channel_must_be_email' },
    });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects an email template missing {{consentConfirmUrl}} with reason template_missing_consent_confirm_url', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(templateNoPlaceholder);

    const { sendConsentCampaign } = await import('../services/consent-campaign.service');
    await expect(
      sendConsentCampaign({ templateId: 'tmpl-noph', filters: {}, dryRun: false }, admin, ctx),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      meta: { reason: 'template_missing_consent_confirm_url' },
    });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects readonly actors with FORBIDDEN before touching the template', async () => {
    const readonly = { id: 'r-1', role: 'readonly' as const };
    const { sendConsentCampaign } = await import('../services/consent-campaign.service');
    await expect(
      sendConsentCampaign({ templateId: 'tmpl-1', filters: {}, dryRun: false }, readonly, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(templatesRepo.findById).not.toHaveBeenCalled();
  });
});

describe('sendConsentCampaign — dry run', () => {
  it('returns counts without sending or minting tokens', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(baseTemplate);
    // 1st select = candidates, 2nd select = already-consented emails (none).
    mockSelect
      .mockReturnValueOnce(makeThenableChain(candidateRows))
      .mockReturnValueOnce(makeThenableChain([]));

    const { sendConsentCampaign } = await import('../services/consent-campaign.service');
    const result = await sendConsentCampaign(
      { templateId: 'tmpl-1', filters: {}, dryRun: true },
      admin,
      ctx,
    );

    expect(result).toEqual({
      recipientsTotal: 2,
      sentCount: 0,
      failedCount: 0,
      skippedAlreadyConsented: 0,
      dryRun: true,
      messageIds: [],
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(consentsRepo.createOptinToken).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('sendConsentCampaign — skip already-consented', () => {
  it('excludes candidates who already hold an active email_marketing consent', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(baseTemplate);
    // Both candidateRows carry an email; jan is already consented, anna is not.
    // → jan skipped, anna remains as the sole target.
    mockSelect
      .mockReturnValueOnce(makeThenableChain(candidateRows))
      .mockReturnValueOnce(makeThenableChain([{ email: 'jan@example.com' }]));

    const { sendConsentCampaign } = await import('../services/consent-campaign.service');
    const result = await sendConsentCampaign(
      { templateId: 'tmpl-1', filters: {}, dryRun: true },
      admin,
      ctx,
    );

    expect(result.recipientsTotal).toBe(1);
    expect(result.skippedAlreadyConsented).toBe(1);
  });

  it('counts only the truly-new recipients when some are already consented', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(baseTemplate);
    const rows = [
      { id: 'c-1', name: 'Jan', email: 'jan@example.com', phone: null },
      { id: 'c-3', name: 'Ola', email: 'ola@example.com', phone: null },
    ];
    mockSelect
      .mockReturnValueOnce(makeThenableChain(rows))
      .mockReturnValueOnce(makeThenableChain([{ email: 'jan@example.com' }]));

    const { sendConsentCampaign } = await import('../services/consent-campaign.service');
    const result = await sendConsentCampaign(
      { templateId: 'tmpl-1', filters: {}, dryRun: true },
      admin,
      ctx,
    );

    expect(result.recipientsTotal).toBe(1);
    expect(result.skippedAlreadyConsented).toBe(1);
  });
});

describe('sendConsentCampaign — real send path', () => {
  it('mints a per-recipient token, substitutes the confirm link, sends, and audits', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(baseTemplate);
    const target = [{ id: 'c-1', name: 'Jan Kowalski', email: 'jan@example.com', phone: null }];
    mockSelect
      .mockReturnValueOnce(makeThenableChain(target)) // candidates
      .mockReturnValueOnce(makeThenableChain([])); // consented emails: none
    mockInsert.mockReturnValue(makeThenableChain([{ id: 'msg-1' }]));
    mockUpdate.mockReturnValue(makeThenableChain(undefined));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(consentsRepo.createOptinToken).mockResolvedValue({ token: 'tok-xyz' } as any);
    vi.mocked(sendEmail).mockResolvedValue({ id: 'resend-1' });

    const { sendConsentCampaign } = await import('../services/consent-campaign.service');
    const result = await sendConsentCampaign(
      { templateId: 'tmpl-1', filters: {}, dryRun: false },
      admin,
      ctx,
    );

    expect(result).toMatchObject({
      recipientsTotal: 1,
      sentCount: 1,
      failedCount: 0,
      skippedAlreadyConsented: 0,
      dryRun: false,
      messageIds: ['msg-1'],
    });

    expect(consentsRepo.createOptinToken).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'c-1',
        candidateEmail: 'jan@example.com',
        candidatePhone: null,
      }),
    );
    // The placeholder was replaced with the real confirm URL carrying the token.
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jan@example.com',
        html: expect.stringContaining('/consent/confirm/tok-xyz'),
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.not.stringContaining(CONFIRM_PLACEHOLDER) }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send_consent_campaign' }),
    );
  });
});
