import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createStatusLookupSchema,
  idSchema,
  listStatusLookupQuerySchema,
  statusLookupTypeSchema,
  type StatusLookupType,
  updateStatusLookupSchema,
  USER_CREATABLE_LOOKUP_TYPES,
} from '@crm/shared';
import * as svc from '../services/status-lookups.service';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildReqCtx } from '../middleware/audit';
import { ForbiddenError } from '../lib/errors';

const adminOnly = requireRole(['admin']);
const USER_CREATABLE_SET = new Set<string>(USER_CREATABLE_LOOKUP_TYPES);

const idParam = z.object({ id: idSchema });
const typeQuery = z.object({ type: statusLookupTypeSchema });

// Read-only router for all authenticated users. Frontend forms/selects pull
// active lookups from here.
export const statusLookupsRouter = new Hono()
  .use('*', requireAuth)
  // Whole taxonomy in one response. A candidate list mounts nine lookup hooks
  // and a candidate detail page nine more; as nine separate requests each one
  // cost a requireAuth session lookup plus its own pool connection, on a page
  // that already fires ~39 requests. Cached 5 min server-side, busted on write.
  .get('/all', async (c) => {
    const items = await svc.listAllActive();
    return c.json({ items });
  })
  .get('/', zValidator('query', typeQuery), async (c) => {
    const { type } = c.req.valid('query');
    const items = await svc.listActive(type);
    return c.json({ items });
  });

// Admin CRUD router for /admin/status-lookups. Soft-delete + restore +
// optional hard-delete (blocked when isSystem=true or usage>0).
//
// POST is intentionally NOT globally admin-gated: any authenticated user can
// ADD a new option for the user-creatable lookup types (currently `position`
// and `legal_status`), so recruiters can extend those lists inline from the
// candidate form. PATCH/DELETE/restore/hard-delete and read-of-trash remain
// admin-only for every type. The per-type role check lives in the POST
// handler below, after the body is parsed.
export const adminStatusLookupsRouter = new Hono()
  .use('*', requireAuth)
  .get('/', adminOnly, zValidator('query', listStatusLookupQuerySchema), async (c) => {
    const { type, includeDeleted } = c.req.valid('query');
    const items = includeDeleted ? await svc.listAll(type) : await svc.listActive(type);
    return c.json({ items });
  })
  .get('/trash', adminOnly, async (c) => {
    const items = await svc.listDeleted();
    return c.json({ items });
  })
  .get('/:id/usage', adminOnly, zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const found = await svc.findById(id);
    if (!found) return c.json({ error: 'NOT_FOUND' }, 404);
    const count = await svc.getUsage(found.type as StatusLookupType, found.code);
    return c.json({ type: found.type, code: found.code, count });
  })
  // POST is the ONLY non-admin route on /admin/status-lookups — see the
  // router-level comment for the rationale.
  .post('/', zValidator('json', createStatusLookupSchema), async (c) => {
    const input = c.req.valid('json');
    if (!USER_CREATABLE_SET.has(input.type) && c.var.userRole !== 'admin') {
      throw new ForbiddenError();
    }
    const actor = { id: c.var.userId, role: c.var.userRole };
    const row = await svc.create(input, actor, buildReqCtx(c));
    return c.json(row, 201);
  })
  .patch(
    '/:id',
    adminOnly,
    zValidator('param', idParam),
    zValidator('json', updateStatusLookupSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const row = await svc.update(id, patch, actor, buildReqCtx(c));
      return c.json(row);
    },
  )
  .delete('/:id', adminOnly, zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await svc.softDelete(id, actor, buildReqCtx(c));
    return c.json(result);
  })
  .post('/:id/restore', adminOnly, zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const row = await svc.restore(id, actor, buildReqCtx(c));
    return c.json(row);
  })
  .delete('/:id/hard', adminOnly, zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    await svc.hardDelete(id, actor, buildReqCtx(c));
    return c.body(null, 204);
  });
