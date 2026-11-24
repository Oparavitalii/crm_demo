import type { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import { env } from '../env';

export function applySecurity(app: Hono): void {
  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      // API serves JSON only — lock down defaults for defense-in-depth
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      permissionsPolicy: {
        geolocation: [],
        microphone: [],
        camera: [],
      },
    }),
  );

  // CORS_ORIGIN env is comma-separated. Hono cors() accepts a function for dynamic
  // origin checking — returns the request origin if it's in the whitelist, else null.
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

  app.use(
    '*',
    cors({
      origin: (origin) => (origin && allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Content-Type', 'Authorization'],
      // Headers the browser is allowed to read from JS. X-Row-Count is set by
      // export endpoints (e.g. /dismissals/export.xlsx) so the UI can show a
      // "downloaded N records" toast without re-parsing the file body.
      exposeHeaders: ['Content-Disposition', 'X-Row-Count'],
      maxAge: 3600,
    }),
  );
}
