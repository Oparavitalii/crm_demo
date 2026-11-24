import { z } from 'zod';
import { idSchema, emailSchema, paginationSchema, dateRangeFilterShape } from './common';
import { userRoleSchema } from './user';

export const createUserSchema = z
  .object({
    // Optional: only required when sendInvite=true (see refine below). When a
    // no-login account is created without an email, the backend generates an
    // internal non-deliverable placeholder so the NOT NULL/unique column holds.
    // Empty string from the form is normalized to undefined.
    email: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      emailSchema.optional(),
    ),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    role: userRoleSchema,
    isFreelancer: z.boolean().default(false),
    // true  → invite by email (welcome/reset link, account active).
    // false → create without login: no email, no reset token, isActive=false.
    //         Used for freelancers (source tags) and any no-login account.
    sendInvite: z.boolean().default(true),
  })
  .refine((v) => v.sendInvite === false || (v.email !== undefined && v.email.length > 0), {
    message: 'email_required_for_invite',
    path: ['email'],
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  // Editable ONLY while the user has never logged in (lastLoginAt IS NULL).
  // Service enforces this constraint — letting it through here would
  // silently rewrite the login key for an active session-holder.
  email: emailSchema.optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  role: userRoleSchema.optional(),
  isActive: z.boolean().optional(),
  isFreelancer: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const adminUserSchema = z.object({
  id: idSchema,
  email: emailSchema,
  firstName: z.string(),
  lastName: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
  isFreelancer: z.boolean().default(false),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  has2FA: z.boolean().default(false),
  // Public URL slug used for the per-user application form (/apply/:slug).
  // Nullable for legacy users not yet backfilled.
  publicSlug: z.string().nullable().optional(),
  // Surfaced for admin observability — match the DB row so /admin/users
  // doesn't omit anything but the two truly sensitive fields (password_hash
  // and the raw two_factor_secret, which has2FA already exposes safely).
  updatedAt: z.string().datetime().optional(),
  failedLoginAttempts: z.number().int().nonnegative().optional(),
  lockedUntil: z.string().datetime().nullable().optional(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  role: userRoleSchema.optional(),
  // Use string-literal transform — z.coerce.boolean() incorrectly coerces "false" → true (truthy string).
  isActive:     z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  isFreelancer: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  has2fa:       z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  q: z.string().trim().min(1).max(100).optional(),
  ...dateRangeFilterShape,
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listUsersResponseSchema = z.object({
  items: z.array(adminUserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;

export const createUserResponseSchema = z.object({
  user: adminUserSchema,
  passwordEmailSent: z.boolean(),
  temporaryPassword: z.string().optional(),
});
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

// Minimal user info for /users-directory — used by recruiters to pick a
// coordinator at promotion-to-client and by retention report filters. Avoids
// exposing email / 2FA / lastLoginAt to non-admins.
export const directoryUserSchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
  role: userRoleSchema,
  isActive: z.boolean(),
});
export type DirectoryUser = z.infer<typeof directoryUserSchema>;

export const directoryQuerySchema = z.object({
  role: userRoleSchema.optional(),
  // When true, deactivated users are also returned. Default false keeps the
  // legacy "active users only" behavior for callers that don't opt in
  // (LeadForm, AddTaskModal, retention filter). Candidate form opts in so the
  // recruiter/coordinator dropdowns show every user that has ever held the
  // role, with a "(неактивний)" badge in the UI label.
  includeInactive: z.coerce.boolean().default(false),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

export const listDirectoryResponseSchema = z.object({
  items: z.array(directoryUserSchema),
});
export type ListDirectoryResponse = z.infer<typeof listDirectoryResponseSchema>;
