import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createProjectSchema,
  idSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
} from '@crm/shared';
import { z } from 'zod';
import * as projectsService from '../services/projects.service';
import { requireAuth, requireRole } from '../middleware/auth';
import { getClientIp } from '../middleware/audit';

const idParam = z.object({ id: idSchema });

export const projectsRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listProjectsQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await projectsService.listProjects(query, user);
    return c.json(result);
  })
  .post(
    '/',
    requireRole(['admin']),
    zValidator('json', createProjectSchema),
    async (c) => {
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await projectsService.createProject(input, user, ctx);
      return c.json(row, 201);
    },
  )
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const row = await projectsService.getProject(id, user);
    return c.json(row);
  })
  .patch(
    '/:id',
    requireRole(['admin']),
    zValidator('param', idParam),
    zValidator('json', updateProjectSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await projectsService.updateProject(id, patch, user, ctx);
      return c.json(row);
    },
  )
  .delete('/:id', requireRole(['admin']), zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await projectsService.deleteProject(id, user, ctx);
    return c.body(null, 204);
  });
