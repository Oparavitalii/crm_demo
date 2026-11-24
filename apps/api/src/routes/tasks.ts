import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createTaskSchema,
  idSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from '@opushr/shared';
import * as service from '../services/tasks.service';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildReqCtx } from '../middleware/audit';

const idParam = z.object({ id: idSchema });

// F16: tasks/reminders module. All routes require auth; only admin/recruiter/
// coordinator may mutate. Readonly users can list/get (their own scope is empty
// since they aren't tied to candidates, so they effectively see all).
export const tasksRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listTasksQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await service.listTasks(query, user);
    return c.json(result);
  })
  .post(
    '/',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('json', createTaskSchema),
    async (c) => {
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const row = await service.createTask(input, user, buildReqCtx(c));
      return c.json(row, 201);
    },
  )
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const row = await service.getTask(id, user);
    return c.json(row);
  })
  .patch(
    '/:id',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('param', idParam),
    zValidator('json', updateTaskSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const row = await service.updateTask(id, input, user, buildReqCtx(c));
      return c.json(row);
    },
  )
  .delete(
    '/:id',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('param', idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const user = { id: c.var.userId, role: c.var.userRole };
      await service.deleteTask(id, user, buildReqCtx(c));
      return c.body(null, 204);
    },
  );
