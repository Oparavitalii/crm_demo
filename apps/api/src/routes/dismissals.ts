import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createDismissalSchema,
  idSchema,
  listDismissalsQuerySchema,
  updateDismissalSchema,
} from '@crm/shared';
import { z } from 'zod';
import * as dismissalsService from '../services/dismissals.service';
import * as audit from '../services/audit.service';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildReqCtx, getClientIp } from '../middleware/audit';

const idParam = z.object({ id: idSchema });

export const dismissalsRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listDismissalsQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await dismissalsService.listDismissals(query, user);
    return c.json(result);
  })
  .get('/registry', zValidator('query', listDismissalsQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await dismissalsService.listEnrichedDismissals(query, user);
    return c.json(result);
  })
  // XLSX export of the dismissals registry honoring the same filters as
  // /registry. Admin sees everything; coordinator sees the candidates they
  // manage (same scoping rule as the list endpoint). Recruiters do NOT have
  // export access — they'd only see their own scope which they can already
  // page through in the UI.
  .get(
    '/export.xlsx',
    requireRole(['admin', 'coordinator']),
    zValidator('query', listDismissalsQuerySchema),
    async (c) => {
      const query = c.req.valid('query');
      const user = { id: c.var.userId, role: c.var.userRole };
      const { buffer, rowCount } = await dismissalsService.exportDismissalsXlsx(query, user);

      // Audit AFTER the export succeeded; rowCount only — no PII in newValue.
      await audit.log({
        actorId: c.var.userId,
        action: 'dismissals.export',
        entityType: 'dismissals',
        entityId: null,
        oldValue: null,
        newValue: { rowCount },
        ...buildReqCtx(c),
      });

      const dateStamp = new Date().toISOString().slice(0, 10);
      c.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      c.header(
        'Content-Disposition',
        `attachment; filename="dismissals-${dateStamp}.xlsx"`,
      );
      // Exposed via CORS so the SPA can read it from the response object.
      c.header('X-Row-Count', String(rowCount));
      return c.body(buffer);
    },
  )
  .post(
    '/',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('json', createDismissalSchema),
    async (c) => {
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await dismissalsService.createDismissal(input, user, ctx);
      return c.json(row, 201);
    },
  )
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const row = await dismissalsService.getDismissal(id, user);
    return c.json(row);
  })
  .patch(
    '/:id',
    requireRole(['admin', 'recruiter']),
    zValidator('param', idParam),
    zValidator('json', updateDismissalSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await dismissalsService.updateDismissal(id, patch, user, ctx);
      return c.json(row);
    },
  )
  .delete('/:id', requireRole(['admin']), zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await dismissalsService.deleteDismissal(id, user, ctx);
    return c.body(null, 204);
  });
