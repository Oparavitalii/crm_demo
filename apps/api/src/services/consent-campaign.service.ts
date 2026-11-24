import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { ConsentCampaignInput } from '@crm/shared';
import { db } from '../db/client';
import { candidates } from '../db/tables/candidates';
import { consents } from '../db/tables/consents';
import { messages } from '../db/tables/messages';
import { sendEmail } from '../clients/resend.client';
import * as templatesRepo from '../repositories/message-templates.repo';
import * as consentsRepo from '../repositories/consents.repo';
import * as audit from './audit.service';
import {
  MAX_RECIPIENTS,
  buildWhereConditions,
  scopeFromActor,
  substituteHtml,
} from './bulk-send.service';
import { env } from '../env';
import { AppError, NotFoundError } from '../lib/errors';

const EMAIL_CONSENT_TYPE = 'email_marketing';
const CONFIRM_PLACEHOLDER = '{{consentConfirmUrl}}';
// A re-consent link is a slow-burn ask — give people a month to click it.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

export interface ConsentCampaignResult {
  recipientsTotal: number;
  sentCount: number;
  failedCount: number;
  skippedAlreadyConsented: number;
  dryRun: boolean;
  messageIds: string[];
}

// Emails that already hold an active email_marketing consent — re-asking them
// is pointless (and mildly spammy), so they're skipped.
async function loadConsentedEmails(): Promise<Set<string>> {
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
  const set = new Set<string>();
  for (const r of rows) if (r.email) set.add(r.email);
  return set;
}

export async function sendConsentCampaign(
  input: ConsentCampaignInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<ConsentCampaignResult> {
  if (actor.role === 'readonly') {
    throw new AppError('FORBIDDEN', undefined, 403);
  }

  const template = await templatesRepo.findById(input.templateId);
  if (!template) throw new NotFoundError('message_template');
  if (template.channel !== 'email') {
    throw new AppError('VALIDATION', { reason: 'template_channel_must_be_email' }, 400);
  }
  // The whole point of the campaign is the confirm link — a template without
  // the placeholder would mail a dead-end. Fail loudly instead.
  if (!template.body.includes(CONFIRM_PLACEHOLDER)) {
    throw new AppError('VALIDATION', { reason: 'template_missing_consent_confirm_url' }, 400);
  }

  const where = buildWhereConditions(
    input.filters,
    scopeFromActor(actor),
    input.recipientIds,
    'email',
  );
  const condition = where.length ? and(...where) : undefined;
  const rows = await db
    .select({ id: candidates.id, name: candidates.name, email: candidates.email, phone: candidates.phone })
    .from(candidates)
    .where(condition)
    .orderBy(candidates.createdAt)
    .limit(MAX_RECIPIENTS + 1);

  const withEmail = rows.filter(
    (r): r is typeof r & { email: string } => r.email !== null,
  );

  // Skip anyone who already opted into email — don't re-ask the consented.
  const alreadyConsented = await loadConsentedEmails();
  const targets = withEmail.filter((r) => !alreadyConsented.has(r.email));
  const skippedAlreadyConsented = withEmail.length - targets.length;

  const recipientsTotal = targets.length;
  if (recipientsTotal > MAX_RECIPIENTS) {
    throw new AppError('TOO_MANY_RECIPIENTS', { count: recipientsTotal, max: MAX_RECIPIENTS }, 400);
  }

  if (input.dryRun) {
    return { recipientsTotal, sentCount: 0, failedCount: 0, skippedAlreadyConsented, dryRun: true, messageIds: [] };
  }

  let sentCount = 0;
  let failedCount = 0;
  const messageIds: string[] = [];

  for (const recipient of targets) {
    // One-shot opt-in token per recipient; identifiers snapshot at send time.
    const tokenRow = await consentsRepo.createOptinToken({
      candidateId: recipient.id,
      candidateEmail: recipient.email,
      candidatePhone: recipient.phone,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });
    const confirmUrl = `${env.APP_URL}/consent/confirm/${tokenRow.token}`;

    const vars = { name: recipient.name, email: recipient.email, phone: recipient.phone };
    const subject = substituteHtml(template.subject ?? '', vars);
    const body = substituteHtml(template.body, vars).split(CONFIRM_PLACEHOLDER).join(confirmUrl);

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
    action: 'send_consent_campaign',
    entityType: 'message_template',
    entityId: template.id,
    newValue: { templateId: template.id, recipientsTotal, sentCount, failedCount, skippedAlreadyConsented },
    ...ctx,
  });

  return { recipientsTotal, sentCount, failedCount, skippedAlreadyConsented, dryRun: false, messageIds };
}
