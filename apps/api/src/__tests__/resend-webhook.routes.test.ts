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
process.env.RESEND_WEBHOOK_SECRET = 'whsec_test_secret';

// Chainable Drizzle mock (same pattern as bulk-send.service.test.ts).
// `update().set().where().returning()` and `select().from().where().limit()`
// both resolve when awaited to whatever the chain was constructed with.
function makeThenableChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'orderBy', 'limit', 'leftJoin', 'set'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolvedValue).then(resolve);
  chain.catch = (reject: (e: unknown) => unknown) =>
    Promise.resolve(resolvedValue).catch(reject);
  chain.finally = (cb: () => void) => Promise.resolve(resolvedValue).finally(cb);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/client', () => ({
  db: {
    get select() {
      return mockSelect;
    },
    get update() {
      return mockUpdate;
    },
  },
}));

// Svix Webhook mock — verify() either returns the payload or throws.
const mockVerify = vi.fn();
vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({ verify: mockVerify })),
}));

vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from 'hono';
import * as audit from '../services/audit.service';
import { errorHandler } from '../middleware/error-handler';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_test_secret';
});

async function makeApp(): Promise<Hono> {
  const app = new Hono();
  app.onError(errorHandler);
  const { resendWebhookRouter } = await import('../routes/webhooks/resend');
  app.route('/webhooks/resend', resendWebhookRouter);
  return app;
}

const VALID_HEADERS = {
  'svix-id': 'msg_test_1',
  'svix-timestamp': '1234567890',
  'svix-signature': 'v1,fake',
  'Content-Type': 'application/json',
};

const EXTERNAL_ID = 'resend-msg-abc-123';
const MESSAGE_ID = '00000000-0000-0000-0000-000000000050';

describe('POST /webhooks/resend — signature handling', () => {
  it('returns 401 when signature verification throws', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('Invalid signature');
    });
    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({ type: 'email.delivered', data: { email_id: EXTERNAL_ID } }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 when svix headers are missing', async () => {
    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email.delivered', data: { email_id: EXTERNAL_ID } }),
    });
    expect(res.status).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('returns 503 when RESEND_WEBHOOK_SECRET is unset', async () => {
    // Temporarily blank the env value the route reads. We hold a reference to
    // the parsed env object through the mocked module — env.ts itself is
    // parsed once at process start, so the cleanest way to flip the flag is
    // to mutate the exported object for this test only.
    const envModule = await import('../env');
    const original = envModule.env.RESEND_WEBHOOK_SECRET;
    (envModule.env as { RESEND_WEBHOOK_SECRET?: string }).RESEND_WEBHOOK_SECRET = undefined;
    try {
      const app = await makeApp();
      const res = await app.request('/webhooks/resend', {
        method: 'POST',
        headers: VALID_HEADERS,
        body: JSON.stringify({ type: 'email.delivered', data: { email_id: EXTERNAL_ID } }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('WEBHOOK_NOT_CONFIGURED');
    } finally {
      (envModule.env as { RESEND_WEBHOOK_SECRET?: string }).RESEND_WEBHOOK_SECRET = original;
    }
  });
});

describe('POST /webhooks/resend — email.delivered', () => {
  it('sets deliveredAt and writes audit log', async () => {
    mockVerify.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-06-14T10:00:00Z',
      data: { email_id: EXTERNAL_ID },
    });
    // update().set().where().returning() resolves to one row
    mockUpdate.mockReturnValue(makeThenableChain([{ id: MESSAGE_ID }]));

    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        action: 'message.delivered',
        entityType: 'message',
        entityId: MESSAGE_ID,
        newValue: { externalId: EXTERNAL_ID },
      }),
    );
  });

  it('second hit (idempotent retry) is a no-op — no audit log', async () => {
    mockVerify.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-06-14T10:00:00Z',
      data: { email_id: EXTERNAL_ID },
    });
    // First call: update affects 0 rows (delivered_at IS NULL guard).
    mockUpdate.mockReturnValue(makeThenableChain([]));
    // Fallback select() to confirm the row exists → return existing message id
    mockSelect.mockReturnValue(makeThenableChain([{ id: MESSAGE_ID }]));

    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/resend — email.opened', () => {
  it('sets openedAt and writes audit log', async () => {
    mockVerify.mockReturnValue({
      type: 'email.opened',
      created_at: '2026-06-14T10:05:00Z',
      data: { email_id: EXTERNAL_ID },
    });
    mockUpdate.mockReturnValue(makeThenableChain([{ id: MESSAGE_ID }]));

    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'message.opened',
        entityType: 'message',
        entityId: MESSAGE_ID,
      }),
    );
  });
});

describe('POST /webhooks/resend — email.bounced', () => {
  it('sets status=failed + errorMessage; audit newValue contains no raw reason text', async () => {
    mockVerify.mockReturnValue({
      type: 'email.bounced',
      created_at: '2026-06-14T10:10:00Z',
      data: {
        email_id: EXTERNAL_ID,
        bounce: {
          message: 'mailbox full — leaks recipient address recipient@example.com',
          type: 'soft',
        },
      },
    });
    mockUpdate.mockReturnValue(makeThenableChain([{ id: MESSAGE_ID }]));

    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    // Audit call must NOT contain the raw reason text (RODO — possible PII).
    const auditCalls = vi.mocked(audit.log).mock.calls;
    expect(auditCalls.length).toBeGreaterThan(0);
    const auditEntry = auditCalls[0]![0];
    expect(auditEntry.action).toBe('message.bounced');
    const newValue = auditEntry.newValue as Record<string, unknown>;
    expect(newValue).toEqual({
      externalId: EXTERNAL_ID,
      bounceType: 'soft',
      hadReason: true,
    });
    // Defensive: the raw bounce message must never appear anywhere in newValue.
    expect(JSON.stringify(newValue)).not.toContain('recipient@example.com');
  });
});

describe('POST /webhooks/resend — orphan event (no matching row)', () => {
  it('returns 200 and does not throw when externalId matches no message', async () => {
    mockVerify.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-06-14T10:00:00Z',
      data: { email_id: 'orphan-id' },
    });
    // update returns no rows
    mockUpdate.mockReturnValue(makeThenableChain([]));
    // select returns no rows either
    mockSelect.mockReturnValue(makeThenableChain([]));

    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/resend — unhandled event types', () => {
  it('returns 200 for email.clicked without DB mutation', async () => {
    mockVerify.mockReturnValue({
      type: 'email.clicked',
      created_at: '2026-06-14T10:00:00Z',
      data: { email_id: EXTERNAL_ID },
    });
    const app = await makeApp();
    const res = await app.request('/webhooks/resend', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
