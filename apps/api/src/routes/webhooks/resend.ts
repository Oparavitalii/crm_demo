import { Hono } from 'hono';
import { Webhook } from 'svix';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import { buildReqCtx } from '../../middleware/audit';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import * as webhookService from '../../services/resend-webhook.service';

// Idempotency note (design decision):
// We rely on SQL-level idempotency via `WHERE delivered_at IS NULL` (and
// equivalent for opened_at). A retried event re-targets the same row and the
// UPDATE matches zero rows on the second hit. A separate `webhook_events_seen`
// table tracking `svix-id` was considered but rejected — overkill at our scale
// (20 users, low email volume) and the WHERE-clause guard already covers it.

// Resend event payload shape — typed permissively. We narrow per-event below.
interface ResendEventPayload {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    bounce?: { message?: string; type?: string };
    [key: string]: unknown;
  };
}

function parseOccurredAt(payload: ResendEventPayload): Date {
  const raw = payload.created_at;
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export const resendWebhookRouter = new Hono().post('/', webhookRateLimiter, async (c) => {
  if (!env.RESEND_WEBHOOK_SECRET) {
    logger.warn('resend_webhook_secret_unset');
    return c.json(
      { error: 'WEBHOOK_NOT_CONFIGURED', meta: { reason: 'RESEND_WEBHOOK_SECRET not set' } },
      503,
    );
  }

  // Svix signs the raw body — do NOT use c.req.json() (any whitespace drift
  // breaks the HMAC). Pull text and feed it verbatim to wh.verify.
  const rawBody = await c.req.text();
  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new AppError('UNAUTHORIZED', { reason: 'missing_signature_headers' }, 401);
  }

  const wh = new Webhook(env.RESEND_WEBHOOK_SECRET);
  let payload: ResendEventPayload;
  try {
    payload = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendEventPayload;
  } catch (err) {
    logger.warn({ err, svixId }, 'resend_webhook_invalid_signature');
    throw new AppError('UNAUTHORIZED', { reason: 'invalid_signature' }, 401);
  }

  const eventType = payload.type;
  const externalId = payload.data?.email_id;
  const reqCtx = buildReqCtx(c);
  const occurredAt = parseOccurredAt(payload);

  if (!externalId) {
    logger.warn({ eventType, svixId }, 'resend_webhook_missing_email_id');
    return c.json({ ok: true });
  }

  switch (eventType) {
    case 'email.delivered':
      await webhookService.handleEmailDelivered({ externalId, occurredAt, reqCtx });
      break;
    case 'email.opened':
      await webhookService.handleEmailOpened({ externalId, occurredAt, reqCtx });
      break;
    case 'email.bounced': {
      const bounce = payload.data?.bounce;
      await webhookService.handleEmailBounced({
        externalId,
        reason: bounce?.message ?? null,
        bounceType: bounce?.type ?? null,
        reqCtx,
      });
      break;
    }
    case 'email.complained':
      await webhookService.handleEmailComplained({ externalId, reqCtx });
      break;
    case 'email.sent':
    case 'email.clicked':
    case 'email.delivery_delayed':
      // Acknowledged but no state change here — `email.sent` is already set on
      // our side when bulk-send wrote the row, `clicked` doesn't map to an
      // existing column yet, and `delivery_delayed` is informational.
      logger.info({ eventType, externalId }, 'resend_webhook_event_ignored');
      break;
    default:
      logger.info({ eventType, externalId }, 'resend_webhook_event_unknown');
      break;
  }

  // Always 2xx for accepted events — non-2xx triggers Svix retries.
  return c.json({ ok: true });
});
