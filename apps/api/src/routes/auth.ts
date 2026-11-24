import { Hono } from 'hono';
import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import {
  loginSchema,
  resetRequestSchema,
  resetConfirmSchema,
  verify2FAInputSchema,
  confirm2FAInputSchema,
  disable2FAInputSchema,
} from '@opushr/shared';
import * as authService from '../services/auth.service';
import * as totpService from '../services/totp.service';
import { TOKEN_TTL } from '../lib/jwt';
import { requireAuth } from '../middleware/auth';
import {
  loginRateLimiter,
  verify2faRateLimiter,
  passwordResetRateLimiter,
} from '../middleware/rate-limit';
import { getClientIp } from '../middleware/audit';
import { env } from '../env';
import { UnauthorizedError } from '../lib/errors';
import * as usersRepo from '../repositories/users.repo';

const REFRESH_COOKIE = 'refresh_token';

function setRefreshCookie(c: Context, token: string): void {
  const isProd = env.NODE_ENV === 'production';
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    // Cross-site cookie: in production the SPA (crm.opus-demo.example) and the API
    // (api.opus-demo.example) are different registrable domains, so the
    // browser only sends the refresh cookie back on the /auth/refresh fetch
    // when SameSite=None. 'Strict'/'Lax' silently drop it cross-site, which
    // made every silent refresh fail — users were bounced to /login the moment
    // the 15-min access token expired (perceived as "logged out on idle").
    // 'None' mandates Secure, satisfied by HTTPS in prod. In local dev the SPA
    // and API are same-site (localhost), so fall back to 'Lax' — browsers
    // reject SameSite=None without Secure over plain HTTP.
    sameSite: isProd ? 'None' : 'Lax',
    path: '/auth',
    maxAge: TOKEN_TTL.refreshSec,
  });
}

export const authRouter = new Hono()
  .post('/login', loginRateLimiter, zValidator('json', loginSchema), async (c) => {
    const input = c.req.valid('json');
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const result = await authService.login(input, ctx);
    if ('requires2FA' in result && result.requires2FA) {
      return c.json({ user: result.user, partialToken: result.partialToken, requires2FA: true });
    }
    setRefreshCookie(c, (result as { refreshToken: string }).refreshToken);
    return c.json({ user: result.user, accessToken: (result as { accessToken: string }).accessToken });
  })
  .post('/login/verify-2fa', verify2faRateLimiter, zValidator('json', verify2FAInputSchema), async (c) => {
    const { partialToken, code } = c.req.valid('json');
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const result = await authService.verify2FA(partialToken, code, ctx);
    setRefreshCookie(c, result.refreshToken);
    return c.json({ user: result.user, accessToken: result.accessToken });
  })
  .post('/refresh', async (c) => {
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    if (!refreshToken) throw new UnauthorizedError();
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const result = await authService.refresh(refreshToken, ctx);
    // refreshToken is null when served from the rotation grace window — the
    // cookie jar already holds the newer token, don't clobber it.
    if (result.refreshToken) setRefreshCookie(c, result.refreshToken);
    return c.json({ accessToken: result.accessToken });
  })
  .post('/logout', requireAuth, async (c) => {
    const sessionId = c.var.sessionId;
    const userId = c.var.userId;
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await authService.logout(sessionId, userId, ctx);
    deleteCookie(c, REFRESH_COOKIE, { path: '/auth' });
    return c.body(null, 204);
  })
  .get('/me', requireAuth, async (c) => {
    const user = await usersRepo.findById(c.var.userId);
    if (!user) throw new UnauthorizedError();
    // Single source of truth — same shaper as login/refresh, so /auth/me
    // includes every field PublicUser exposes (publicSlug, etc). Hand-rolling
    // the object inline silently drops new fields whenever the schema grows.
    return c.json({ user: authService.toPublic(user) });
  })
  .post('/reset-password/request', passwordResetRateLimiter, zValidator('json', resetRequestSchema), async (c) => {
    const { email } = c.req.valid('json');
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await authService.requestPasswordReset(email, ctx);
    return c.json({ ok: true });
  })
  .post('/reset-password/confirm', passwordResetRateLimiter, zValidator('json', resetConfirmSchema), async (c) => {
    const { token, newPassword } = c.req.valid('json');
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await authService.confirmPasswordReset(token, newPassword, ctx);
    return c.json({ ok: true });
  })
  .post('/2fa/enroll', requireAuth, async (c) => {
    const result = await totpService.startEnrollment(c.var.userId);
    return c.json(result);
  })
  .post('/2fa/confirm', requireAuth, zValidator('json', confirm2FAInputSchema), async (c) => {
    const { secret, code } = c.req.valid('json');
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await totpService.confirmEnrollment(c.var.userId, secret, code, ctx);
    return c.json({ ok: true });
  })
  .post('/2fa/disable', requireAuth, zValidator('json', disable2FAInputSchema), async (c) => {
    const { password, code } = c.req.valid('json');
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await totpService.disable(c.var.userId, password, code, ctx);
    return c.json({ ok: true });
  });
