import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from '../lib/bcrypt';
import { sha256 } from '../lib/hash';
import {
  signAccess,
  signRefresh,
  verifyRefresh,
  signPartial2FA,
  verifyPartial2FA,
  TOKEN_TTL,
} from '../lib/jwt';
import { verifyTotp } from '../lib/totp';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import * as resetRepo from '../repositories/password-reset-tokens.repo';
import * as audit from './audit.service';
import { sendPasswordResetEmail, sendAccountLockedEmail } from './email.service';
import type { User } from '../db/tables/users';

const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Decoy bcrypt hash for timing-uniform auth-failure paths (user not found,
// inactive, locked). Generated once at module load — full bcrypt cost so
// compare against it takes ~same time as real password verify.
// Prevents user enumeration via response timing.
const DECOY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: User['role'];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  has2FA: boolean;
  publicSlug: string | null;
}

export function toPublic(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    has2FA: u.twoFactorSecret !== null,
    publicSlug: u.publicSlug,
  };
}

type LoginResult =
  | { user: PublicUser; accessToken: string; refreshToken: string }
  | { user: PublicUser; partialToken: string; requires2FA: true };

async function issueLoginTokens(
  user: User,
  ctx: RequestContext,
): Promise<{ accessToken: string; refreshToken: string }> {
  const sessionId = randomUUID();
  const refreshToken = await signRefresh({ sub: user.id, sid: sessionId });
  const refreshHash = sha256(refreshToken);
  await sessionsRepo.create({
    id: sessionId,
    userId: user.id,
    refreshTokenHash: refreshHash,
    expiresAt: new Date(Date.now() + TOKEN_TTL.refreshSec * 1000),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  const accessToken = await signAccess({ sub: user.id, role: user.role, sid: sessionId });
  return { accessToken, refreshToken };
}

export async function login(
  input: { email: string; password: string },
  ctx: RequestContext,
): Promise<LoginResult> {
  const user = await usersRepo.findByEmail(input.email);

  // Timing parity: every auth-failure path burns one full bcrypt compare,
  // so user-not-found / inactive / locked / wrong-password all take ~same time.
  if (!user) {
    await verifyPassword(input.password, DECOY_HASH);
    await audit.log({ action: 'login_failed', entityType: 'user', ...ctx, newValue: { email: input.email, reason: 'user_not_found' } });
    throw new AppError('INVALID_CREDENTIALS', undefined, 401);
  }

  if (!user.isActive) {
    await verifyPassword(input.password, DECOY_HASH);
    await audit.log({ actorId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, ...ctx, newValue: { reason: 'inactive' } });
    throw new AppError('INVALID_CREDENTIALS', undefined, 401);
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await verifyPassword(input.password, DECOY_HASH);
    await audit.log({ actorId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, ...ctx, newValue: { reason: 'locked' } });
    throw new AppError('INVALID_CREDENTIALS', undefined, 401);
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const attempts = await usersRepo.recordFailedLogin(user.id);
    if (attempts >= LOCKOUT_THRESHOLD) {
      const until = new Date(Date.now() + LOCKOUT_DURATION_MS);
      await usersRepo.lockAccount(user.id, until);
      logger.warn({ userId: user.id }, 'Account locked due to repeated failures');
      sendAccountLockedEmail(user.email, until).catch((err) =>
        logger.error({ err }, 'Failed to send lockout email'),
      );
    }
    await audit.log({ actorId: user.id, action: 'login_failed', entityType: 'user', entityId: user.id, ...ctx, newValue: { reason: 'bad_password', attempts } });
    throw new AppError('INVALID_CREDENTIALS', undefined, 401);
  }

  await usersRepo.updateLastLogin(user.id);

  // If 2FA is enabled, issue a short-lived partial token instead of full session
  if (user.twoFactorSecret !== null) {
    const partialToken = await signPartial2FA(user.id);
    await audit.log({ actorId: user.id, action: 'login_password_ok_2fa_pending', entityType: 'user', entityId: user.id, ...ctx });
    return { user: toPublic(user), partialToken, requires2FA: true };
  }

  const { accessToken, refreshToken } = await issueLoginTokens(user, ctx);

  await audit.log({ actorId: user.id, action: 'login', entityType: 'user', entityId: user.id, ...ctx });

  return { user: toPublic(user), accessToken, refreshToken };
}

export async function verify2FA(
  partialToken: string,
  code: string,
  ctx: RequestContext,
): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
  let payload: { sub: string; purpose: string };
  try {
    payload = await verifyPartial2FA(partialToken);
  } catch {
    throw new AppError('INVALID_2FA', undefined, 401);
  }

  const user = await usersRepo.findById(payload.sub);
  if (!user || !user.isActive || !user.twoFactorSecret) {
    throw new AppError('INVALID_2FA', undefined, 401);
  }

  if (!verifyTotp(code, user.twoFactorSecret)) {
    await audit.log({ actorId: user.id, action: 'login_2fa_failed', entityType: 'user', entityId: user.id, ...ctx });
    throw new AppError('INVALID_2FA', undefined, 401);
  }

  const { accessToken, refreshToken } = await issueLoginTokens(user, ctx);

  await audit.log({ actorId: user.id, action: 'login_2fa', entityType: 'user', entityId: user.id, ...ctx });

  return { user: toPublic(user), accessToken, refreshToken };
}


// Grace window during which a just-rotated refresh token is still honored.
// Two legitimate flows land there: (1) several tabs wake up together and race
// /auth/refresh with the same cookie — the losers arrive with the token the
// winner already rotated; (2) the rotation response's Set-Cookie never reached
// the browser (laptop slept mid-request). Treating those as theft is what used
// to wipe every session and log the whole team out "next morning".
const ROTATION_GRACE_MS = 60 * 1000;

export interface RefreshResult {
  accessToken: string;
  /**
   * null when the request was served from the rotation grace window: the
   * browser's cookie jar already holds the newest token (set by the tab that
   * won the race), so the route must NOT overwrite it.
   */
  refreshToken: string | null;
  userId: string;
  sessionId: string;
}

export async function refresh(refreshToken: string, ctx: RequestContext): Promise<RefreshResult> {
  let payload;
  try {
    payload = await verifyRefresh(refreshToken);
  } catch {
    throw new AppError('INVALID_REFRESH', undefined, 401);
  }

  const tokenHash = sha256(refreshToken);
  const session = await sessionsRepo.findByTokenHash(tokenHash);
  if (!session || session.id !== payload.sid || session.userId !== payload.sub) {
    // Unknown hash — almost always a token rotated away long ago whose
    // tombstone the retention cron already swept, or a session revoked
    // elsewhere (logout, password reset). Benign: plain 401, no session nuke.
    logger.info({ sid: payload.sid }, 'refresh_unknown_token');
    throw new AppError('INVALID_REFRESH', undefined, 401);
  }

  if (session.rotatedAt) {
    const ageMs = Date.now() - session.rotatedAt.getTime();
    if (ageMs <= ROTATION_GRACE_MS) {
      // Benign race — hand out an access token bound to the replacement
      // session without rotating again or touching the cookie.
      const replacement = session.replacedById
        ? await sessionsRepo.findById(session.replacedById)
        : undefined;
      const user = await usersRepo.findById(session.userId);
      if (
        replacement &&
        !replacement.rotatedAt &&
        replacement.expiresAt > new Date() &&
        user &&
        user.isActive
      ) {
        const accessToken = await signAccess({ sub: user.id, role: user.role, sid: replacement.id });
        return { accessToken, refreshToken: null, userId: user.id, sessionId: replacement.id };
      }
      throw new AppError('INVALID_REFRESH', undefined, 401);
    }
    // Rotated token replayed well outside the grace window — genuine reuse.
    // Kill THIS device's session lineage (tombstone + its live replacement)
    // and audit; other devices' sessions stay untouched.
    await sessionsRepo.deleteById(session.id);
    if (session.replacedById) await sessionsRepo.deleteById(session.replacedById);
    await audit.log({
      actorId: session.userId,
      action: 'session_reuse_detected',
      entityType: 'user',
      entityId: session.userId,
      ...ctx,
      newValue: { sid: session.id, tokenHashPrefix: tokenHash.slice(0, 8) },
    });
    throw new AppError('INVALID_REFRESH', undefined, 401);
  }

  if (session.expiresAt < new Date()) {
    await sessionsRepo.deleteById(session.id);
    throw new AppError('INVALID_REFRESH', undefined, 401);
  }

  const user = await usersRepo.findById(session.userId);
  if (!user || !user.isActive) {
    await sessionsRepo.deleteById(session.id);
    throw new AppError('INVALID_REFRESH', undefined, 401);
  }

  // Rotate: new session becomes live, old row stays behind as a grace tombstone.
  const newSessionId = randomUUID();
  const newRefresh = await signRefresh({ sub: user.id, sid: newSessionId });
  await sessionsRepo.rotate(session.id, {
    id: newSessionId,
    userId: user.id,
    refreshTokenHash: sha256(newRefresh),
    expiresAt: new Date(Date.now() + TOKEN_TTL.refreshSec * 1000),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const newAccess = await signAccess({ sub: user.id, role: user.role, sid: newSessionId });
  return { accessToken: newAccess, refreshToken: newRefresh, userId: user.id, sessionId: newSessionId };
}

export async function logout(sessionId: string, actorId: string, ctx: RequestContext): Promise<void> {
  await sessionsRepo.deleteById(sessionId);
  await audit.log({ actorId, action: 'logout', entityType: 'user', entityId: actorId, ...ctx });
}

export async function requestPasswordReset(
  email: string,
  ctx: RequestContext,
): Promise<void> {
  const user = await usersRepo.findByEmail(email);
  if (!user || !user.isActive) {
    // Silent — no enumeration
    return;
  }
  const token = randomUUID() + randomUUID();
  const tokenHash = sha256(token);
  await resetRepo.create({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  sendPasswordResetEmail(user.email, token).catch((err) =>
    logger.error({ err, userId: user.id }, 'Failed to send password reset email'),
  );
  await audit.log({ actorId: user.id, action: 'password_reset_request', entityType: 'user', entityId: user.id, ...ctx });
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
  ctx: RequestContext,
): Promise<void> {
  const record = await resetRepo.findValidByHash(sha256(token));
  if (!record) throw new AppError('INVALID_TOKEN', undefined, 400);

  const hash = await hashPassword(newPassword);
  await usersRepo.updatePasswordHash(record.userId, hash);
  await resetRepo.markUsed(record.id);
  await sessionsRepo.deleteByUserId(record.userId); // force all sessions out

  await audit.log({ actorId: record.userId, action: 'password_reset_complete', entityType: 'user', entityId: record.userId, ...ctx });
}
