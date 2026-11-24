import { http, HttpResponse } from 'msw';

// Default handlers — happy path for every external service the API calls.
// Tests override on a per-case basis via `server.use(...)`. Anything not
// covered here will surface as an "unhandled request" warning in test mode,
// which is the point: a forgotten external call is a bug, not a silent pass.
//
// Why "warn" (configured in setup.ts) and not "error":
//   - The Resend email tests already mock the `resend` package at the SDK
//     module level via `vi.mock('resend', ...)`. That path never reaches
//     fetch, so MSW would never see it anyway.
//   - The R2 client uses `@aws-sdk/client-s3` which in Node 20 falls back
//     to native `fetch()`. Most existing tests that exercise R2 already
//     stub the client; future tests can switch to MSW handlers below.
//   - Switching to "error" would explode the existing 356-test baseline.
//     We start with "warn" and tighten once all tests are MSW-aware.

// R2_ENDPOINT in the test env (see vitest setup envs) is
// `https://example.com`, so handlers target that origin.
export const handlers = [
  // R2 (S3-compatible) PUT — succeed with empty body
  http.put('https://example.com/*', () =>
    HttpResponse.text('', { status: 200 }),
  ),
  // R2 DELETE — succeed with 204 No Content
  http.delete('https://example.com/*', () =>
    HttpResponse.text('', { status: 204 }),
  ),
  // R2 GET — return a placeholder object body
  http.get('https://example.com/*', () =>
    HttpResponse.text('mock-object-body', { status: 200 }),
  ),

  // Make.com inbound webhook (when API initiates a call to Make) — not
  // currently used by the codebase. Listed for future-proofing so the
  // pattern is documented when we add outbound automation.
];
