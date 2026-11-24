// Sentry init for the web app. No-op when VITE_SENTRY_DSN is unset, so dev
// builds and the local Vite server never reach out to the network.
//
// Wire-up:
//   1. `init()` is called once at the top of `src/main.tsx` BEFORE render.
//   2. `captureException(err)` is called from the root `ErrorBoundary` in
//      `app/App.tsx` (via the `onError` prop on react-error-boundary).
//   3. Source-maps are uploaded by the Sentry Vite plugin during prod build
//      (see `vite.config.ts`) but kept hidden behind the `.htaccess` deny
//      rule on `.map`.

import * as Sentry from '@sentry/react';

let initialized = false;

export function init(): void {
  const dsn = import.meta.env['VITE_SENTRY_DSN'] as string | undefined;
  if (initialized || !dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env['VITE_RELEASE'] as string | undefined,
    // 10% of transactions; bump later if recruiter traffic warrants finer
    // sampling. 20 users × ~50 page views/day = 1k events — well under quota.
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
  });
  initialized = true;
}

export function captureException(err: unknown, info?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, info ? { extra: info } : undefined);
}
