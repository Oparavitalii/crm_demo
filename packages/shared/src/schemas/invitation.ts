import { z } from 'zod';
import { emailSchema, idSchema } from './common';
import { userRoleSchema } from './user';

export const createInvitationSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: userRoleSchema,
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const createInvitationResponseSchema = z.object({
  id: idSchema,
  email: z.string(),
  inviteUrl: z.string().nullable(),
  emailSent: z.boolean(),
});
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(12).max(200),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const acceptInvitationResponseSchema = z.object({
  userId: idSchema,
  email: z.string(),
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

// Returned by GET /admin/invitations — list of pending (not accepted, not
// expired) invitations. tokenHash is intentionally omitted; even though it's
// hashed, there is no admin-side reason to ship it to the browser.
export const pendingInvitationSchema = z.object({
  id: idSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: userRoleSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedById: idSchema.nullable(),
});
export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;

export const listPendingInvitationsResponseSchema = z.object({
  items: z.array(pendingInvitationSchema),
});
export type ListPendingInvitationsResponse = z.infer<typeof listPendingInvitationsResponseSchema>;
