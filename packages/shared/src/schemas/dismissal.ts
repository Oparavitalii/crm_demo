import { z } from 'zod';
import { dateRangeFilterShape, idSchema, optionalTrimmedString, paginationSchema } from './common';

export const DISMISSAL_REASONS = [
  'employee_resigned',
  'returned_home',
  'found_other_job',
  'low_performance',
  'absenteeism',
  'misconduct',
  'contract_ended',
  'health_issues',
  'conflict',
  'other',
] as const;
export type DismissalReason = (typeof DISMISSAL_REASONS)[number];

export const createDismissalSchema = z.object({
  candidateId: idSchema,
  dismissedAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(1000),
  // Free-text taxonomy slug — DISMISSAL_REASONS above are the seeded
  // suggestions but recruiters may type a custom code (e.g. "covid_leave",
  // "moved_to_germany"). The retention report groups by whatever value lands
  // here, so consistent typing matters more than enum strictness.
  // Same pattern as `source` on candidates.
  reasonCode: optionalTrimmedString(100),
  notes: optionalTrimmedString(5000),
});
export type CreateDismissalInput = z.infer<typeof createDismissalSchema>;

export const updateDismissalSchema = createDismissalSchema
  .omit({ candidateId: true })
  .partial();
export type UpdateDismissalInput = z.infer<typeof updateDismissalSchema>;

export const dismissalSchema = createDismissalSchema.extend({
  id: idSchema,
  recordedById: idSchema.nullable(),
  reasonCode: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type Dismissal = z.infer<typeof dismissalSchema>;

export const listDismissalsQuerySchema = paginationSchema.extend({
  candidateId: idSchema.optional(),
  recordedById: idSchema.optional(),
  source: z.string().trim().min(1).max(50).optional(),
  // Legacy date filters — kept for back-compat with existing callers.
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  // Substring search on the human-typed reason field (ilike %value%).
  reason: z.string().trim().max(200).optional(),
  // Filter by canonical reason code — free text since the taxonomy is now open.
  reasonCode: z.string().trim().min(1).max(100).optional(),
  // Filter by recruiter (joins candidates.recruiterId) — used by the retention
  // report (FAZA 23) so Yana can drill into a single recruiter's history.
  recruiterId: idSchema.optional(),
  // Filter by coordinator (joins candidates.coordinatorId).
  coordinatorId: idSchema.optional(),
  // Filter by project (joins candidates.projectId) — same use case as above.
  projectId: idSchema.optional(),
  // Free-text search on candidate name (ilike %q%).
  q: z.string().trim().min(1).max(100).optional(),
  // Date-range filter on `dismissedAt` (the business-meaningful date).
  ...dateRangeFilterShape,
});
export type ListDismissalsQuery = z.infer<typeof listDismissalsQuerySchema>;

export const listDismissalsResponseSchema = z.object({
  items: z.array(dismissalSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListDismissalsResponse = z.infer<typeof listDismissalsResponseSchema>;

// Enriched (registry) — joined with candidate + recorder + project + recruiter
export const enrichedDismissalSchema = dismissalSchema.extend({
  candidateName: z.string().nullable(),
  candidateSource: z.string().nullable(),
  recordedByFirstName: z.string().nullable(),
  recordedByLastName: z.string().nullable(),
  // Added for retention report (FAZA 23): so the table can show recruiter +
  // project + days worked alongside the dismissal reason without an N+1.
  recruiterFirstName: z.string().nullable().optional(),
  recruiterLastName: z.string().nullable().optional(),
  coordinatorFirstName: z.string().nullable().optional(),
  coordinatorLastName: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  workStartDate: z.string().datetime().nullable().optional(),
  daysWorked: z.number().int().nullable().optional(),
  reasonNote: z.string().nullable().optional(),
});
export type EnrichedDismissal = z.infer<typeof enrichedDismissalSchema>;

export const listEnrichedDismissalsResponseSchema = z.object({
  items: z.array(enrichedDismissalSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListEnrichedDismissalsResponse = z.infer<typeof listEnrichedDismissalsResponseSchema>;
