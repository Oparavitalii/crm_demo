import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as usersRepo from '../repositories/users.repo';
import { publicLookupRateLimiter } from '../middleware/rate-limit';
import { AppError } from '../lib/errors';

const slugParam = z.object({
  slug: z.string().trim().min(1).max(100),
});

// Public router — no auth. Mounted at `/public/recruiters`. Returns the
// minimum info the public application form needs to greet a candidate by the
// recruiter's name. Rate-limited so an attacker can't enumerate valid slugs.
export const publicRecruitersRouter = new Hono().get(
  '/:slug',
  publicLookupRateLimiter,
  zValidator('param', slugParam),
  async (c) => {
    const { slug } = c.req.valid('param');
    const recruiter = await usersRepo.findByPublicSlug(slug);
    if (!recruiter || !recruiter.isActive) {
      throw new AppError('NOT_FOUND', { entity: 'recruiter' }, 404);
    }
    return c.json({
      slug: recruiter.publicSlug ?? slug,
      firstName: recruiter.firstName,
      lastName: recruiter.lastName,
    });
  },
);
