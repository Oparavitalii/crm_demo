import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  adminSetConsentSchema,
  bulkConsentRequestSchema,
  cancelCandidateSchema,
  createCandidateSchema,
  dismissCandidateSchema,
  hireCandidateSchema,
  idSchema,
  listCandidatesQuerySchema,
  rehireCandidateSchema,
  submitPublicCandidateSchema,
  updateCandidateSchema,
} from '@opushr/shared';
import { z } from 'zod';
import * as candidatesService from '../services/candidates.service';
import * as duplicatesService from '../services/duplicates.service';
import * as periodsRepo from '../repositories/employment-periods.repo';
import { requireAuth, requireRole } from '../middleware/auth';
import { buildReqCtx } from '../middleware/audit';
import { publicFormRateLimiter } from '../middleware/rate-limit';

// Strict 'true'/'false' parse (z.coerce.boolean would treat any non-empty string as true).
const forceQuery = z.object({
  force: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
const idParam = z.object({ id: idSchema });

export const candidatesRouter = new Hono()
  .use('*', requireAuth)
  .get('/', zValidator('query', listCandidatesQuerySchema), async (c) => {
    const query = c.req.valid('query');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await candidatesService.listCandidates(query, user);
    return c.json(result);
  })
  .post(
    '/',
    requireRole(['admin', 'recruiter']),
    zValidator('json', createCandidateSchema),
    zValidator('query', forceQuery),
    async (c) => {
      const input = c.req.valid('json');
      const { force } = c.req.valid('query');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await candidatesService.createCandidate(input, user, force, ctx);
      return c.json(row, 201);
    },
  )
  // Bulk: email a confirm/manage link to many selected candidates at once.
  .post(
    '/consent-requests',
    requireRole(['admin']),
    zValidator('json', bulkConsentRequestSchema),
    async (c) => {
      const { candidateIds } = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const result = await candidatesService.sendConsentRequestsBulk(candidateIds, user, ctx);
      return c.json(result);
    },
  )
  .get('/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const row = await candidatesService.getCandidate(id, user);
    return c.json(row);
  })
  .get('/:id/duplicates', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const items = await duplicatesService.getCandidateDuplicates(id, user);
    return c.json({ items });
  })
  .patch(
    '/:id',
    // 2026-07-02 — coordinators may edit too (client request: every role can
    // change everything). Row scope still applies: canSee() in the service
    // limits recruiters/coordinators to their own candidates/clients.
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('param', idParam),
    zValidator('json', updateCandidateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await candidatesService.updateCandidate(id, patch, user, ctx);
      return c.json(row);
    },
  )
  .delete('/:id', requireRole(['admin']), zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const ctx = buildReqCtx(c);
    await candidatesService.deleteCandidate(id, user, ctx);
    return c.body(null, 204);
  })
  // 2026-06-01 status-model rework. Lifecycle endpoints — each one wraps the
  // status flip + employment_periods write + audit log into a single call so
  // the frontend doesn't orchestrate the transaction across multiple PATCHes.
  .post(
    '/:id/hire',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('param', idParam),
    zValidator('json', hireCandidateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await candidatesService.hireCandidate(id, input, user, ctx);
      return c.json(row);
    },
  )
  .post(
    '/:id/rehire',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('param', idParam),
    zValidator('json', rehireCandidateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await candidatesService.rehireCandidate(id, input, user, ctx);
      return c.json(row);
    },
  )
  .post(
    '/:id/dismiss',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('param', idParam),
    zValidator('json', dismissCandidateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await candidatesService.dismissCandidate(id, input, user, ctx);
      return c.json(row);
    },
  )
  .post(
    '/:id/cancel',
    requireRole(['admin', 'recruiter', 'coordinator']),
    zValidator('param', idParam),
    zValidator('json', cancelCandidateSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const row = await candidatesService.cancelCandidate(id, input, user, ctx);
      return c.json(row);
    },
  )
  .get(
    '/:id/employment-periods',
    zValidator('param', idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const user = { id: c.var.userId, role: c.var.userRole };
      // RBAC: getCandidate enforces canSee — calling it first protects the listing.
      await candidatesService.getCandidate(id, user);
      const items = await periodsRepo.listByCandidate(id);
      return c.json({ items });
    },
  )
  // ADMIN-ONLY override: set email/sms marketing consent directly (audited).
  .post(
    '/:id/admin-consent',
    requireRole(['admin']),
    zValidator('param', idParam),
    zValidator('json', adminSetConsentSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const result = await candidatesService.adminSetConsent(id, input, user, ctx);
      return c.json(result);
    },
  )
  // System emails the candidate a confirm/manage link — operator never sees it.
  .post(
    '/:id/send-consent-request',
    requireRole(['admin']),
    zValidator('param', idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const user = { id: c.var.userId, role: c.var.userRole };
      const ctx = buildReqCtx(c);
      const result = await candidatesService.sendConsentRequest(id, user, ctx);
      return c.json(result);
    },
  );

// Public submission router — mounted at /public/candidates AND /public/leads
// (legacy alias). Receives candidate submissions from the agency website PHP
// contact form (source='website') and Make.com → FB Lead Ads (source='facebook').
// No auth — rate-limited per IP via publicFormRateLimiter. Audit log writes
// actorId=null since the submitter is unauthenticated.
export const publicCandidatesRouter = new Hono().post(
  '/',
  publicFormRateLimiter,
  zValidator('json', submitPublicCandidateSchema),
  async (c) => {
    const input = c.req.valid('json');
    const result = await candidatesService.submitFromPublic(input, buildReqCtx(c));
    return c.json(result, 201);
  },
);
