import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuerySchema,
  idSchema,
} from '@crm/shared';
import * as adminUsersService from '../../services/admin-users.service';
import * as invitationsService from '../../services/invitations.service';
import * as usersRepo from '../../repositories/users.repo';
import { requireAuth, requireRole } from '../../middleware/auth';
import { buildReqCtx, getClientIp } from '../../middleware/audit';

const idParam = z.object({ id: idSchema });

export const adminUsersRouter = new Hono()
  .use('*', requireAuth)
  .use('*', requireRole(['admin']))
  .get('/', zValidator('query', listUsersQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await adminUsersService.listUsers(query, actor);
    return c.json(result);
  })
  .post('/', zValidator('json', createUserSchema), async (c) => {
    const input = c.req.valid('json');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const result = await adminUsersService.createUser(input, actor, ctx);
    return c.json(result, 201);
  })
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const user = await adminUsersService.getUser(id, actor);
    return c.json(user);
  })
  .patch('/:id', zValidator('param', idParam), zValidator('json', updateUserSchema), async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const user = await adminUsersService.updateUser(id, patch, actor, ctx);
    return c.json(user);
  })
  .post('/:id/reset-password', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const result = await adminUsersService.triggerPasswordReset(id, actor, ctx);
    return c.json(result);
  })
  .post('/:id/force-logout', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const result = await adminUsersService.forceLogout(id, actor, ctx);
    return c.json(result);
  })
  .delete('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await adminUsersService.deleteUser(id, actor, ctx);
    return c.body(null, 204);
  })
  .post('/:id/resend-invite', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actorId = c.var.userId;
    const actorUser = await usersRepo.findById(actorId);
    const actor = {
      id: actorId,
      firstName: actorUser?.firstName ?? 'Admin',
      lastName: actorUser?.lastName ?? '',
      role: c.var.userRole,
    };
    const result = await invitationsService.inviteExistingUser(id, actor, buildReqCtx(c));
    return c.json(result);
  });
