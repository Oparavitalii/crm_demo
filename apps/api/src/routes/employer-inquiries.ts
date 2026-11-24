import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createEmployerInquirySchema,
  idSchema,
  listEmployerInquiriesQuerySchema,
  submitEmployerInquirySchema,
  updateEmployerInquirySchema,
} from '@crm/shared';
import { z } from 'zod';
import * as service from '../services/employer-inquiries.service';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildReqCtx, getClientIp } from '../middleware/audit';
import { publicFormRateLimiter } from '../middleware/rate-limit';

const idParam = z.object({ id: idSchema });

// Public router — no auth. Mounted at /public.
// Rate limited at middleware layer (token-bucket per IP) in addition to the
// per-email/per-IP DB throttle in the service layer.
export const publicEmployerInquiriesRouter = new Hono()
  .post(
    '/',
    publicFormRateLimiter,
    zValidator('json', submitEmployerInquirySchema),
    async (c) => {
      const input = c.req.valid('json');
      const result = await service.submitFromPublic(input, buildReqCtx(c));
      return c.json(result, 201);
    },
  );

// Auth router — for CRM management. Mounted at /employer-inquiries.
export const employerInquiriesRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listEmployerInquiriesQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await service.listInquiries(query, user);
    return c.json(result);
  })
  .post(
    '/',
    requireRole(['admin', 'coordinator', 'recruiter']),
    zValidator('json', createEmployerInquirySchema),
    async (c) => {
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await service.createInquiry(input, user, ctx);
      return c.json(row, 201);
    },
  )
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const row = await service.getInquiry(id, user);
    return c.json(row);
  })
  .patch(
    '/:id',
    requireRole(['admin', 'coordinator', 'recruiter']),
    zValidator('param', idParam),
    zValidator('json', updateEmployerInquirySchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const row = await service.updateInquiry(id, patch, user, ctx);
      return c.json(row);
    },
  )
  .delete('/:id', requireRole(['admin']), zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
    await service.deleteInquiry(id, user, ctx);
    return c.body(null, 204);
  });
