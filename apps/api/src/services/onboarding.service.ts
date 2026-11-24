import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { messages } from '../db/tables/messages';
import { sendEmail } from '../clients/resend.client';
import * as templatesRepo from '../repositories/message-templates.repo';
import * as consentsRepo from '../repositories/consents.repo';
import { substituteHtml } from './bulk-send.service';
import { env } from '../env';
import { logger } from '../lib/logger';

const CONFIRM_PLACEHOLDER = '{{consentConfirmUrl}}';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface WelcomeTarget {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

// Best-effort welcome/onboarding email for a newly created candidate. NEVER
// throws — a failure here must not roll back candidate creation. Sends only if
// (a) an email template is flagged auto-send, and (b) the candidate has an
// email. If the template body carries {{consentConfirmUrl}}, mints an opt-in
// token so the transactional welcome doubles as a lawful re-consent ask.
export async function sendWelcomeEmailOnCreate(
  candidate: WelcomeTarget,
  actorId: string | null,
): Promise<void> {
  try {
    // Global kill-switch — dark by default until the consent wording is
    // approved by legal. Nothing auto-sends while this is off.
    if (!env.ONBOARDING_AUTOSEND_ENABLED) return;
    if (!candidate.email) return;
    const template = await templatesRepo.findAutoSendTemplate();
    if (!template) return;

    const vars = { name: candidate.name, email: candidate.email, phone: candidate.phone };
    const subject = substituteHtml(template.subject ?? '', vars);
    let body = substituteHtml(template.body, vars);

    if (template.body.includes(CONFIRM_PLACEHOLDER)) {
      const tokenRow = await consentsRepo.createOptinToken({
        candidateId: candidate.id,
        candidateEmail: candidate.email,
        candidatePhone: candidate.phone,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      });
      body = body
        .split(CONFIRM_PLACEHOLDER)
        .join(`${env.APP_URL}/consent/confirm/${tokenRow.token}`);
    }

    const [msgRow] = await db
      .insert(messages)
      .values({
        candidateId: candidate.id,
        channel: 'email',
        direction: 'outbound',
        templateId: template.id,
        subject,
        body,
        status: 'queued',
        sentById: actorId,
      })
      .returning();

    const result = await sendEmail({
      to: candidate.email,
      subject,
      html: body,
      text: body.replace(/<[^>]+>/g, ''),
    });

    if (msgRow) {
      await db
        .update(messages)
        .set(
          result
            ? { status: 'sent', sentAt: new Date(), externalId: result.id }
            : { status: 'failed', errorMessage: 'Email client returned no result' },
        )
        .where(eq(messages.id, msgRow.id));
    }
  } catch (err) {
    logger.error({ err, candidateId: candidate.id }, 'onboarding welcome email failed');
  }
}
