import { Hono } from 'hono';
import * as accommodationsService from '../services/accommodations.service';
import { requireAuth } from '../middleware/auth';

// Read-only housing dashboard. The address-book CRUD endpoints
// (POST/PATCH/DELETE + GET list/detail) were removed — agencies no longer
// track physical units, only how many candidates currently live on agency
// housing vs own housing. Anyone logged in can read this summary.
export const accommodationsRouter = new Hono()
  .use('*', requireAuth)
  .get('/summary', async (c) => {
    const actor = { id: c.var.userId, role: c.var.userRole };
    const summary = await accommodationsService.getHousingSummary(actor);
    return c.json(summary);
  });
