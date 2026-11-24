import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// Mock db module before importing the router
vi.mock('../db/client', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
  },
}));

describe('GET /health (liveness)', () => {
  it('returns ok without touching the DB', async () => {
    const { healthRouter } = await import('../routes/health');
    const app = new Hono().route('/health', healthRouter);

    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    // Liveness MUST NOT include a `db` field — its whole purpose is to be
    // safe for Fly's frequent health-check without waking Neon.
    expect(body['db']).toBeUndefined();
  });
});

describe('GET /health/ready (readiness)', () => {
  it('returns ok status with db reachable', async () => {
    const { healthRouter } = await import('../routes/health');
    const app = new Hono().route('/health', healthRouter);

    const res = await app.request('/health/ready');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(body['db']).toBe('reachable');
    expect(typeof body['ts']).toBe('string');
  });

  it('returns 503 when db is unreachable', async () => {
    vi.resetModules();
    vi.doMock('../db/client', () => ({
      db: {
        execute: vi.fn().mockRejectedValue(new Error('connection refused')),
      },
    }));

    const { healthRouter } = await import('../routes/health');
    const app = new Hono().route('/health', healthRouter);

    const res = await app.request('/health/ready');
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('error');
    expect(body['db']).toBe('unreachable');
  });
});
