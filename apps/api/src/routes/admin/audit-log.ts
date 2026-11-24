import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { listAuditLogQuerySchema, listConsentHistoryQuerySchema } from '@crm/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as auditLogService from '../../services/audit-log.service';

export const adminAuditLogRouter = new Hono()
  .use('*', requireAuth)
  .use('*', requireRole(['admin']))

  // GET /admin/audit-log
  .get('/', zValidator('query', listAuditLogQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await auditLogService.listAuditLog(query, actor);
    return c.json(result);
  })

  // GET /admin/audit-log/consents — "Історія згод" tab
  .get('/consents', zValidator('query', listConsentHistoryQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await auditLogService.listConsentHistory(query, actor);
    return c.json(result);
  });
