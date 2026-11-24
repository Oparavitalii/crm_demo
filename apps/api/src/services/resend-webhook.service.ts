import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { messages } from '../db/tables/messages';
import * as audit from './audit.service';
import { logger } from '../lib/logger';

interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

// Cap the bounce / complaint reason we keep so a long upstream response can't
// blow up the row or the audit jsonb column.
const ERROR_MESSAGE_MAX = 500;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

async function findMessageIdByExternal(externalId: string): Promise<string | null> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.externalId, externalId))
    .limit(1);
  return rows[0]?.id ?? null;
}

interface DeliveredInput {
  externalId: string;
  occurredAt: Date;
  reqCtx: ReqCtx;
}

export async function handleEmailDelivered(input: DeliveredInput): Promise<void> {
  const { externalId, occurredAt, reqCtx } = input;
  const updated = await db
    .update(messages)
    .set({ status: 'delivered', deliveredAt: occurredAt })
    .where(and(eq(messages.externalId, externalId), isNull(messages.deliveredAt)))
    .returning({ id: messages.id });

  // SQL idempotency: WHERE delivered_at IS NULL means a retry hit is a no-op.
  if (updated.length === 0) {
    const messageId = await findMessageIdByExternal(externalId);
    if (!messageId) {
      logger.warn({ externalId, event: 'email.delivered' }, 'resend_webhook_orphan');
    }
    return;
  }

  const row = updated[0]!;
  await audit.log({
    actorId: null,
    action: 'message.delivered',
    entityType: 'message',
    entityId: row.id,
    newValue: { externalId },
    ...reqCtx,
  });
}

interface OpenedInput {
  externalId: string;
  occurredAt: Date;
  reqCtx: ReqCtx;
}

export async function handleEmailOpened(input: OpenedInput): Promise<void> {
  const { externalId, occurredAt, reqCtx } = input;
  const updated = await db
    .update(messages)
    .set({ status: 'opened', openedAt: occurredAt })
    .where(and(eq(messages.externalId, externalId), isNull(messages.openedAt)))
    .returning({ id: messages.id });

  if (updated.length === 0) {
    const messageId = await findMessageIdByExternal(externalId);
    if (!messageId) {
      logger.warn({ externalId, event: 'email.opened' }, 'resend_webhook_orphan');
    }
    return;
  }

  const row = updated[0]!;
  await audit.log({
    actorId: null,
    action: 'message.opened',
    entityType: 'message',
    entityId: row.id,
    newValue: { externalId },
    ...reqCtx,
  });
}

interface BouncedInput {
  externalId: string;
  reason: string | null;
  bounceType: string | null;
  reqCtx: ReqCtx;
}

export async function handleEmailBounced(input: BouncedInput): Promise<void> {
  const { externalId, reason, bounceType, reqCtx } = input;
  const errorMessage = reason ? truncate(reason, ERROR_MESSAGE_MAX) : 'bounced';
  const updated = await db
    .update(messages)
    .set({ status: 'failed', errorMessage })
    .where(eq(messages.externalId, externalId))
    .returning({ id: messages.id });

  if (updated.length === 0) {
    logger.warn({ externalId, event: 'email.bounced' }, 'resend_webhook_orphan');
    return;
  }

  const row = updated[0]!;
  // docs/Engineering_Rules.md "No PII in audit values": the reason string can leak recipient
  // address or upstream response content. Persist only boolean + bounce_type.
  await audit.log({
    actorId: null,
    action: 'message.bounced',
    entityType: 'message',
    entityId: row.id,
    newValue: { externalId, bounceType, hadReason: reason !== null },
    ...reqCtx,
  });
}

interface ComplainedInput {
  externalId: string;
  reqCtx: ReqCtx;
}

export async function handleEmailComplained(input: ComplainedInput): Promise<void> {
  const { externalId, reqCtx } = input;
  const updated = await db
    .update(messages)
    .set({ status: 'failed', errorMessage: 'complaint' })
    .where(eq(messages.externalId, externalId))
    .returning({ id: messages.id });

  if (updated.length === 0) {
    logger.warn({ externalId, event: 'email.complained' }, 'resend_webhook_orphan');
    return;
  }

  const row = updated[0]!;
  await audit.log({
    actorId: null,
    action: 'message.complained',
    entityType: 'message',
    entityId: row.id,
    newValue: { externalId },
    ...reqCtx,
  });
}
