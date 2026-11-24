import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { acceptInvitationSchema } from '@crm/shared';
import * as invitationsService from '../services/invitations.service';
import { buildReqCtx } from '../middleware/audit';
import { acceptInviteRateLimiter } from '../middleware/rate-limit';

export const registerRouter = new Hono()
  .post(
    '/accept-invite',
    acceptInviteRateLimiter,
    zValidator('json', acceptInvitationSchema),
    async (c) => {
      const input = c.req.valid('json');
      const result = await invitationsService.acceptInvitation(input, buildReqCtx(c));
      return c.json(result, 201);
    },
  );
