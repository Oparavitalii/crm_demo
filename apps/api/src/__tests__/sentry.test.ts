import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Sentry's own `init()` must stay a true no-op when SENTRY_DSN_API is unset —
// see the header comment in `lib/sentry.ts`. This suite covers the visibility
// fix on top of that: production with no DSN is a misconfiguration and must
// be impossible to miss (error-level log), while dev/test staying quiet
// without a DSN is expected behaviour, not a bug.

const ORIGINAL_NODE_ENV = process.env['NODE_ENV'];
const ORIGINAL_DSN = process.env['SENTRY_DSN_API'];

const loggerMock = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const sentryInitMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  loggerMock.debug.mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  sentryInitMock.mockReset();
  vi.doMock('../lib/logger', () => ({ logger: loggerMock }));
  vi.doMock('@sentry/node', () => ({
    init: sentryInitMock,
    captureException: vi.fn(),
  }));
});

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
  if (ORIGINAL_DSN === undefined) delete process.env['SENTRY_DSN_API'];
  else process.env['SENTRY_DSN_API'] = ORIGINAL_DSN;
});

describe('lib/sentry — missing-DSN visibility', () => {
  it('logs an error-level line in production when SENTRY_DSN_API is unset', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['SENTRY_DSN_API'];

    const sentry = await import('../lib/sentry');
    sentry.init();

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    const [, msg] = loggerMock.error.mock.calls[0] as [unknown, string];
    expect(msg).toMatch(/error tracking/i);
    expect(msg).toMatch(/disabled/i);
    // Real Sentry SDK must never be initialized without a DSN.
    expect(sentryInitMock).not.toHaveBeenCalled();
  });

  it('stays quiet in development when SENTRY_DSN_API is unset (expected local state)', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['SENTRY_DSN_API'];

    const sentry = await import('../lib/sentry');
    sentry.init();

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  it('stays quiet in test env when SENTRY_DSN_API is unset (expected CI state)', async () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['SENTRY_DSN_API'];

    const sentry = await import('../lib/sentry');
    sentry.init();

    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('does not log a misconfiguration in production when a DSN is present', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['SENTRY_DSN_API'] = 'https://example@o0.ingest.sentry.io/0';

    const sentry = await import('../lib/sentry');
    sentry.init();

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(sentryInitMock).toHaveBeenCalledTimes(1);
  });

  it('remains a no-op (never throws) when called without a DSN', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['SENTRY_DSN_API'];

    const sentry = await import('../lib/sentry');
    expect(() => sentry.init()).not.toThrow();
  });
});
