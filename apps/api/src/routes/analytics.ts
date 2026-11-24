import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { dashboardFiltersSchema } from '@crm/shared';
import { requireAuth } from '../middleware/auth';
import * as analyticsService from '../services/analytics.service';

export const analyticsRouter = new Hono()
  .use('*', requireAuth)
  .get('/dashboard', zValidator('query', dashboardFiltersSchema), async (c) => {
    const filters = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const data = await analyticsService.getDashboard(filters, user);
    return c.json(data);
  });
