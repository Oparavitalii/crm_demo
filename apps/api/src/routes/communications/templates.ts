import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createMessageTemplateSchema,
  idSchema,
  listMessageTemplatesQuerySchema,
  updateMessageTemplateSchema,
} from '@crm/shared';
import { z } from 'zod';
import * as service from '../../services/message-templates.service';
import { requireAuth, requireRole } from '../../middleware/auth';
import { getClientIp } from '../../middleware/audit';

const idParam = z.object({ id: idSchema });

export const templatesRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listMessageTemplatesQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await service.listTemplates(query, actor);
    return c.json(result);
  })
  .post(
    '/',
    requireRole(['admin', 'recruiter']),
    zValidator('json', createMessageTemplateSchema),
    async (c) => {
      const input = c.req.valid('json');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await service.createTemplate(input, actor, ctx);
      return c.json(row, 201);
    },
  )
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const row = await service.getTemplate(id, actor);
    return c.json(row);
  })
  .patch(
    '/:id',
    requireRole(['admin', 'recruiter']),
    zValidator('param', idParam),
    zValidator('json', updateMessageTemplateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await service.updateTemplate(id, patch, actor, ctx);
      return c.json(row);
    },
  )
  .delete(
    '/:id',
    requireRole(['admin', 'recruiter']),
    zValidator('param', idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      await service.deleteTemplate(id, actor, ctx);
      return c.body(null, 204);
    },
  );
