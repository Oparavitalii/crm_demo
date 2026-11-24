import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import * as sentry from '../lib/sentry';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    logger.warn({ code: err.code, meta: err.meta }, 'AppError');
    return c.json(
      { error: err.code, meta: err.meta },
      err.status as ContentfulStatusCode,
    );
  }
  logger.error({ err }, 'Unhandled error');
  // Route 5xx — not 4xx — to Sentry. AppError above is the intentional 4xx
  // surface (validation, forbidden, not-found); only real bugs flow here.
  sentry.captureException(err, { path: c.req.path, method: c.req.method });
  return c.json({ error: 'INTERNAL_ERROR' }, 500);
};
