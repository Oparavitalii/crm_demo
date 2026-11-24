import { z } from 'zod';
import { idSchema } from './common';

// Lightweight read-only directory of freelancers used to populate the
// `freelancerId` filter on the candidates list (and any future picker).
// Mirrors `directoryUserSchema` from user-admin.ts in spirit — no PII like
// email/phone, just the fields needed to render a Select.
export const freelancerDirectorySchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
  isActive: z.boolean(),
});
export type FreelancerDirectory = z.infer<typeof freelancerDirectorySchema>;

export const listFreelancersQuerySchema = z.object({
  // Capped at 500 so a single Select fetch always returns the full team.
  // OPUS HR has <50 freelancers; 500 is a safety net, not a real limit.
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListFreelancersQuery = z.infer<typeof listFreelancersQuerySchema>;

export const listFreelancersResponseSchema = z.object({
  items: z.array(freelancerDirectorySchema),
});
export type ListFreelancersResponse = z.infer<typeof listFreelancersResponseSchema>;
