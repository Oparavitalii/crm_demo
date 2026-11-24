import type { Context, MiddlewareHandler } from 'hono';
import * as audit from '../services/audit.service';
import { logger } from '../lib/logger';

export function auditLog(action: string, entityType: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.status >= 400) return;
    try {
      await audit.log({
        actorId: c.var.userId ?? null,
        action,
        entityType,
        entityId: c.var.auditEntityId ?? c.req.param('id') ?? null,
        oldValue: c.var.auditOld,
        newValue: c.var.auditNew,
        ip: getClientIp(c),
        userAgent: c.req.header('user-agent') ?? null,
      });
    } catch (err) {
      logger.error({ err, action, entityType }, 'audit.log failed (non-fatal)');
    }
  };
}

// Resolves the client IP. Header preference order matters — on Fly.io the
// trusted edge header is `Fly-Client-IP`. Cloudflare's `cf-connecting-ip` is
// trusted only when fronted by CF. `x-forwarded-for` is least trustworthy
// (anyone can set it pre-edge) so it's last resort.
export function getClientIp(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return (
    c.req.header('fly-client-ip') ??
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}

// Centralized request-context builder for audit + rate-limit consistency.
// Use this in routes instead of inlining the same object literal everywhere.
export function buildReqCtx(c: Context): { ip: string | null; userAgent: string | null } {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
  };
}
