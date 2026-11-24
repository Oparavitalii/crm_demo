import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const infoSpy = vi.fn();
vi.mock('../lib/logger', () => ({
  logger: { info: (...a: unknown[]) => infoSpy(...a), warn: vi.fn(), error: vi.fn() },
}));

const { requestLog } = await import('../middleware/request-log');

describe('requestLog', () => {
  beforeEach(() => infoSpy.mockClear());

  it('logs method, path, status and duration', async () => {
    const app = new Hono().use('*', requestLog).get('/candidates', (c) => c.json({ ok: true }));
    const res = await app.request('/candidates');
    expect(res.status).toBe(200);
    const [fields, msg] = infoSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('req');
    expect(fields.method).toBe('GET');
    expect(fields.path).toBe('/candidates');
    expect(fields.status).toBe(200);
    expect(typeof fields.ms).toBe('number');
  });

  it('never logs the query string — it can carry candidate names', async () => {
    const app = new Hono().use('*', requestLog).get('/candidates', (c) => c.json({ ok: true }));
    await app.request('/candidates?search=Kowalski&phone=48123456789');
    const [fields] = infoSpy.mock.calls[0] as [Record<string, unknown>];
    expect(JSON.stringify(fields)).not.toContain('Kowalski');
    expect(JSON.stringify(fields)).not.toContain('48123456789');
  });

  it('still logs when the handler throws', async () => {
    const app = new Hono()
      .use('*', requestLog)
      .get('/boom', () => {
        throw new Error('nope');
      });
    // Hono types app.request() as `Response | Promise<Response>`; normalise
    // before catching so the throw is swallowed rather than failing the run.
    await Promise.resolve(app.request('/boom')).catch(() => undefined);
    expect(infoSpy).toHaveBeenCalled();
  });
});
