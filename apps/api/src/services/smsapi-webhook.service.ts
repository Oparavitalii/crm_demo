import { and, eq, isNull, or } from 'drizzle-orm';
import { CONSENT_SOURCES } from '@opushr/shared';
import { db } from '../db/client';
import { candidates } from '../db/tables/candidates';
import { consents } from '../db/tables/consents';
import { messages } from '../db/tables/messages';
import { mapSmsapiStatus } from '../clients/smsapi.client';
import { logger } from '../lib/logger';
import { normalizePhone } from '../lib/normalize';
import * as audit from './audit.service';

const STOP_KEYWORDS = /^\s*(stop|stopp|rezygnacja|nie)\s*$/i;
const SMS_CONSENT_TYPE = 'sms_marketing';

interface DeliveryReport {
  msgId: string;
  status: string;
  idx?: string | null;
  doneDateUnix?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function handleDeliveryReport(report: DeliveryReport): Promise<void> {
  const mappedStatus = mapSmsapiStatus(report.status);

  // Prefer idx (our messages.id) over MsgId (external id) for the WHERE clause —
  // we always send a UUID idx, so it's the strong key. Fall back to external_id
  // otherwise: messages.id is a uuid column, and a non-UUID idx (SMSAPI's panel
  // "Test" probe sends the literal `idx=IDX`) makes Postgres throw on the cast
  // before the WHERE could simply miss → 500 and a 14-day retry loop.
  const target =
    report.idx && isUuid(report.idx)
      ? eq(messages.id, report.idx)
      : eq(messages.externalId, report.msgId);

  const updateData: Partial<typeof messages.$inferInsert> = {
    status: mappedStatus,
    externalId: report.msgId,
  };
  if (mappedStatus === 'delivered') {
    updateData.deliveredAt = report.doneDateUnix
      ? new Date(report.doneDateUnix * 1000)
      : new Date();
  }
  if (mappedStatus === 'sent' && report.doneDateUnix) {
    updateData.sentAt = new Date(report.doneDateUnix * 1000);
  }

  const result = await db
    .update(messages)
    .set(updateData)
    .where(and(eq(messages.channel, 'sms'), target)!);

  logger.info(
    { msgId: report.msgId, idx: report.idx, mappedStatus, rawStatus: report.status },
    'sms_delivery_report_processed',
  );

  // Drizzle's UPDATE doesn't return affected count uniformly — best-effort log.
  void result;
}

interface InboundMessage {
  from: string;
  to: string;
  text: string;
  receivedAtUnix?: number;
}

interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

export async function handleInbound(
  msg: InboundMessage,
  ctx: ReqCtx,
): Promise<{ kind: 'stop' | 'message'; candidateId: string | null }> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.phone, msg.from),
  });

  const candidateId = candidate?.id ?? null;
  const isStop = STOP_KEYWORDS.test(msg.text);

  // Persist the inbound itself so recruiters can see replies. We never had an
  // inbound row before — this is the first user of `direction='inbound'`.
  await db.insert(messages).values({
    candidateId,
    channel: 'sms',
    direction: 'inbound',
    body: msg.text,
    status: 'delivered',
    sentAt: msg.receivedAtUnix ? new Date(msg.receivedAtUnix * 1000) : new Date(),
  });

  if (isStop) {
    // Match the active sms_marketing consent by the sender's PHONE (primary
    // SMS identity) or, for legacy email-keyed rows, the candidate's email.
    const normFrom = normalizePhone(msg.from);
    const matchers = [];
    if (normFrom) matchers.push(eq(consents.candidatePhone, normFrom));
    if (candidate?.email) matchers.push(eq(consents.candidateEmail, candidate.email));

    // Nothing to key on (no usable phone, no candidate email) — treat as a
    // normal inbound; we can't identify whose consent to withdraw.
    if (matchers.length > 0) {
      const existing = await db.query.consents.findFirst({
        where: and(
          eq(consents.consentType, SMS_CONSENT_TYPE),
          isNull(consents.withdrawnAt),
          or(...matchers)!,
        )!,
      });

      if (existing) {
        await db
          .update(consents)
          .set({ withdrawnAt: new Date(), ip: ctx.ip, userAgent: ctx.userAgent })
          .where(eq(consents.id, existing.id));
      } else {
        // INSERT a withdrawn-already marker so the audit trail is clean.
        await db.insert(consents).values({
          candidateEmail: candidate?.email ?? null,
          candidatePhone: normFrom,
          consentType: SMS_CONSENT_TYPE,
          version: 'sms-stop-inbound',
          source: CONSENT_SOURCES.smsStopInbound,
          withdrawnAt: new Date(),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }

      if (candidate) {
        await audit.log({
          actorId: null,
          action: 'consent.sms.withdrawn_via_stop',
          entityType: 'candidate',
          entityId: candidate.id,
          newValue: { trigger: 'inbound_stop_sms', from: msg.from },
          ...ctx,
        });
      }

      logger.info({ candidateId, from: msg.from }, 'sms_inbound_stop_processed');
      return { kind: 'stop', candidateId };
    }
  }

  logger.info(
    { candidateId, from: msg.from, isStop },
    'sms_inbound_message_received',
  );
  return { kind: 'message', candidateId };
}
