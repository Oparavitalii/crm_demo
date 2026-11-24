import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// Build a chainable Drizzle query mock that resolves to a given value when awaited.
// Drizzle queries are "awaitable" (thenable) — the chain object itself resolves.
function makeThenableChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'orderBy', 'limit', 'leftJoin', 'set'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain thenable so `await chain` resolves to `resolvedValue`
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(resolve);
  chain.catch = (reject: (e: unknown) => unknown) => Promise.resolve(resolvedValue).catch(reject);
  chain.finally = (cb: () => void) => Promise.resolve(resolvedValue).finally(cb);
  // Also make `values().returning()` work for INSERT
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

vi.mock('../clients/resend.client', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('../clients/smsapi.client', () => ({
  sendSms: vi.fn(),
  mapSmsapiStatus: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as templatesRepo from '../repositories/message-templates.repo';
import { sendEmail } from '../clients/resend.client';
import { sendSms } from '../clients/smsapi.client';
import { NotFoundError } from '../lib/errors';

const admin = { id: 'admin-1', role: 'admin' as const };

const ctx = { ip: null, userAgent: null };

const emailTemplate = {
  id: 'tmpl-1',
  name: 'Test Template',
  channel: 'email' as const,
  subject: 'Hello {{firstName}}',
  body: '<p>Dear {{firstName}} {{lastName}},</p><p>Your email: {{email}}</p>',
  variables: ['firstName', 'lastName', 'email'],
  autoSendOnCreate: false,
  createdById: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const smsTemplate = { ...emailTemplate, id: 'tmpl-sms', channel: 'sms' as const };

// 2026-06-12: candidates.first_name + last_name collapsed into single `name` column.
const fakeCandidates = [
  { id: 'c-1', name: 'Jan Kowalski', email: 'jan@example.com', phone: '+48123456789', anonymizedAt: null, createdAt: new Date() },
  { id: 'c-2', name: 'Anna Nowak', email: 'anna@example.com', phone: null, anonymizedAt: null, createdAt: new Date() },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bulk-send.service variable substitution', () => {
  it('substitutes {{firstName}}, {{lastName}}, {{email}} in subject and body', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);

    // sendBulk calls: db.select().from().where().orderBy() → fakeCandidates
    // Then for each candidate: db.insert().values().returning() → [msgRow]
    // Then: db.update().set().where() → undefined
    const selectChain = makeThenableChain(fakeCandidates);
    mockSelect.mockReturnValue(selectChain);

    const msgRow = { id: 'msg-1' };
    const insertChain = makeThenableChain([msgRow]);
    mockInsert.mockReturnValue(insertChain);

    const updateChain = makeThenableChain(undefined);
    mockUpdate.mockReturnValue(updateChain);

    vi.mocked(sendEmail).mockResolvedValue({ id: 'resend-id-1' });

    const { sendBulk } = await import('../services/bulk-send.service');
    const result = await sendBulk(
      { templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: false },
      admin,
      ctx,
    );

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Hello Jan',
        html: expect.stringContaining('Jan Kowalski'),
      }),
    );
    expect(result.recipientsTotal).toBe(2);
  });
});

describe('bulk-send.service previewRecipients', () => {
  it('returns the SQL aggregate count without materializing rows', async () => {
    // previewRecipients now issues count(*)::int — the mock resolves to a single
    // aggregate row, not a list of candidate ids.
    const selectChain = makeThenableChain([{ count: 7 }]);
    mockSelect.mockReturnValue(selectChain);

    const { previewRecipients } = await import('../services/bulk-send.service');
    const result = await previewRecipients({}, admin);

    expect(result).toEqual({ count: 7, withoutConsent: 0 });
    expect(mockSelect).toHaveBeenCalled();
  });

  it('returns count 0 when the aggregate row is missing', async () => {
    const selectChain = makeThenableChain([]);
    mockSelect.mockReturnValue(selectChain);

    const { previewRecipients } = await import('../services/bulk-send.service');
    const result = await previewRecipients({}, admin);

    expect(result).toEqual({ count: 0, withoutConsent: 0 });
  });

  it('forbids readonly actors', async () => {
    const readonly = { id: 'r-1', role: 'readonly' as const };
    const { previewRecipients } = await import('../services/bulk-send.service');
    await expect(previewRecipients({}, readonly)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sms channel: counts total-with-phone AND consented, returns the breakdown', async () => {
    const selectChain = makeThenableChain([{ count: 3 }]);
    mockSelect.mockReturnValue(selectChain);

    const { previewRecipients } = await import('../services/bulk-send.service');
    const result = await previewRecipients({}, admin, 'sms');

    // Shared mock resolves every count query to 3, so total == consented and
    // withoutConsent collapses to 0. The distinct-count case is covered below.
    expect(result).toEqual({ count: 3, withoutConsent: 0 });
    // Four select() builders: outer count for total-with-phone + the two
    // sms_marketing consent subqueries (phone/email) + outer count for consented.
    expect(mockSelect).toHaveBeenCalledTimes(4);
  });

  it('sms channel: withoutConsent = total-with-phone minus consented', async () => {
    // Sequence the awaited count queries: call #1 = total (10), the two
    // in-between selects are the consent subqueries (values irrelevant), and the
    // final awaited count #4 = consented (3) → withoutConsent = 7.
    mockSelect
      .mockReturnValueOnce(makeThenableChain([{ count: 10 }]))
      .mockReturnValueOnce(makeThenableChain([]))
      .mockReturnValueOnce(makeThenableChain([]))
      .mockReturnValueOnce(makeThenableChain([{ count: 3 }]));

    const { previewRecipients } = await import('../services/bulk-send.service');
    const result = await previewRecipients({}, admin, 'sms');

    expect(result).toEqual({ count: 3, withoutConsent: 7 });
  });

  it('email channel (default): counts total AND consented, returns the consent breakdown', async () => {
    // Email is now consent-gated too (email_marketing). The preview issues:
    // total count → email consent subquery builder → consented count = 3 selects.
    mockSelect
      .mockReturnValueOnce(makeThenableChain([{ count: 10 }])) // total-with-email
      .mockReturnValueOnce(makeThenableChain([])) // email_marketing consent subquery
      .mockReturnValueOnce(makeThenableChain([{ count: 4 }])); // consented

    const { previewRecipients } = await import('../services/bulk-send.service');
    const result = await previewRecipients({}, admin);

    expect(result).toEqual({ count: 4, withoutConsent: 6 });
    expect(mockSelect).toHaveBeenCalledTimes(3);
  });
});

describe('bulk-send.service loadRecipients limit', () => {
  it('caps the candidate query at MAX_RECIPIENTS + 1 (101) rows', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);

    const selectChain = makeThenableChain(fakeCandidates);
    mockSelect.mockReturnValue(selectChain);

    const { sendBulk } = await import('../services/bulk-send.service');
    await sendBulk(
      { templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: true },
      admin,
      ctx,
    );

    // 101 = MAX_RECIPIENTS (100) + 1 sentinel for the overflow check.
    expect(selectChain.limit).toHaveBeenCalledWith(101);
  });
});

describe('bulk-send.service dry run', () => {
  it('returns recipientsTotal without sending emails or inserting messages', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);

    const selectChain = makeThenableChain(fakeCandidates);
    mockSelect.mockReturnValue(selectChain);

    const { sendBulk } = await import('../services/bulk-send.service');
    const result = await sendBulk(
      { templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: true },
      admin,
      ctx,
    );

    expect(result.dryRun).toBe(true);
    expect(result.recipientsTotal).toBe(2);
    expect(result.sentCount).toBe(0);
    expect(result.messageIds).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('bulk-send.service hard limit', () => {
  it('throws TOO_MANY_RECIPIENTS when recipients exceed 100', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);

    const manyRecipients = Array.from({ length: 101 }, (_, i) => ({
      id: `c-${i}`,
      name: 'Test User',
      email: `user${i}@example.com`,
      phone: null,
      anonymizedAt: null,
      createdAt: new Date(),
    }));

    const selectChain = makeThenableChain(manyRecipients);
    mockSelect.mockReturnValue(selectChain);

    const { sendBulk } = await import('../services/bulk-send.service');
    await expect(
      sendBulk({ templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: false }, admin, ctx),
    ).rejects.toMatchObject({ code: 'TOO_MANY_RECIPIENTS' });
  });
});

describe('bulk-send.service template validation', () => {
  it('throws NOT_FOUND when template does not exist', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(undefined);

    const { sendBulk } = await import('../services/bulk-send.service');
    await expect(
      sendBulk({ templateId: 'non-existent', entityType: 'candidate' as const, filters: {}, dryRun: false }, admin, ctx),
    ).rejects.toThrow(NotFoundError);
  });

  // 2026-06-15: SMS channel is now supported via SMSAPI.pl integration. The
  // previous "VALIDATION reason=template_not_email_channel" guard was removed;
  // SMS templates route through sendBulkSms with phone + consent + daily-cap
  // checks. Dedicated SMS-path tests live alongside the smsapi.client tests.
  // The previously-defined `smsTemplate` fixture is intentionally retained for
  // future use; reference it to keep eslint no-unused-vars quiet.
  void smsTemplate;

  it('readonly cannot bulk send', async () => {
    const readonly = { id: 'r-1', role: 'readonly' as const };
    const { sendBulk } = await import('../services/bulk-send.service');
    await expect(
      sendBulk({ templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: false }, readonly, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('bulk-send.service processingRestricted exclusion (I-3)', () => {
  it('candidate with processingRestricted: true is excluded from recipient list', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);

    // The DB WHERE clause should exclude processingRestricted candidates.
    // In the unit test the mock returns empty (simulating that filter removed them).
    const selectChain = makeThenableChain([]);
    mockSelect.mockReturnValue(selectChain);

    const { sendBulk } = await import('../services/bulk-send.service');
    const result = await sendBulk(
      { templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: true },
      admin,
      ctx,
    );

    // Zero recipients because processingRestricted candidates were filtered
    expect(result.recipientsTotal).toBe(0);
    // Verify the select was called (i.e. the query ran with the filter)
    expect(mockSelect).toHaveBeenCalled();
  });
});

describe('bulk-send.service history sort DESC (I-4)', () => {
  it('getHistory returns items in newest-first order', async () => {
    const older = { id: 'msg-old', candidateId: null, templateId: null, subject: null, status: 'sent', sentAt: null, errorMessage: null, createdAt: new Date('2024-01-01'), candidateName: null, templateName: null };
    const newer = { id: 'msg-new', candidateId: null, templateId: null, subject: null, status: 'sent', sentAt: null, errorMessage: null, createdAt: new Date('2024-06-01'), candidateName: null, templateName: null };

    // Mock returns newest first (as DB would with DESC)
    const selectChain = makeThenableChain([newer, older]);
    mockSelect.mockReturnValue(selectChain);

    const { getHistory } = await import('../services/bulk-send.service');
    const result = await getHistory({ id: 'admin-1', role: 'admin' }, 100);

    expect(result.items[0]?.id).toBe('msg-new');
    expect(result.items[1]?.id).toBe('msg-old');
  });
});

describe('bulk-send.service history scope (C-4)', () => {
  it('recruiter actor is passed to service (scope test via signature)', async () => {
    const selectChain = makeThenableChain([]);
    mockSelect.mockReturnValue(selectChain);

    const recruiter = { id: 'rec-1', role: 'recruiter' as const };
    const { getHistory } = await import('../services/bulk-send.service');
    // Should not throw — recruiter scoping is applied internally
    const result = await getHistory(recruiter, 100);
    expect(result.items).toEqual([]);
    expect(mockSelect).toHaveBeenCalled();
  });
});

describe('bulk-send.service HTML escaping', () => {
  it('escapes HTML special characters in substituted values', async () => {
    const xssCandidate = {
      id: 'c-xss',
      name: '<script>alert(1)</script> User & "Test"',
      email: 'xss@example.com',
      phone: null,
      anonymizedAt: null,
      createdAt: new Date(),
    };

    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);

    const selectChain = makeThenableChain([xssCandidate]);
    mockSelect.mockReturnValue(selectChain);

    const msgRow = { id: 'msg-xss' };
    const insertChain = makeThenableChain([msgRow]);
    mockInsert.mockReturnValue(insertChain);

    const updateChain = makeThenableChain(undefined);
    mockUpdate.mockReturnValue(updateChain);

    vi.mocked(sendEmail).mockResolvedValue({ id: 'resend-xss' });

    const { sendBulk } = await import('../services/bulk-send.service');
    await sendBulk({ templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: false }, admin, ctx);

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('&lt;script&gt;'),
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.not.stringContaining('<script>'),
      }),
    );
  });
});

describe('bulk-send.service SMS consent override', () => {
  // Both have a phone (SMS requires it); c-1 additionally holds an active
  // sms_marketing consent (matched by email here to sidestep phone
  // normalization), c-2 does not.
  const smsRecipients = [
    { id: 'c-1', name: 'Consented', email: 'a@x.com', phone: '+48111111111', anonymizedAt: null, createdAt: new Date() },
    { id: 'c-2', name: 'NoConsent', email: 'b@x.com', phone: '+48222222222', anonymizedAt: null, createdAt: new Date() },
  ];
  const consentRows = [{ email: 'a@x.com', phone: null }];
  const sentOutcome = { kind: 'sent' as const, result: { msgId: 'm1', points: 0.1, status: 'QUEUE' } };

  function primeSelects() {
    // Order matters: loadRecipients → loadActiveSmsConsent → countSmsSentToday.
    mockSelect
      .mockReturnValueOnce(makeThenableChain(smsRecipients))
      .mockReturnValueOnce(makeThenableChain(consentRows))
      .mockReturnValueOnce(makeThenableChain([{ count: 0 }]));
    mockInsert.mockReturnValue(makeThenableChain([{ id: 'msg-x' }]));
    mockUpdate.mockReturnValue(makeThenableChain(undefined));
  }

  it('admin override sends to phone-holders without consent and reports sentWithoutConsent', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(smsTemplate);
    primeSelects();
    vi.mocked(sendSms).mockResolvedValue(sentOutcome);

    const { sendBulk } = await import('../services/bulk-send.service');
    const result = await sendBulk(
      { templateId: 'tmpl-sms', entityType: 'candidate' as const, filters: {}, includeWithoutConsent: true, dryRun: false },
      admin,
      ctx,
    );

    expect(result.recipientsTotal).toBe(2);
    expect(result.sentWithoutConsent).toBe(1);
    expect(sendSms).toHaveBeenCalledTimes(2);
  });

  it('default SMS send (no override) excludes candidates without consent', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(smsTemplate);
    primeSelects();
    vi.mocked(sendSms).mockResolvedValue(sentOutcome);

    const { sendBulk } = await import('../services/bulk-send.service');
    const result = await sendBulk(
      { templateId: 'tmpl-sms', entityType: 'candidate' as const, filters: {}, dryRun: false },
      admin,
      ctx,
    );

    expect(result.recipientsTotal).toBe(1);
    expect(result.sentWithoutConsent).toBe(0);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('non-admin cannot use the consent override', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(smsTemplate);
    const recruiter = { id: 'rec-1', role: 'recruiter' as const };
    const { sendBulk } = await import('../services/bulk-send.service');
    await expect(
      sendBulk(
        { templateId: 'tmpl-sms', entityType: 'candidate' as const, filters: {}, includeWithoutConsent: true, dryRun: false },
        recruiter,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('bulk-send.service EMAIL consent gate', () => {
  // Both have an email (email requires it); c-1 additionally holds an active
  // email_marketing consent, c-2 does not.
  const emailRecipients = [
    { id: 'c-1', name: 'Consented', email: 'a@x.com', phone: null, anonymizedAt: null, createdAt: new Date() },
    { id: 'c-2', name: 'NoConsent', email: 'b@x.com', phone: null, anonymizedAt: null, createdAt: new Date() },
  ];
  const consentRows = [{ email: 'a@x.com' }];

  function primeSelects() {
    // Order matters: loadRecipients → loadActiveEmailConsent.
    mockSelect
      .mockReturnValueOnce(makeThenableChain(emailRecipients))
      .mockReturnValueOnce(makeThenableChain(consentRows));
    mockInsert.mockReturnValue(makeThenableChain([{ id: 'msg-x' }]));
    mockUpdate.mockReturnValue(makeThenableChain(undefined));
  }

  it('default email send (no override) excludes candidates without an email_marketing consent', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);
    primeSelects();
    vi.mocked(sendEmail).mockResolvedValue({ id: 'resend-1' });

    const { sendBulk } = await import('../services/bulk-send.service');
    const result = await sendBulk(
      { templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, dryRun: false },
      admin,
      ctx,
    );

    expect(result.recipientsTotal).toBe(1);
    expect(result.sentWithoutConsent).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.com' }));
  });

  it('admin override reaches non-consented emails and reports sentWithoutConsent', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);
    primeSelects();
    vi.mocked(sendEmail).mockResolvedValue({ id: 'resend-1' });

    const { sendBulk } = await import('../services/bulk-send.service');
    const result = await sendBulk(
      { templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, includeWithoutConsent: true, dryRun: false },
      admin,
      ctx,
    );

    expect(result.recipientsTotal).toBe(2);
    expect(result.sentWithoutConsent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('non-admin cannot use the email consent override', async () => {
    vi.mocked(templatesRepo.findById).mockResolvedValue(emailTemplate);
    const recruiter = { id: 'rec-1', role: 'recruiter' as const };
    const { sendBulk } = await import('../services/bulk-send.service');
    await expect(
      sendBulk(
        { templateId: 'tmpl-1', entityType: 'candidate' as const, filters: {}, includeWithoutConsent: true, dryRun: false },
        recruiter,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', meta: { reason: 'consent_override_admin_only' } });
  });
});

// 2026-06-12: leads entity retired. The entityType=lead branch of sendBulk was
// removed — bulk-send is candidate-only now. Removing the related test cases.
