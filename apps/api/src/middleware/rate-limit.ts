import { rateLimiter } from 'hono-rate-limiter';
import { getClientIp } from './audit';

// 5 login attempts per 15 minutes per IP — anti credential-stuffing.
export const loginRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => getClientIp(c) ?? 'anon',
  handler: (c) => c.json({ error: 'TOO_MANY_REQUESTS', meta: { retryAfter: 900 } }, 429),
});

// 10 TOTP code attempts per 15 minutes per IP. The 5-minute partial token plus
// 6-digit code window means without this an attacker could try ~10M codes.
export const verify2faRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => getClientIp(c) ?? 'anon',
  handler: (c) => c.json({ error: 'TOO_MANY_REQUESTS', meta: { retryAfter: 900 } }, 429),
});

// 5 reset-link requests per hour per IP. Both prevents email flooding (Resend
// quota abuse) and limits user-enumeration probing speed.
export const passwordResetRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => getClientIp(c) ?? 'anon',
  handler: (c) => c.json({ error: 'TOO_MANY_REQUESTS', meta: { retryAfter: 3600 } }, 429),
});

// 20 invitation-acceptance attempts per hour per IP. Invitation tokens have
// 256 bits of entropy, but the endpoint is unauthenticated so we still cap it
// to avoid amplification (DB churn, password-hash CPU spend).
export const acceptInviteRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => getClientIp(c) ?? 'anon',
  handler: (c) => c.json({ error: 'TOO_MANY_REQUESTS', meta: { retryAfter: 3600 } }, 429),
});

// 10 public form submissions per minute per IP — anti-spam on employer
// inquiries (in addition to the per-email DB throttle in the service layer).
export const publicFormRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => getClientIp(c) ?? 'anon',
  handler: (c) => c.json({ error: 'TOO_MANY_REQUESTS', meta: { retryAfter: 60 } }, 429),
});

// 60 lookups per minute per IP for the public recruiter-info endpoint used
// to bootstrap /apply/:slug. Higher than submission because every page load
// hits it once — but still gated to prevent enumeration of valid slugs.
export const publicLookupRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => getClientIp(c) ?? 'anon',
  handler: (c) => c.json({ error: 'TOO_MANY_REQUESTS', meta: { retryAfter: 60 } }, 429),
});

// 120 webhook events per minute per IP. Resend (via Svix) can burst on retry
// after a brief downtime — non-2xx triggers exponential backoff retries from
// their side. Limit is generous on purpose: legit Resend traffic is bursty but
// signature verification still gates on the secret, so the limiter is a
// last-resort backstop rather than the primary security boundary.
export const webhookRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  keyGenerator: (c) => getClientIp(c) ?? 'anon',
  handler: (c) => c.json({ error: 'TOO_MANY_REQUESTS', meta: { retryAfter: 60 } }, 429),
});
