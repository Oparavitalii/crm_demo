import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates } from '../db/tables/candidates';
import { consents } from '../db/tables/consents';
import { messages, messageTemplates } from '../db/tables/messages';
import { users } from '../db/tables/users';
import { sendEmail } from '../clients/resend.client';
import { sendSms } from '../clients/smsapi.client';
import * as templatesRepo from '../repositories/message-templates.repo';
import * as audit from './audit.service';
import { env } from '../env';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { normalizePhone } from '../lib/normalize';
import type { BulkSendInput } from '@opushr/shared';

export const MAX_RECIPIENTS = 100;
const SMS_CONSENT_TYPE = 'sms_marketing';
const EMAIL_CONSENT_TYPE = 'email_marketing';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// 2026-06-12: leads retired. Templates still use {{firstName}} / {{lastName}}
// historically — we split the candidate's single `name` field on whitespace to
// keep those placeholders working. Single-word names land entirely in firstName.
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1).trim(),
  };
}

interface SubstitutionVars {
  name: string;
  email: string;
  phone: string | null;
}

export function substituteHtml(template: string, vars: SubstitutionVars): string {
  const { firstName, lastName } = splitName(vars.name);
  return template
    .replace(/\{\{name\}\}/g, escapeHtml(vars.name))
    .replace(/\{\{firstName\}\}/g, escapeHtml(firstName))
    .replace(/\{\{lastName\}\}/g, escapeHtml(lastName))
    .replace(/\{\{email\}\}/g, escapeHtml(vars.email))
    .replace(/\{\{phone\}\}/g, escapeHtml(vars.phone ?? ''));
}

// SMS = plain text. HTML escapes would arrive as literal `&amp;` on the phone.
function substitutePlain(template: string, vars: SubstitutionVars): string {
  const { firstName, lastName } = splitName(vars.name);
  // Templates originally authored for email may contain HTML tags (RichTextEditor).
  // Strip them before SMS delivery so recipients don't see `<p>` literals.
  const stripped = template.replace(/<[^>]+>/g, '');
  return stripped
    .replace(/\{\{name\}\}/g, vars.name)
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{lastName\}\}/g, lastName)
    .replace(/\{\{email\}\}/g, vars.email)
    .replace(/\{\{phone\}\}/g, vars.phone ?? '');
}

interface Scope {
  recruiterId?: string;
  coordinatorId?: string;
}

export function buildWhereConditions(
  filters: BulkSendInput['filters'],
  scope: Scope,
  recipientIds: string[] | undefined,
  channel: 'email' | 'sms',
): SQL[] {
  const where: SQL[] = [];

  // Exclude anonymized candidates
  where.push(isNull(candidates.anonymizedAt));

  // I-3: Exclude candidates with processing restriction (RODO art. 18)
  where.push(eq(candidates.processingRestricted, false));

  // Channel-dependent contact field — both columns are nullable.
  if (channel === 'email') {
    where.push(isNotNull(candidates.email));
  } else {
    where.push(isNotNull(candidates.phone));
  }

  // Explicit recipient list overrides audience filters but still respects RODO
  // exclusions and recruiter/coordinator scope above.
  if (recipientIds && recipientIds.length > 0) {
    where.push(inArray(candidates.id, recipientIds));
  } else {
    if (filters?.status) where.push(eq(candidates.status, filters.status));
    if (filters?.source) where.push(eq(candidates.source, filters.source));
    if (filters?.recruiterId) where.push(eq(candidates.recruiterId, filters.recruiterId));
  }

  // 2026-06-13 — strict scope on both sides. Recruiter sees ONLY candidates
  // explicitly assigned to them (no NULL fallback); coordinator the same for
  // clients. Matches candidates.service.ts canSee + analytics scoping so
  // bulk-send addresses the same audience the user sees in their lists.
  if (scope.recruiterId) {
    where.push(eq(candidates.recruiterId, scope.recruiterId));
  }
  if (scope.coordinatorId) {
    where.push(eq(candidates.coordinatorId, scope.coordinatorId));
  }

  return where;
}

export function scopeFromActor(actor: Actor): Scope {
  return {
    recruiterId: actor.role === 'recruiter' ? actor.id : undefined,
    coordinatorId: actor.role === 'coordinator' ? actor.id : undefined,
  };
}

// Reusable SQL predicate: "candidate has an active email_marketing consent",
// matched by email (the email identity). Mirrors loadActiveEmailConsent so
// preview and send agree on who counts as consented.
function emailConsentSqlFilter(): SQL {
  const emailSub = db
    .select({ email: consents.candidateEmail })
    .from(consents)
    .where(
      and(
        eq(consents.consentType, EMAIL_CONSENT_TYPE),
        isNull(consents.withdrawnAt),
        isNotNull(consents.candidateEmail),
      )!,
    );
  return inArray(candidates.email, emailSub)!;
}

// Active email_marketing consents as a Set of emails, for the in-memory filter
// in sendBulkEmail (parallels loadActiveSmsConsent for SMS).
async function loadActiveEmailConsent(): Promise<Set<string>> {
  const rows = await db
    .select({ email: consents.candidateEmail })
    .from(consents)
    .where(
      and(
        eq(consents.consentType, EMAIL_CONSENT_TYPE),
        isNull(consents.withdrawnAt),
        isNotNull(consents.candidateEmail),
      )!,
    );
  const emails = new Set<string>();
  for (const r of rows) if (r.email) emails.add(r.email);
  return emails;
}

// Reusable SQL predicate: "candidate has an active sms_marketing consent",
// matched by PHONE (the SMS identity) OR, for legacy email-keyed rows, by
// email. Mirrors the in-memory filter in sendBulkSms so preview and send never
// disagree on who counts as consented.
function smsConsentSqlFilter(): SQL {
  const phoneSub = db
    .select({ phone: consents.candidatePhone })
    .from(consents)
    .where(
      and(
        eq(consents.consentType, SMS_CONSENT_TYPE),
        isNull(consents.withdrawnAt),
        isNotNull(consents.candidatePhone),
      )!,
    );
  const emailSub = db
    .select({ email: consents.candidateEmail })
    .from(consents)
    .where(
      and(
        eq(consents.consentType, SMS_CONSENT_TYPE),
        isNull(consents.withdrawnAt),
        isNotNull(consents.candidateEmail),
      )!,
    );
  return or(
    inArray(sql`trim(${candidates.phone})`, phoneSub),
    inArray(candidates.email, emailSub),
  )!;
}

async function countCandidates(where: SQL[]): Promise<number> {
  const condition = where.length ? and(...where) : undefined;
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(candidates)
    .where(condition);
  return rows[0]?.count ?? 0;
}

export async function previewRecipients(
  filters: BulkSendInput['filters'],
  actor: Actor,
  channel: 'email' | 'sms' = 'email',
  recipientIds?: string[],
): Promise<{ count: number; withoutConsent: number }> {
  if (actor.role === 'readonly') {
    throw new AppError('FORBIDDEN', undefined, 403);
  }

  const scope = scopeFromActor(actor);

  if (channel === 'email') {
    // Email is now consent-gated too (email_marketing). Report the consented
    // audience as the default count and the non-consented remainder so the UI
    // can warn + offer the admin "send to all" override, same as SMS.
    const baseWhere = buildWhereConditions(filters, scope, recipientIds, 'email');
    const total = await countCandidates(baseWhere);
    const consented = await countCandidates([...baseWhere, emailConsentSqlFilter()]);
    return { count: consented, withoutConsent: Math.max(0, total - consented) };
  }

  // SMS: report BOTH the consent-gated audience (default send) and how many
  // additional phone-holders lack a consent, so the UI can warn + offer the
  // admin "send to all" override. total = consented + withoutConsent.
  const baseWhere = buildWhereConditions(filters, scope, recipientIds, 'sms');
  const total = await countCandidates(baseWhere);
  const consented = await countCandidates([...baseWhere, smsConsentSqlFilter()]);
  return { count: consented, withoutConsent: Math.max(0, total - consented) };
}

interface Recipient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface SendResult {
  recipientsTotal: number;
  sentCount: number;
  failedCount: number;
  // Recipients reached WITHOUT an active sms_marketing consent (admin override).
  // 0 for email and for consent-gated SMS sends.
  sentWithoutConsent: number;
  dryRun: boolean;
  messageIds: string[];
}

export async function sendBulk(
  input: BulkSendInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<SendResult> {
  if (actor.role === 'readonly') {
    throw new AppError('FORBIDDEN', undefined, 403);
  }

  const template = await templatesRepo.findById(input.templateId);
  if (!template) throw new NotFoundError('message_template');
  if (template.channel !== 'email' && template.channel !== 'sms') {
    throw new AppError('VALIDATION', { reason: 'template_channel_unsupported' }, 400);
  }

  if (template.channel === 'sms') {
    return sendBulkSms(input, template, actor, ctx);
  }
  return sendBulkEmail(input, template, actor, ctx);
}

async function loadRecipients(
  input: BulkSendInput,
  actor: Actor,
  channel: 'email' | 'sms',
): Promise<Recipient[]> {
  const where = buildWhereConditions(
    input.filters,
    scopeFromActor(actor),
    input.recipientIds,
    channel,
  );
  const condition = where.length ? and(...where) : undefined;
  // +1 sentinel: load at most MAX_RECIPIENTS + 1 rows so the overflow check in
  // sendBulkEmail/sendBulkSms (recipientsTotal > MAX_RECIPIENTS) still trips at
  // 101 > 100 without ever materializing thousands of candidates. SMS may filter
  // some of these out by consent afterwards — that only lowers the count, so the
  // limit remains a safe upper bound.
  const rows = await db
    .select()
    .from(candidates)
    .where(condition)
    .orderBy(candidates.createdAt)
    .limit(MAX_RECIPIENTS + 1);
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
  }));
}

async function sendBulkEmail(
  input: BulkSendInput,
  template: { id: string; subject: string | null; body: string },
  actor: Actor,
  ctx: ReqCtx,
): Promise<SendResult> {
  // Consent override is admin-only + compliance-sensitive: it emails candidates
  // with NO active email_marketing consent (premise: an offline/paper consent).
  // Reject for non-admins BEFORE loading anyone. Mirrors sendBulkSms.
  const override = input.includeWithoutConsent === true;
  if (override && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', { reason: 'consent_override_admin_only' }, 403);
  }

  const allRecipients = (await loadRecipients(input, actor, 'email')).filter(
    (r): r is Recipient & { email: string } => r.email !== null,
  );

  // Filter by active email_marketing consent (matched by email). Default send
  // is consent-gated; the admin override reaches everyone with an email and
  // records how many lacked consent for the audit trail.
  const consentEmails = await loadActiveEmailConsent();
  const consentedRecipients = allRecipients.filter((r) => consentEmails.has(r.email));
  const recipientRows = override ? allRecipients : consentedRecipients;
  const sentWithoutConsent = override ? recipientRows.length - consentedRecipients.length : 0;

  const recipientsTotal = recipientRows.length;

  if (recipientsTotal > MAX_RECIPIENTS) {
    throw new AppError('TOO_MANY_RECIPIENTS', { count: recipientsTotal, max: MAX_RECIPIENTS }, 400);
  }

  if (input.dryRun) {
    return { recipientsTotal, sentCount: 0, failedCount: 0, sentWithoutConsent, dryRun: true, messageIds: [] };
  }

  let sentCount = 0;
  let failedCount = 0;
  const messageIds: string[] = [];

  for (const recipient of recipientRows) {
    const vars = { name: recipient.name, email: recipient.email, phone: recipient.phone };
    const subject = substituteHtml(template.subject ?? '', vars);
    const body = substituteHtml(template.body, vars);

    const [msgRow] = await db
      .insert(messages)
      .values({
        candidateId: recipient.id,
        channel: 'email',
        direction: 'outbound',
        templateId: template.id,
        subject,
        body,
        status: 'queued',
        sentById: actor.id,
      })
      .returning();

    if (!msgRow) {
      failedCount++;
      continue;
    }
    messageIds.push(msgRow.id);

    try {
      const result = await sendEmail({
        to: recipient.email,
        subject,
        html: body,
        text: body.replace(/<[^>]+>/g, ''),
      });
      if (result) {
        await db
          .update(messages)
          .set({ status: 'sent', sentAt: new Date(), externalId: result.id })
          .where(eq(messages.id, msgRow.id));
        sentCount++;
      } else {
        await db
          .update(messages)
          .set({ status: 'failed', errorMessage: 'Email client returned no result' })
          .where(eq(messages.id, msgRow.id));
        failedCount++;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await db
        .update(messages)
        .set({ status: 'failed', errorMessage })
        .where(eq(messages.id, msgRow.id));
      failedCount++;
    }
  }

  await audit.log({
    actorId: actor.id,
    action: 'send_bulk_email',
    entityType: 'message_template',
    entityId: template.id,
    newValue: {
      templateId: template.id,
      recipientsTotal,
      sentCount,
      failedCount,
      // RODO accountability for the consent override (see sendBulkSms).
      includeWithoutConsent: override,
      sentWithoutConsent,
    },
    ...ctx,
  });

  return { recipientsTotal, sentCount, failedCount, sentWithoutConsent, dryRun: false, messageIds };
}

async function countSmsSentToday(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.channel, 'sms'),
        eq(messages.direction, 'outbound'),
        gte(messages.createdAt, startOfTodayUtc()),
      )!,
    );
  return rows[0]?.count ?? 0;
}

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

interface SmsConsentIndex {
  phones: Set<string>;
  emails: Set<string>;
}

// Active sms_marketing consents indexed by both identifiers. A consent may
// carry a phone (phone-only applicant), an email (legacy email-keyed rows), or
// both. Recipients match if EITHER their phone or email is present here.
async function loadActiveSmsConsent(): Promise<SmsConsentIndex> {
  const rows = await db
    .select({ email: consents.candidateEmail, phone: consents.candidatePhone })
    .from(consents)
    .where(
      and(eq(consents.consentType, SMS_CONSENT_TYPE), isNull(consents.withdrawnAt))!,
    );
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const r of rows) {
    if (r.phone) phones.add(r.phone);
    if (r.email) emails.add(r.email);
  }
  return { phones, emails };
}

async function sendBulkSms(
  input: BulkSendInput,
  template: { id: string; body: string },
  actor: Actor,
  ctx: ReqCtx,
): Promise<SendResult> {
  // Consent override is SMS-only + admin-only + compliance-sensitive: it sends
  // to candidates with NO digital consent (on the premise they signed a paper
  // form). Reject it for non-admins BEFORE loading anyone.
  const override = input.includeWithoutConsent === true;
  if (override && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', { reason: 'consent_override_admin_only' }, 403);
  }

  const allRecipients = (await loadRecipients(input, actor, 'sms')).filter(
    (r): r is Recipient & { phone: string } => r.phone !== null,
  );

  // Filter by active sms_marketing consent, matched by PHONE (the SMS identity)
  // or, for legacy email-keyed rows, by email. A phone-only applicant can now
  // consent and receive SMS.
  const consent = await loadActiveSmsConsent();
  const hasConsent = (r: Recipient & { phone: string }): boolean => {
    const normPhone = normalizePhone(r.phone);
    return (
      (normPhone !== null && consent.phones.has(normPhone)) ||
      (r.email !== null && consent.emails.has(r.email))
    );
  };

  const consentedRecipients = allRecipients.filter(hasConsent);
  // Default: consent-gated. Override (admin): everyone with a phone, and we
  // record how many lacked consent for the audit trail + result toast.
  const recipientRows = override ? allRecipients : consentedRecipients;
  const sentWithoutConsent = override ? recipientRows.length - consentedRecipients.length : 0;

  const recipientsTotal = recipientRows.length;

  if (recipientsTotal > MAX_RECIPIENTS) {
    throw new AppError('TOO_MANY_RECIPIENTS', { count: recipientsTotal, max: MAX_RECIPIENTS }, 400);
  }

  // Daily cap check happens BEFORE the dry-run short circuit so previews
  // surface the cap-exceeded condition to the user.
  const sentToday = await countSmsSentToday();
  if (sentToday + recipientsTotal > env.SMS_DAILY_CAP) {
    throw new AppError(
      'SMS_CAP_EXCEEDED',
      {
        cap: env.SMS_DAILY_CAP,
        sentToday,
        attempted: recipientsTotal,
        remaining: Math.max(0, env.SMS_DAILY_CAP - sentToday),
      },
      429,
    );
  }

  if (input.dryRun) {
    return { recipientsTotal, sentCount: 0, failedCount: 0, sentWithoutConsent, dryRun: true, messageIds: [] };
  }

  let sentCount = 0;
  let failedCount = 0;
  const messageIds: string[] = [];

  for (const recipient of recipientRows) {
    const body = substitutePlain(template.body, {
      name: recipient.name,
      email: recipient.email ?? '',
      phone: recipient.phone,
    });

    const [msgRow] = await db
      .insert(messages)
      .values({
        candidateId: recipient.id,
        channel: 'sms',
        direction: 'outbound',
        templateId: template.id,
        subject: null,
        body,
        status: 'queued',
        sentById: actor.id,
      })
      .returning();

    if (!msgRow) {
      failedCount++;
      continue;
    }
    messageIds.push(msgRow.id);

    const outcome = await sendSms({
      to: recipient.phone,
      message: body,
      idx: msgRow.id,
    });

    if (outcome.kind === 'sent') {
      await db
        .update(messages)
        .set({
          status: 'sent',
          sentAt: new Date(),
          externalId: outcome.result.msgId,
        })
        .where(eq(messages.id, msgRow.id));
      sentCount++;
    } else if (outcome.kind === 'disabled') {
      await db
        .update(messages)
        .set({ status: 'failed', errorMessage: `disabled: ${outcome.reason}` })
        .where(eq(messages.id, msgRow.id));
      failedCount++;
    } else {
      await db
        .update(messages)
        .set({ status: 'failed', errorMessage: outcome.error })
        .where(eq(messages.id, msgRow.id));
      failedCount++;
    }
  }

  await audit.log({
    actorId: actor.id,
    action: 'send_bulk_sms',
    entityType: 'message_template',
    entityId: template.id,
    // includeWithoutConsent + sentWithoutConsent are the RODO accountability
    // trail for the consent override: they record that an admin knowingly
    // messaged recipients lacking a digital sms_marketing consent.
    newValue: {
      templateId: template.id,
      recipientsTotal,
      sentCount,
      failedCount,
      includeWithoutConsent: override,
      sentWithoutConsent,
    },
    ...ctx,
  });

  // 80% threshold alert: log a warn so ops/monitoring can fire on it. The full
  // email-admin alert can hook into this log line via Sentry/Pino transport.
  const totalAfter = sentToday + sentCount;
  if (totalAfter >= env.SMS_DAILY_CAP * 0.8) {
    logger.warn(
      { cap: env.SMS_DAILY_CAP, sentToday: totalAfter },
      'sms_daily_cap_threshold_80pct',
    );
  }

  return { recipientsTotal, sentCount, failedCount, sentWithoutConsent, dryRun: false, messageIds };
}

export async function getHistory(
  actor: { id: string; role: string },
  limit = 100,
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  // C-4: scope recruiter / coordinator to own messages only. Recruiters see
  // messages they sent OR messages for their candidates; coordinators see
  // messages for their assigned clients OR ones they sent themselves.
  const baseCondition = eq(messages.direction, 'outbound');
  let condition: SQL | undefined = baseCondition;

  if (actor.role === 'recruiter') {
    condition = and(
      baseCondition,
      or(
        eq(messages.sentById, actor.id),
        eq(candidates.recruiterId, actor.id),
      )!,
    );
  } else if (actor.role === 'coordinator') {
    condition = and(
      baseCondition,
      or(
        eq(messages.sentById, actor.id),
        eq(candidates.coordinatorId, actor.id),
      )!,
    );
  }

  const rows = await db
    .select({
      id: messages.id,
      candidateId: messages.candidateId,
      candidateName: candidates.name,
      templateId: messages.templateId,
      templateName: messageTemplates.name,
      subject: messages.subject,
      channel: messages.channel,
      status: messages.status,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      sentAt: messages.sentAt,
      deliveredAt: messages.deliveredAt,
      openedAt: messages.openedAt,
      errorMessage: messages.errorMessage,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .leftJoin(candidates, eq(messages.candidateId, candidates.id))
    .leftJoin(messageTemplates, eq(messages.templateId, messageTemplates.id))
    .leftJoin(users, eq(messages.sentById, users.id))
    .where(condition)
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  const items = rows.map((r) => ({
    id: r.id,
    candidateId: r.candidateId,
    candidateName: r.candidateName ?? null,
    templateId: r.templateId,
    templateName: r.templateName ?? null,
    subject: r.subject ?? null,
    channel: r.channel,
    status: r.status,
    // Who sent it — null for system-triggered (onboarding, public-form) sends.
    senderName:
      r.senderFirstName || r.senderLastName
        ? `${r.senderFirstName ?? ''} ${r.senderLastName ?? ''}`.trim()
        : null,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
    openedAt: r.openedAt ? r.openedAt.toISOString() : null,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return { items, total: items.length };
}
