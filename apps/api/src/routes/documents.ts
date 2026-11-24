import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  acceptDocumentSchema,
  idSchema,
  listDocumentsQuerySchema,
} from '@crm/shared';
import * as service from '../services/documents.service';
import { requireAuth } from '../middleware/auth';
import { buildReqCtx } from '../middleware/audit';

const idParam = z.object({ id: idSchema });
const slugParam = z.object({ slug: z.string().min(1).max(100) });

export const documentsRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listDocumentsQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await service.listDocuments(query, actor);
    return c.json(result);
  })
  .get('/:slug', zValidator('param', slugParam), async (c) => {
    const { slug } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const doc = await service.getDocumentBySlug(slug, actor);
    return c.json(doc);
  })
  // Returns the presigned R2 URL as JSON instead of redirecting — lets the
  // frontend keep the Bearer token on the JSON call, then window.open() the
  // presigned URL (which carries its own R2 signature, no auth header needed).
  // A plain <a href> would lose the Bearer header on cross-tab navigation.
  .get('/:id/file', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const url = await service.getDocumentFileUrl(id, actor);
    return c.json({ url });
  })
  .post(
    '/:id/accept',
    zValidator('param', idParam),
    zValidator('json', acceptDocumentSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const acceptance = await service.acceptDocument(
        { documentId: id, version: body.version },
        actor,
        ctx,
      );
      return c.json(acceptance, 201);
    },
  );
