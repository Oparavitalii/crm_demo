import type { MiddlewareHandler } from 'hono';
import { verifyAccess } from '../lib/jwt';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';
import { logger } from '../lib/logger';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import type { UserRole } from '@opushr/shared';

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new UnauthorizedError();
  const token = match[1];
  if (!token) throw new UnauthorizedError();

  let payload;
  try {
    payload = await verifyAccess(token);
  } catch (err) {
    logger.debug({ errName: (err as Error).name }, 'access token verify failed');
    throw new UnauthorizedError();
  }

  // Critical: validate the session referenced by payload.sid still exists.
  // Without this, access tokens remain valid for up to 15min after logout / password reset
  // / admin-forced session deletion. For RODO-sensitive data we reject revoked sessions
  // immediately on the next request.
  //
  // Run session + user lookups in parallel — they're independent PK lookups
  // and Neon is in EU; sequential await added ~5-10ms per authenticated request.
  const [session, user] = await Promise.all([
    sessionsRepo.findById(payload.sid),
    usersRepo.findById(payload.sub),
  ]);
  if (!session || session.userId !== payload.sub || session.expiresAt < new Date()) {
    throw new UnauthorizedError();
  }
  if (!user || !user.isActive) throw new UnauthorizedError();

  c.set('userId', user.id);
  c.set('userRole', user.role);
  c.set('sessionId', payload.sid);
  await next();
};

export function requireRole(roles: UserRole[]): MiddlewareHandler {
  return async (c, next) => {
    const role = c.var.userRole;
    if (!role || !roles.includes(role)) throw new ForbiddenError();
    await next();
  };
}
