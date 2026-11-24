import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';
process.env.SMS_ENABLED = 'true';
process.env.SMS_TEST_MODE = 'true';
process.env.SMSAPI_TOKEN = 'token-12345';
process.env.SMSAPI_SENDER = 'CRMDEMO';

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('smsapi.client.sendSms', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sent outcome on happy path', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          count: 1,
          list: [
            { id: '999111', points: 0.16, number: '48500111222', date_sent: 1, status: 'QUEUE' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { sendSms } = await import('../clients/smsapi.client');
    const outcome = await sendSms({ to: '48500111222', message: 'cześć', idx: 'idx-1' });

    expect(outcome.kind).toBe('sent');
    if (outcome.kind === 'sent') {
      expect(outcome.result.msgId).toBe('999111');
      expect(outcome.result.points).toBeCloseTo(0.16);
    }

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.smsapi.pl/sms.do');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('to')).toBe('48500111222');
    expect(body.get('encoding')).toBe('utf-8');
    expect(body.get('idx')).toBe('idx-1');
    expect(body.get('check_idx')).toBe('1');
    expect(body.get('test')).toBe('1');
    expect(body.get('from')).toBe('CRMDEMO');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-12345',
    });
  });

  it('returns failed outcome on provider error (error code 13 = invalid phone)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 13, message: 'No correct phone numbers' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { sendSms } = await import('../clients/smsapi.client');
    const outcome = await sendSms({ to: 'bad', message: 'hi', idx: 'idx-bad' });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.smsapiCode).toBe(13);
      expect(outcome.error).toBe('No correct phone numbers');
    }
  });

  it('returns failed outcome on network error / timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('aborted'));

    const { sendSms } = await import('../clients/smsapi.client');
    const outcome = await sendSms({ to: '48500111222', message: 'hi', idx: 'idx-net' });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.error).toMatch(/network:/);
    }
  });
});

describe('mapSmsapiStatus', () => {
  it('maps known SMSAPI statuses to our enum', async () => {
    const { mapSmsapiStatus } = await import('../clients/smsapi.client');
    expect(mapSmsapiStatus('DELIVERED')).toBe('delivered');
    expect(mapSmsapiStatus('SENT')).toBe('sent');
    expect(mapSmsapiStatus('QUEUE')).toBe('queued');
    expect(mapSmsapiStatus('UNDELIV')).toBe('failed');
    expect(mapSmsapiStatus('EXPIRED')).toBe('failed');
    expect(mapSmsapiStatus('REJECTED')).toBe('failed');
  });
});
