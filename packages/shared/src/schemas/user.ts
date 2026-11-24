import { z } from 'zod';
import { idSchema, emailSchema } from './common';

export const userRoleSchema = z.enum(['admin', 'recruiter', 'coordinator', 'readonly']);
export type UserRole = z.infer<typeof userRoleSchema>;

// Safe shape returned to clients — no passwordHash, no twoFactorSecret, no lockout counters
export const publicUserSchema = z.object({
  id: idSchema,
  email: emailSchema,
  firstName: z.string(),
  lastName: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  has2FA: z.boolean().default(false),
  // Per-user public application form slug. Surfaced so non-admin users can
  // see their own /apply/:slug link from their profile page. Nullable for
  // legacy / system users not yet backfilled.
  publicSlug: z.string().nullable().optional(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;
