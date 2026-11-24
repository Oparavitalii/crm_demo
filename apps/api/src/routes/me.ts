import { Hono } from 'hono';
import * as service from '../services/documents.service';
import * as adminUsersService from '../services/admin-users.service';
import { requireAuth } from '../middleware/auth';
import { buildReqCtx } from '../middleware/audit';

export const meRouter = new Hono()
  .use('*', requireAuth)
  .get('/pending-acceptances', async (c) => {
    const actor = { id: c.var.userId, role: c.var.userRole };
    const items = await service.listPendingAcceptancesForUser(actor);
    return c.json({ items });
  })
  .get('/acceptances', async (c) => {
    const items = await service.listAcceptancesForUser(c.var.userId);
    return c.json({ items });
  })
  // Self-service password reset. Triggers the same email flow admin uses on
  // /admin/users/:id/reset-password, but keyed off the JWT — no params, no
  // way to target another user. Rate-limit comes from requireAuth (logged-in
  // users are already throttled per-IP at the gateway).
  .post('/reset-password', async (c) => {
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await adminUsersService.triggerPasswordReset(actor.id, actor, buildReqCtx(c));
    return c.json(result);
  });
