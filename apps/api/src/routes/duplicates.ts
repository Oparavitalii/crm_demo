import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ignoreDuplicateSchema } from '@crm/shared';
import * as duplicatesService from '../services/duplicates.service';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildReqCtx } from '../middleware/audit';

export const duplicatesRouter = new Hono()
  .use('*', requireAuth)
  .post(
    '/ignore',
    requireRole(['admin', 'recruiter']),
    zValidator('json', ignoreDuplicateSchema),
    async (c) => {
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      await duplicatesService.markNotDuplicate(input, user, buildReqCtx(c));
      return c.json({ ok: true });
    },
  );
