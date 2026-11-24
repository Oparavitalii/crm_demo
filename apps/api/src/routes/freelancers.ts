import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { idSchema, listFreelancersQuerySchema } from '@crm/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import * as repo from '../repositories/freelancers.repo';
import * as analyticsService from '../services/analytics.service';

// Lightweight read-only directory for picking a freelancer in the candidate
// list filter. Mirrors `usersDirectoryRouter` — auth required, no role guard.
// Returns id + names + isActive only (no email/phone/commission) so it's safe
// to expose to every authenticated user.
export const freelancersRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listFreelancersQuerySchema), async (c) => {
    const { limit } = c.req.valid('query');
    const items = await repo.listDirectory(limit);
    return c.json({ items });
  })
  // Per-freelancer analytics drill-down. Admin-only — freelancers have no
  // user account so there's no "self" concept. Mirrors `/admin/users/:id/stats`
  // shape so the same frontend page can render either source.
  .get(
    '/:id/stats',
    requireRole(['admin']),
    zValidator('param', z.object({ id: idSchema })),
    async (c) => {
      const { id } = c.req.valid('param');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const data = await analyticsService.getFreelancerProfileStats(id, actor);
      return c.json(data);
    },
  );
