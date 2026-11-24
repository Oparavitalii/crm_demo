import { Resend } from 'resend';
import { env } from '../env';
import { logger } from '../lib/logger';

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(env.RESEND_API_KEY);
  return client;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string } | null> {
  // In local dev we MUST NOT hit Resend even when RESEND_API_KEY is set —
  // smoke tests / MCP walks / admin "create user" clicks would otherwise spam
  // real inboxes and burn Resend quota. Log the would-be payload so devs can
  // still inspect what was about to go out. Production keeps the live path;
  // vitest ('test') keeps the live path with the Resend SDK mocked at module
  // level so no real send happens either.
  if (env.NODE_ENV === 'development') {
    logger.info(
      { to: input.to, subject: input.subject },
      'Email send skipped — NODE_ENV=development',
    );
    return { id: `dev-skip-${Date.now()}` };
  }
  // Public demo: guests can trigger sends (bulk send, consent campaign), and
  // the seeded recipients are fake example.com addresses. Report success so
  // the message history looks real, but never reach Resend — even if a key
  // is configured by mistake.
  if (env.DEMO_MODE) {
    logger.info({ subject: input.subject }, 'Email send skipped — DEMO_MODE');
    return { id: `demo-skip-${Date.now()}` };
  }
  const c = getClient();
  if (!c) {
    logger.warn({ to: input.to, subject: input.subject }, 'RESEND_API_KEY not set — skipping email');
    return null;
  }
  const { data, error } = await c.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (error) {
    logger.error({ err: error }, 'Resend send error');
    return null;
  }
  return data ? { id: data.id } : null;
}
