import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE on mocking strategy: this suite mocks the `resend` package at the SDK
// module level via `vi.mock('resend', ...)` rather than going through MSW.
// MSW intercepts fetch, and while the Resend SDK does use fetch under the
// hood, mocking the SDK itself is:
//   1. simpler (we don't need to know Resend's API URL or payload shape),
//   2. closer to the contract our code actually depends on (the SDK's
//      `emails.send` return shape), and
//   3. unaffected by Resend bumping its SDK to a different transport.
// The MSW server (see `_msw/setup.ts`) is still running for these tests, but
// because the SDK is replaced with a vi-mock the fetch layer is never reached.

// Set env BEFORE importing modules that touch env.ts.
// Important: RESEND_API_KEY must start with "re_" per env schema, and must be
// non-empty so the resend client is actually constructed (otherwise sendEmail
// short-circuits without calling the SDK).
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';
process.env.RESEND_API_KEY = 're_test_key_aaaaaaaaaaaaaaa';
process.env.EMAIL_FROM = 'test@example.com';
process.env.APP_URL = 'https://app.example.com';

// Mock the Resend SDK at module level. The constructor returns an object whose
// `emails.send` is a Vi mock that the tests configure per-case.
const resendSend = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: resendSend } })),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('email.service.sendPasswordResetEmail', () => {
  it('calls Resend.emails.send with correctly-shaped payload', async () => {
    resendSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null });

    const { sendPasswordResetEmail } = await import('../services/email.service');
    await sendPasswordResetEmail('alice@example.com', 'tok-123');

    expect(resendSend).toHaveBeenCalledTimes(1);
    const [payload] = resendSend.mock.calls[0]!;
    expect(payload).toMatchObject({
      from: 'test@example.com',
      to: 'alice@example.com',
      subject: expect.stringContaining('Resetowanie'),
    });
    // Both HTML and plaintext bodies must be present.
    expect(payload.html).toContain('tok-123');
    expect(payload.text).toContain('tok-123');
    // URL-encoded token is embedded in the password-reset URL.
    expect(payload.html).toContain('reset-password/confirm?token=tok-123');
  });

  it('URL-encodes special characters in the token', async () => {
    resendSend.mockResolvedValue({ data: { id: 'resend-2' }, error: null });

    const { sendPasswordResetEmail } = await import('../services/email.service');
    await sendPasswordResetEmail('alice@example.com', 'tok/with+special=chars');

    const [payload] = resendSend.mock.calls[0]!;
    // encodeURIComponent transforms `/`, `+`, `=`
    expect(payload.html).toContain('tok%2Fwith%2Bspecial%3Dchars');
    expect(payload.html).not.toContain('tok/with+special=chars');
  });

  it('resolves (does not throw) when Resend returns an error', async () => {
    // The resend.client logs and returns null on error — sendPasswordResetEmail
    // does not surface the failure to the caller. This is the documented
    // behaviour today; if it changes, this test must be updated.
    resendSend.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { sendPasswordResetEmail } = await import('../services/email.service');
    await expect(
      sendPasswordResetEmail('alice@example.com', 'tok-err'),
    ).resolves.toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(1);
  });
});

describe('email.service.sendInvitationEmail', () => {
  it('embeds inviter name and invite URL in both html and text bodies', async () => {
    resendSend.mockResolvedValue({ data: { id: 'resend-3' }, error: null });

    const { sendInvitationEmail } = await import('../services/email.service');
    await sendInvitationEmail(
      'bob@example.com',
      'https://app.example.com/invite/abc',
      'Anna',
    );

    expect(resendSend).toHaveBeenCalledTimes(1);
    const [payload] = resendSend.mock.calls[0]!;
    expect(payload.to).toBe('bob@example.com');
    expect(payload.subject).toContain('Zaproszenie');
    expect(payload.html).toContain('Anna');
    expect(payload.html).toContain('https://app.example.com/invite/abc');
    expect(payload.text).toContain('Anna');
    expect(payload.text).toContain('https://app.example.com/invite/abc');
  });
});

describe('email.service.sendAccountLockedEmail', () => {
  it('sends html-only body (text field omitted)', async () => {
    resendSend.mockResolvedValue({ data: { id: 'resend-4' }, error: null });

    const unlockAt = new Date('2024-06-01T10:00:00.000Z');
    const { sendAccountLockedEmail } = await import('../services/email.service');
    await sendAccountLockedEmail('eve@example.com', unlockAt);

    expect(resendSend).toHaveBeenCalledTimes(1);
    const [payload] = resendSend.mock.calls[0]!;
    expect(payload.to).toBe('eve@example.com');
    expect(payload.subject).toContain('zablokowane');
    expect(payload.html).toContain('2024-06-01T10:00:00.000Z');
    // The service does not pass a `text` field for this email — the resend
    // client forwards `undefined` through, which is acceptable.
    expect(payload.text).toBeUndefined();
  });
});

describe('email.service — Resend SDK not called when RESEND_API_KEY missing', () => {
  // The resend.client short-circuits when env.RESEND_API_KEY is unset.
  // We exercise this by re-mocking env to drop the key, then re-importing the
  // resend.client and email.service to pick up the cleared state.
  it('skips Resend.emails.send when no API key is configured', async () => {
    vi.resetModules();
    vi.doMock('../env', () => ({
      env: {
        NODE_ENV: 'test',
        PORT: 8080,
        DATABASE_URL: 'postgres://x@y/z',
        DATABASE_URL_DIRECT: 'postgres://x@y/z',
        JWT_SECRET: 'a'.repeat(48),
        JWT_REFRESH_SECRET: 'b'.repeat(48),
        RESEND_API_KEY: undefined,
        R2_ENDPOINT: 'https://example.com',
        R2_ACCESS_KEY: 'x',
        R2_SECRET_KEY: 'x',
        R2_BUCKET: 'x',
        R2_REGION: 'auto',
        CORS_ORIGIN: 'http://localhost:5173',
        EMAIL_FROM: 'test@example.com',
        APP_URL: 'https://app.example.com',
        FB_GRAPH_API_VERSION: 'v20.0',
      },
    }));
    vi.doMock('../lib/logger', () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    const innerSend = vi.fn();
    vi.doMock('resend', () => ({
      Resend: vi.fn(() => ({ emails: { send: innerSend } })),
    }));

    const { sendPasswordResetEmail } = await import('../services/email.service');
    await expect(
      sendPasswordResetEmail('alice@example.com', 'tok-skip'),
    ).resolves.toBeUndefined();
    expect(innerSend).not.toHaveBeenCalled();

    // Restore the default module graph for any later test runs.
    vi.doUnmock('../env');
    vi.doUnmock('resend');
    vi.doUnmock('../lib/logger');
    vi.resetModules();
  });
});
