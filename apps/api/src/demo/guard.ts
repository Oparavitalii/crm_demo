import type { MiddlewareHandler } from 'hono';
import { env } from '../env';
import { ForbiddenError } from '../lib/errors';

// The public demo shares one guest login between every visitor. Anything that
// could lock the next visitor out (password, 2FA, deactivating accounts),
// create real accounts, or send account e-mail is refused here. Everything
// else — candidates, pipeline, projects, tasks, templates, bulk send — stays
// writable; the nightly reset (demo/reset.ts) restores the seeded state.
const BLOCKED: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ['POST', /^\/auth\/reset-password\/(request|confirm)$/],
  ['POST', /^\/auth\/2fa\/(enroll|confirm|disable)$/],
  ['POST', /^\/me\/reset-password$/],
  ['POST', /^\/admin\/users\/?$/],
  ['PATCH', /^\/admin\/users\/[^/]+$/],
  ['DELETE', /^\/admin\/users\/[^/]+$/],
  ['POST', /^\/admin\/users\/[^/]+\/(reset-password|force-logout|resend-invite)$/],
  ['POST', /^\/admin\/invitations(\/.*)?$/],
  ['DELETE', /^\/admin\/invitations\/[^/]+$/],
  ['POST', /^\/register(\/.*)?$/],
  // File uploads would need object storage, which the demo does not have.
  ['POST', /^\/admin\/documents\/file$/],
];

export function isBlockedInDemo(method: string, path: string): boolean {
  return BLOCKED.some(([m, re]) => m === method && re.test(path));
}

export const demoGuard: MiddlewareHandler = async (c, next) => {
  if (env.DEMO_MODE && isBlockedInDemo(c.req.method, c.req.path)) {
    throw new ForbiddenError('disabled_in_demo');
  }
  await next();
};
