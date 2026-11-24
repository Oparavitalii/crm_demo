import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createInvitationSchema, idSchema } from '@opushr/shared';
import * as invitationsService from '../../services/invitations.service';
import { requireAuth, requireRole } from '../../middleware/auth';
import { buildReqCtx, getClientIp } from '../../middleware/audit';
import * as usersRepo from '../../repositories/users.repo';

const idParam = z.object({ id: idSchema });

export const adminInvitationsRouter = new Hono()
  .use('*', requireAuth)
  .use('*', requireRole(['admin']))
  .post('/', zValidator('json', createInvitationSchema), async (c) => {
    const input = c.req.valid('json');
    const actorId = c.var.userId;
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };

    // Load actor details for inviter name in email
    const actorUser = await usersRepo.findById(actorId);
    const actor = {
      id: actorId,
      firstName: actorUser?.firstName ?? 'Admin',
      lastName: actorUser?.lastName ?? '',
      role: c.var.userRole,
    };

    const result = await invitationsService.createInvitation(input, actor, ctx);
    return c.json(result, 201);
  })
  .get('/', async (c) => {
    const invitations = await invitationsService.listPendingInvitations();
    return c.json({ items: invitations });
  })
  .delete('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actorId = c.var.userId;
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const actorUser = await usersRepo.findById(actorId);
    const actor = {
      id: actorId,
      firstName: actorUser?.firstName ?? 'Admin',
      lastName: actorUser?.lastName ?? '',
      role: c.var.userRole,
    };
    await invitationsService.revokeInvitation(id, actor, ctx);
    return c.json({ ok: true });
  })
  .post('/:id/resend', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actorId = c.var.userId;
    const actorUser = await usersRepo.findById(actorId);
    const actor = {
      id: actorId,
      firstName: actorUser?.firstName ?? 'Admin',
      lastName: actorUser?.lastName ?? '',
      role: c.var.userRole,
    };
    const result = await invitationsService.resendInvitation(id, actor, buildReqCtx(c));
    return c.json(result);
  });
