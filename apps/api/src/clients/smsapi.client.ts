import { env } from '../env';
import { logger } from '../lib/logger';

const SMSAPI_ENDPOINT = 'https://api.smsapi.pl/sms.do';

export interface SendSmsInput {
  to: string;
  message: string;
  // Idempotency key; SMSAPI deduplicates requests sharing the same `idx` within
  // 24h when `check_idx=1` is set. Use the messages.id row UUID so a retry of
  // the same row never charges twice.
  idx: string;
}

export interface SendSmsResult {
  msgId: string;
  points: number;
  status: string;
}

export type SendSmsOutcome =
  | { kind: 'sent'; result: SendSmsResult }
  | { kind: 'disabled'; reason: 'sms_disabled' | 'no_token' }
  | { kind: 'failed'; error: string; smsapiCode?: number };

interface SmsapiSuccess {
  count: number;
  list: Array<{
    id: string;
    points: number;
    number: string;
    date_sent: number;
    status: string;
  }>;
}

interface SmsapiError {
  error: number;
  message: string;
  invalid_numbers?: Array<{ number: string; message: string }>;
}

function isSuccess(payload: unknown): payload is SmsapiSuccess {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as { list?: unknown };
  return Array.isArray(p.list);
}

function isError(payload: unknown): payload is SmsapiError {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as { error?: unknown };
  return typeof p.error === 'number';
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsOutcome> {
  // Public demo: simulate an accepted send (zero cost) so the bulk-send flow
  // and message history can be shown end to end. Checked first, so no
  // combination of SMS_* settings can make the demo reach SMSAPI.
  if (env.DEMO_MODE) {
    logger.info({ idx: input.idx }, 'sms_send_simulated — DEMO_MODE');
    return { kind: 'sent', result: { msgId: `demo-${input.idx}`, points: 0, status: 'QUEUE' } };
  }
  if (!env.SMS_ENABLED) {
    logger.warn({ to: input.to, idx: input.idx }, 'sms_send_skipped — SMS_ENABLED=false');
    return { kind: 'disabled', reason: 'sms_disabled' };
  }
  if (!env.SMSAPI_TOKEN) {
    logger.warn({ to: input.to, idx: input.idx }, 'sms_send_skipped — SMSAPI_TOKEN not set');
    return { kind: 'disabled', reason: 'no_token' };
  }

  // application/x-www-form-urlencoded; URLSearchParams handles UTF-8 escaping.
  const body = new URLSearchParams({
    to: input.to,
    message: input.message,
    from: env.SMSAPI_SENDER,
    encoding: 'utf-8',
    format: 'json',
    idx: input.idx,
    check_idx: '1',
    // Hard cap of 3 message parts (~210 unicode chars). Above this we'd both
    // burn budget and be over the standard "SMS feel" — frontend prevents
    // composing longer bodies, this is a backstop.
    max_parts: '3',
  });
  if (env.SMS_TEST_MODE) body.set('test', '1');

  let response: Response;
  try {
    response = await fetch(SMSAPI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SMSAPI_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed';
    logger.error({ err, idx: input.idx, to: input.to }, 'sms_send_network_error');
    return { kind: 'failed', error: `network: ${message}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    logger.error({ err, idx: input.idx, status: response.status }, 'sms_send_invalid_json');
    return { kind: 'failed', error: `invalid_json_status_${response.status}` };
  }

  if (isError(payload)) {
    logger.warn(
      { idx: input.idx, smsapiCode: payload.error, smsapiMessage: payload.message },
      'sms_send_provider_error',
    );
    return {
      kind: 'failed',
      error: payload.message ?? `smsapi_error_${payload.error}`,
      smsapiCode: payload.error,
    };
  }

  if (!isSuccess(payload) || payload.list.length === 0) {
    logger.error({ idx: input.idx, payload }, 'sms_send_unexpected_payload');
    return { kind: 'failed', error: 'unexpected_payload' };
  }

  const entry = payload.list[0]!;
  return {
    kind: 'sent',
    result: { msgId: entry.id, points: entry.points, status: entry.status },
  };
}

// Maps SMSAPI delivery-report statuses to our message_status enum.
// See https://www.smsapi.pl/docs/ section "Lista statusow doreczenia".
export function mapSmsapiStatus(smsapiStatus: string):
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed' {
  const s = smsapiStatus.toUpperCase();
  if (s === 'DELIVERED') return 'delivered';
  if (s === 'SENT' || s === 'ACCEPTD') return 'sent';
  if (s === 'QUEUE' || s === 'ACCEPTED' || s === 'NEW' || s === 'PENDING') return 'queued';
  return 'failed';
}
