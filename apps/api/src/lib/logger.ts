import pino from 'pino';
import { env } from '../env';

const isDev = env.NODE_ENV !== 'production';

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
    },
  }),
  // Redacts sensitive fields from log output. Pino does not strip nested-deep
  // unless you spell out wildcard paths. Adding entries here is mandatory whenever
  // you introduce a new secret/PII field type (see docs/Engineering_Rules.md).
  redact: {
    paths: [
      // Auth + session secrets
      'password',
      'newPassword',
      'currentPassword',
      'passwordHash',
      'token',
      'partialToken',
      'tokenHash',
      'accessToken',
      'refreshToken',
      'refresh_token',
      'authorization',
      'cookie',
      // 2FA
      'twoFactorSecret',
      'secret',
      // Per-request headers
      'req.headers.authorization',
      'req.headers.cookie',
      // 1-level wildcard for top-level container objects
      '*.password',
      '*.newPassword',
      '*.passwordHash',
      '*.token',
      '*.partialToken',
      '*.tokenHash',
      '*.accessToken',
      '*.refreshToken',
      '*.twoFactorSecret',
      '*.secret',
      // PII fields that should not appear in operational logs
      'pesel',
      '*.pesel',
      // Webhook signing material — Svix headers + secrets must never log.
      'svix_signature',
      'svixSignature',
      'webhookSecret',
      'RESEND_WEBHOOK_SECRET',
      '*.svix_signature',
      '*.svixSignature',
      '*.webhookSecret',
      '*.RESEND_WEBHOOK_SECRET',
      // SMSAPI.pl — OAuth bearer token + opaque idempotency key
      'SMSAPI_TOKEN',
      'smsapiToken',
      '*.SMSAPI_TOKEN',
      '*.smsapiToken',
      // Public demo guest password (documented, but still not log material)
      'DEMO_USER_PASSWORD',
      '*.DEMO_USER_PASSWORD',
    ],
    censor: '[REDACTED]',
  },
});
