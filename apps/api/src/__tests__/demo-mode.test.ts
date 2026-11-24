import { afterAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// DEMO_MODE must be set before env.ts is first imported, and the R2 settings
// are deliberately absent: demo mode has to boot without object storage.
const saved = { ...process.env };
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.RESEND_API_KEY = 're_test_key_aaaaaaaaaaaaaaa';
process.env.SMS_ENABLED = 'true';
process.env.SMSAPI_TOKEN = 'token-12345';
process.env.DEMO_MODE = 'true';
for (const k of ['R2_ENDPOINT', 'R2_ACCESS_KEY', 'R2_SECRET_KEY', 'R2_BUCKET']) delete process.env[k];

const resendSend = vi.fn();
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: resendSend } })) }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterAll(() => {
  process.env = saved;
});

describe('env in demo mode', () => {
  it('boots without R2 settings by filling inert placeholders', async () => {
    const { env } = await import('../env');
    expect(env.DEMO_MODE).toBe(true);
    expect(env.R2_ENDPOINT).toBe('http://storage.invalid');
    expect(env.DEMO_USER_EMAIL).toBe('demo@crm-demo.example');
  });
});

describe('external services are no-ops in demo mode', () => {
  it('sendEmail never calls Resend, even with an API key configured', async () => {
    const { sendEmail } = await import('../clients/resend.client');
    const out = await sendEmail({ to: 'a@example.com', subject: 's', html: '<p>x</p>' });
    expect(out?.id).toMatch(/^demo-skip-/);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('sendSms simulates an accepted send without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { sendSms } = await import('../clients/smsapi.client');
    const out = await sendSms({ to: '48555000111', message: 'hi', idx: 'idx-1' });
    expect(out).toEqual({ kind: 'sent', result: { msgId: 'demo-idx-1', points: 0, status: 'QUEUE' } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('object storage refuses uploads and downloads, deletes are no-ops', async () => {
    const r2 = await import('../clients/r2.client');
    await expect(r2.putObject({ key: 'k', body: Buffer.from('x'), contentType: 'application/pdf' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, meta: { reason: 'disabled_in_demo' } });
    await expect(r2.presignGet('k')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(r2.deleteObject('k')).resolves.toEqual({ deleted: false });
  });
});

describe('demoGuard', () => {
  async function app() {
    const { demoGuard } = await import('../demo/guard');
    const { errorHandler } = await import('../middleware/error-handler');
    const a = new Hono();
    a.use('*', demoGuard);
    a.all('*', (c) => c.json({ ok: true }));
    a.onError(errorHandler);
    return a;
  }

  it.each([
    ['POST', '/auth/2fa/enroll'],
    ['POST', '/auth/reset-password/request'],
    ['POST', '/me/reset-password'],
    ['POST', '/admin/users'],
    ['PATCH', '/admin/users/3f0c7d1e-0000-4000-8000-000000000001'],
    ['DELETE', '/admin/users/3f0c7d1e-0000-4000-8000-000000000001'],
    ['POST', '/admin/users/3f0c7d1e-0000-4000-8000-000000000001/reset-password'],
    ['POST', '/admin/invitations'],
    ['POST', '/register'],
    ['POST', '/admin/documents/file'],
  ])('blocks %s %s with 403 disabled_in_demo', async (method, path) => {
    const res = await (await app()).request(path, { method });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN', meta: { reason: 'disabled_in_demo' } });
  });

  it.each([
    ['POST', '/auth/login'],
    ['GET', '/admin/users'],
    ['POST', '/candidates'],
    ['PATCH', '/candidates/abc'],
    ['POST', '/communications/send'],
    ['POST', '/admin/documents/markdown'],
  ])('lets %s %s through', async (method, path) => {
    const res = await (await app()).request(path, { method });
    expect(res.status).toBe(200);
  });
});
