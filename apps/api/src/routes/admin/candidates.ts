import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { idSchema } from '@opushr/shared';
import { requireAuth, requireRole } from '../../middleware/auth';
import { getClientIp } from '../../middleware/audit';
import * as anonymizeService from '../../services/anonymize.service';
import * as exportService from '../../services/export.service';

const idParam = z.object({ id: idSchema });

export const adminCandidatesRouter = new Hono()
  .use('*', requireAuth)
  .use('*', requireRole(['admin']))

  // POST /admin/candidates/:id/anonymize — idempotent
  .post('/:id/anonymize', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    const result = await anonymizeService.anonymizeCandidate(id, actor, ctx);
    return c.json(result, 200);
  })

  // GET /admin/candidates/:id/export — RODO art. 15 data export
  .get('/:id/export', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const data = await exportService.exportCandidate(id, actor);
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="candidate-${id}.json"`);
    return c.json(data, 200);
  });
