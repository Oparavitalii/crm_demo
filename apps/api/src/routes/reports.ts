import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { listCandidatesQuerySchema } from '@crm/shared';
import * as candidatesService from '../services/candidates.service';
import { requireAuth } from '../middleware/auth';

// Cross-entity report endpoints. Each report is a read-only enriched list —
// no mutation, no audit log. RBAC is applied inside the service layer the
// same way as the underlying list endpoints.
export const reportsRouter = new Hono()
  .use('*', requireAuth)
  // Failed Candidates Report (Yana, 2026-05-29) — returns candidates that
  // never reached the workplace (status='cancelled' OR workEndReason set).
  // 2026-06-10: filter switched from dropped `no_show_reason` to `work_end_reason`.
  // Frontend handles CSV export from the enriched list.
  .get('/failed-candidates', zValidator('query', listCandidatesQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await candidatesService.listFailedCandidates(query, user);
    return c.json(result);
  });
