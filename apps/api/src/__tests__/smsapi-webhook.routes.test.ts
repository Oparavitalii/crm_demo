import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env BEFORE importing modules that touch env.ts
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../services/smsapi-webhook.service', () => ({
  handleDeliveryReport: vi.fn(),
  handleInbound: vi.fn().mockResolvedValue({ kind: 'message', candidateId: null }),
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as smsapiWebhook from '../services/smsapi-webhook.service';
import { errorHandler } from '../middleware/error-handler';

beforeEach(() => vi.clearAllMocks());

async function makeApp(): Promise<Hono> {
  const app = new Hono();
  app.onError(errorHandler);
  const { smsapiWebhookRouter } = await import('../routes/webhooks/smsapi');
  app.route('/webhooks/smsapi', smsapiWebhookRouter);
  return app;
}

describe('GET /webhooks/smsapi/delivery', () => {
  // SMSAPI docs §9: delivery reports are sent via GET with query-string params.
  // The panel's callback test also probes with GET — this route MUST answer it.
  it('parses query params and returns literal OK', async () => {
    const app = await makeApp();
    const res = await app.request(
      '/webhooks/smsapi/delivery?MsgId=EXT123&status=DELIVERED&idx=row-uuid&donedate=1751500000',
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
    expect(smsapiWebhook.handleDeliveryReport).toHaveBeenCalledWith({
      msgId: 'EXT123',
      status: 'DELIVERED',
      idx: 'row-uuid',
      doneDateUnix: 1751500000,
    });
  });

  it('returns OK without invoking the service when MsgId and idx are both missing (panel probe)', async () => {
    const app = await makeApp();
    const res = await app.request('/webhooks/smsapi/delivery');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
    expect(smsapiWebhook.handleDeliveryReport).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/smsapi/delivery', () => {
  it('parses form-urlencoded body and returns OK', async () => {
    const app = await makeApp();
    const res = await app.request('/webhooks/smsapi/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        MsgId: 'EXT456',
        status: 'SENT',
        idx: 'row-uuid-2',
      }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
    expect(smsapiWebhook.handleDeliveryReport).toHaveBeenCalledWith({
      msgId: 'EXT456',
      status: 'SENT',
      idx: 'row-uuid-2',
      doneDateUnix: undefined,
    });
  });
});

describe('POST /webhooks/smsapi/inbound', () => {
  it('parses inbound form body and returns OK', async () => {
    const app = await makeApp();
    const res = await app.request('/webhooks/smsapi/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sms_from: '48555111222',
        sms_to: '48999888777',
        sms_text: 'STOP',
        sms_date: '1751500000',
      }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
    expect(smsapiWebhook.handleInbound).toHaveBeenCalledWith(
      { from: '48555111222', to: '48999888777', text: 'STOP', receivedAtUnix: 1751500000 },
      expect.objectContaining({ ip: null }),
    );
  });

  it('returns OK without invoking the service when sms_from / sms_text missing', async () => {
    const app = await makeApp();
    const res = await app.request('/webhooks/smsapi/inbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sms_to: '48999888777' }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
    expect(smsapiWebhook.handleInbound).not.toHaveBeenCalled();
  });
});
