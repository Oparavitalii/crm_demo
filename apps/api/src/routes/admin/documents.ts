import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createDocumentMdSchema,
  createDocumentFileMetaSchema,
  idSchema,
  updateDocumentSchema,
  type CreateDocumentFileMetaInput,
} from '@opushr/shared';
import * as service from '../../services/documents.service';
import { requireAuth, requireRole } from '../../middleware/auth';
import { buildReqCtx } from '../../middleware/audit';
import { parseFileUpload } from '../../lib/multipart';

const idParam = z.object({ id: idSchema });

// 12 MB at HTTP layer = 10 MB content cap + multipart overhead. Defends the
// node from OOM before service-level mime/size checks have a chance to run.
const PDF_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

export const adminDocumentsRouter = new Hono()
  .use('*', requireAuth, requireRole(['admin']))
  // Create from markdown — JSON body
  .post('/markdown', zValidator('json', createDocumentMdSchema), async (c) => {
    const input = c.req.valid('json');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = buildReqCtx(c);
    const row = await service.createMarkdownDocument(input, actor, ctx);
    return c.json(row, 201);
  })
  // Create from PDF upload — multipart/form-data with `file` + `meta` (JSON)
  .post(
    '/file',
    bodyLimit({
      maxSize: PDF_UPLOAD_MAX_BYTES,
      onError: (c) => c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413),
    }),
    async (c) => {
      const { meta, file } = await parseFileUpload<CreateDocumentFileMetaInput>(
        c,
        'file',
        'meta',
        'application/pdf',
      );
      const parsedMeta = createDocumentFileMetaSchema.parse(meta);
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await service.createFileDocument(parsedMeta, file, actor, ctx);
      return c.json(row, 201);
    },
  )
  // Admin get-by-id — needed by the edit page. Avoids the "fetch list of 200"
  // workaround which silently breaks once doc count exceeds 200.
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const doc = await service.getDocumentByIdAdmin(id, actor);
    return c.json(doc);
  })
  .patch(
    '/:id',
    zValidator('param', idParam),
    zValidator('json', updateDocumentSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await service.updateDocument(id, patch, actor, ctx);
      return c.json(row);
    },
  )
  .post('/:id/publish', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = buildReqCtx(c);
    const row = await service.publishDocument(id, actor, ctx);
    return c.json(row);
  })
  .delete('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const ctx = buildReqCtx(c);
    await service.softDeleteDocument(id, actor, ctx);
    return c.body(null, 204);
  })
  .get('/:id/acceptances', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const items = await service.listAcceptancesForDocument(id, actor);
    return c.json({ items });
  })
  .get('/:id/acceptances.csv', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const actor = { id: c.var.userId, role: c.var.userRole };
    const items = await service.listAcceptancesForDocument(id, actor);

    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'wersja,email,imie,nazwisko,zaakceptowano_o,ip,user_agent';
    const lines = items.map((r) =>
      [
        r.version,
        r.userEmail,
        r.userFirstName ?? '',
        r.userLastName ?? '',
        r.acceptedAt.toISOString(),
        r.ip ?? '',
        r.userAgent ?? '',
      ]
        .map(escape)
        .join(','),
    );
    const csv = [header, ...lines].join('\n');
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="acceptances-${id}.csv"`);
    return c.body(csv);
  });
