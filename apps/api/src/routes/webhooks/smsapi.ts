import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { env } from '../../env';
import { logger } from '../../lib/logger';
import { buildReqCtx, getClientIp } from '../../middleware/audit';
import { webhookRateLimiter } from '../../middleware/rate-limit';
import * as smsapiWebhook from '../../services/smsapi-webhook.service';

// SMSAPI publishes 5 source IPs for callbacks. We hardcode the list and reject
// anything else with 403 — there's no signing mechanism, so IP is the only
// authenticity guard. List from https://www.smsapi.pl/docs/.
const SMSAPI_CALLBACK_IPS = new Set([
  '89.174.81.98',
  '91.185.187.219',
  '213.189.53.211',
  '31.186.83.18',
  '212.91.26.253',
]);

const ipAllowlistGuard: MiddlewareHandler = async (c, next) => {
  // Localhost bypass for dev/integration tests — production NEVER receives
  // callbacks from 127.0.0.1, but vitest + curl + tunneled ngrok do.
  if (env.NODE_ENV !== 'production') {
    return next();
  }
  const ip = getClientIp(c);
  if (!ip || !SMSAPI_CALLBACK_IPS.has(ip)) {
    logger.warn({ ip }, 'smsapi_webhook_rejected_ip');
    return c.text('Forbidden', 403);
  }
  return next();
};

function parseUnix(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export const smsapiWebhookRouter = new Hono()
  // Delivery reports arrive as GET with query-string params (SMSAPI docs §9:
  // "Do skryptu wysyłane są parametry za pomocą metody GET"); POST with a form
  // body also exists in the wild. Accept both — confirmed 2026-07-02 via the
  // panel's callback test, which probes with GET and got 404 from the
  // previously POST-only route.
  .on(['GET', 'POST'], '/delivery', webhookRateLimiter, ipAllowlistGuard, async (c) => {
    const params: Record<string, unknown> =
      c.req.method === 'GET' ? c.req.query() : await c.req.parseBody();
    const msgId = (params['MsgId'] ?? params['msg_id'] ?? '') as string;
    const status = (params['status'] ?? params['status_name'] ?? '') as string;
    const idx = (params['idx'] ?? null) as string | null;
    const doneDate = parseUnix(params['donedate'] as string | undefined);

    if (!msgId && !idx) {
      logger.warn({ params }, 'smsapi_webhook_delivery_missing_keys');
      return c.text('OK'); // 2xx to avoid Svix-style retries from SMSAPI side
    }

    await smsapiWebhook.handleDeliveryReport({
      msgId,
      status,
      idx,
      doneDateUnix: doneDate,
    });

    // SMSAPI documents this contract: return literal "OK" string, anything else
    // triggers retries up to 14 days.
    return c.text('OK');
  })
  .post('/inbound', webhookRateLimiter, ipAllowlistGuard, async (c) => {
    const body = await c.req.parseBody();
    const from = (body['sms_from'] ?? '') as string;
    const to = (body['sms_to'] ?? '') as string;
    const text = (body['sms_text'] ?? '') as string;
    const receivedAt = parseUnix(body['sms_date'] as string | undefined);

    if (!from || !text) {
      logger.warn({ body }, 'smsapi_webhook_inbound_missing_keys');
      return c.text('OK');
    }

    await smsapiWebhook.handleInbound(
      { from, to, text, receivedAtUnix: receivedAt },
      buildReqCtx(c),
    );

    return c.text('OK');
  });
