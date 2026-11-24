// Sentry init for the API. No-op when SENTRY_DSN_API is unset, so dev and
// test runs never reach out to the network. The DSN comes from Fly secrets in
// production; missing-DSN is the expected state for local development and CI.
//
// Wire-up:
//   1. `init()` is called once at the top of `src/index.ts` BEFORE Hono setup.
//   2. `captureException(err)` is called from `middleware/error-handler.ts`
//      for any error that is not an `AppError` (i.e. real bugs, not 4xx).
//   3. Unhandled rejection / uncaughtException already log via Pino — they
//      also surface in Sentry because the SDK installs global handlers.

import * as Sentry from '@sentry/node';
import { logger } from './logger';

// Read process.env directly — NOT via `env.ts`. Importing `env.ts` would
// trigger Zod validation at module load, which races with test files that
// set `process.env.X = …` after the static import phase. Sentry only needs
// strings; full env validation lives upstream in `env.ts` for the rest
// of the codebase.

let initialized = false;

export function init(): void {
  const dsn = process.env['SENTRY_DSN_API'];
  if (initialized) return;
  if (!dsn) {
    // Missing DSN is expected (by design) outside production — dev and CI
    // run without one. In production it means every 500 is being silently
    // discarded, so it must be error-level: this codebase already has one
    // diagnostic that shipped at `logger.debug` while prod runs at `info`
    // and was never seen (see lib/logger.ts). Don't repeat that mistake.
    if (process.env['NODE_ENV'] === 'production') {
      logger.error(
        { reason: 'sentry_dsn_missing' },
        'Error tracking disabled: SENTRY_DSN_API is not set in production',
      );
    }
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    // 10% of transactions sampled in prod. Adjust per traffic volume — the
    // CRM serves ~20 users so even 100% would be cheap, but 10% leaves
    // headroom if a recruiter batch-imports candidates.
    tracesSampleRate: 0.1,
    // Bake the Fly release SHA into events so a regression points at a commit.
    // FLY_IMAGE_REF is injected automatically; release tag is optional.
    release: process.env['FLY_IMAGE_REF'] ?? process.env['GIT_SHA'],
  });
  initialized = true;
}

export function captureException(err: unknown, hint?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, hint ? { extra: hint } : undefined);
}
