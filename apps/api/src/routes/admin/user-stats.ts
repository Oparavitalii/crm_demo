import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { idSchema } from '@crm/shared';
import * as analyticsService from '../../services/analytics.service';
import { requireAuth } from '../../middleware/auth';

// Per-user analytics drill-down (recruiter or coordinator). Auth is enforced
// inside the service — admin can fetch anyone, recruiter/coordinator can fetch
// themselves only. Read-only endpoint: no audit log required.
const userIdParam = z.object({ userId: idSchema });

export const adminUserStatsRouter = new Hono()
  .use('*', requireAuth)
  .get('/:userId/stats', zValidator('param', userIdParam), async (c) => {
    const { userId } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const data = await analyticsService.getUserProfileStats(userId, actor);
    return c.json(data);
  });
