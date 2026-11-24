import type { MiddlewareHandler } from 'hono';
import { logger } from '../lib/logger';

// One line per request. Until 2026-07-28 the API logged nothing at all about
// requests — diagnosing a wedged prod machine meant reading raw Drizzle stack
// traces out of `Unhandled error`, because no latency, status or throughput
// signal existed anywhere.
//
// Deliberately logs `c.req.path` and NOT the query string: search and filter
// params carry candidate names, phone numbers and emails, and Fly's log drain
// sits outside the RODO boundary described in docs/Engineering_Rules.md.
//
// Mounted outermost so the `finally` still fires when a downstream handler
// throws. The final status in that case is decided by `app.onError`, which
// runs after this middleware has already unwound — so a failed request
// records `failed: true` rather than a guessed code, since errorHandler maps
// AppError to 401/403/404/409 just as often as to 500.
export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  let failed = false;
  try {
    await next();
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: failed ? null : c.res.status,
        failed,
        ms: Date.now() - start,
        // Typed non-optional in types/hono.d.ts because requireAuth always
        // sets it — but this middleware also sees unauthenticated and
        // pre-auth requests, where it is genuinely absent.
        userId: (c.var as { userId?: string }).userId ?? null,
      },
      'req',
    );
  }
};
