import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createCandidateCommentSchema,
  idSchema,
} from '@opushr/shared';
import * as service from '../services/candidate-comments.service';
import { requireAuth } from '../middleware/auth';
import { buildReqCtx } from '../middleware/audit';

// Mounted at `/candidates` in index.ts. Routes are scoped under `/:id/comments`
// to keep the URL aligned with the parent resource without conflicting with
// the main candidates router (Hono merges routers at the same prefix).
const idParam = z.object({ id: idSchema });
const commentIdParam = z.object({ id: idSchema, commentId: idSchema });

export const candidateCommentsRouter = new Hono()
  .use('*', requireAuth)
  .get('/:id/comments', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = { id: c.var.userId, role: c.var.userRole };
    const result = await service.listComments(id, user);
    return c.json(result);
  })
  .post(
    '/:id/comments',
    zValidator('param', idParam),
    zValidator('json', createCandidateCommentSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const user = { id: c.var.userId, role: c.var.userRole };
      const row = await service.createComment(id, input, user, buildReqCtx(c));
      return c.json(row, 201);
    },
  )
  .delete(
    '/:id/comments/:commentId',
    zValidator('param', commentIdParam),
    async (c) => {
      const { commentId } = c.req.valid('param');
      const user = { id: c.var.userId, role: c.var.userRole };
      await service.deleteComment(commentId, user, buildReqCtx(c));
      return c.body(null, 204);
    },
  );
