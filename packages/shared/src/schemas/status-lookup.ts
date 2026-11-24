import { z } from 'zod';
import { idSchema } from './common';

// Admin-editable lookup table for 4 dynamic status lists. See
// apps/api/src/db/tables/status-lookups.ts for the full description.
export const statusLookupTypeSchema = z.enum([
  'sources',
  'candidate_status',
  'dismissal_reason',
  'no_show_reason',
  // 2026-06-10: two new candidate fields where any authenticated user can
  // extend the list inline (vs admin-only for the other types). See
  // `routes/status-lookups.ts` POST handler for the per-type role check.
  'position',
  'legal_status',
  // 2026-06-10 (part 2): nationality moves from free-text TextInput to a
  // user-extendable lookup. Seeded with ua/pl/md in migration 0034.
  'nationality',
  // 2026-06-10 Block 7 (Звірка / Виплати) — four reconciliation lookups,
  // seeded in migrations 0036 + 0037. work_outcome / payout_status /
  // payment_status are coordinator-only triage; retention is also picked at
  // month-end. All open to user-add so admins can extend the bucket list.
  'work_outcome',
  'payout_status',
  'payment_status',
  'retention',
]);
// Types that any authenticated user (not just admin) is allowed to ADD new
// options to via POST /admin/status-lookups. Editing/deleting stays admin-only.
// Extended 2026-06-10: nationality, no_show_reason, sources also user-creatable.
export const USER_CREATABLE_LOOKUP_TYPES = [
  'position',
  'legal_status',
  'nationality',
  'no_show_reason',
  'sources',
  // 2026-06-12: recruiter fills `work_end_reason` from the candidate form via
  // a LookupSelect. The form needs inline "+ Dodaj nową" without waiting on
  // an admin, so the type is user-creatable now. Editing/deleting still
  // requires admin (per per-type role check in routes/status-lookups.ts).
  'dismissal_reason',
  // Block 7 reconciliation lookups — coordinators routinely extend them.
  'work_outcome',
  'payout_status',
  'payment_status',
  'retention',
] as const;
export type StatusLookupType = z.infer<typeof statusLookupTypeSchema>;
export const STATUS_LOOKUP_TYPES = statusLookupTypeSchema.options;

// Code (slug) — lower snake_case, 2..50 chars, must start with a letter so it
// can be safely used in URLs/CSS/JS without quoting.
export const statusLookupCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,49}$/, 'invalid_code');

const labelSchema = z.string().trim().min(1).max(100);

// Retention channel a SOURCE belongs to (only meaningful for type='sources').
// Drives the "Утримання за каналом" analytics table; admin-editable so a new
// source can be classified without a code change.
export const sourceChannelSchema = z.enum([
  'social',
  'jobBoards',
  'website',
  'formRecruiter',
  'other',
]);
export type SourceChannel = z.infer<typeof sourceChannelSchema>;
export const SOURCE_CHANNELS = sourceChannelSchema.options;

export const statusLookupSchema = z.object({
  id: idSchema,
  type: statusLookupTypeSchema,
  code: z.string(),
  labelPl: z.string(),
  labelUa: z.string(),
  // Channel for sources (see sourceChannelSchema); null for other types.
  groupKey: z.string().nullable(),
  sortOrder: z.number().int(),
  isSystem: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdById: idSchema.nullable(),
});
export type StatusLookup = z.infer<typeof statusLookupSchema>;

export const createStatusLookupSchema = z.object({
  type: statusLookupTypeSchema,
  code: statusLookupCodeSchema,
  labelPl: labelSchema,
  labelUa: labelSchema,
  // Optional retention channel; validated against the channel enum but stored
  // nullable. Ignored for non-source types.
  groupKey: sourceChannelSchema.nullish(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type CreateStatusLookupInput = z.infer<typeof createStatusLookupSchema>;

// Code is immutable — changing it would orphan existing DB rows that
// reference the old value.
export const updateStatusLookupSchema = createStatusLookupSchema
  .omit({ type: true, code: true })
  .partial();
export type UpdateStatusLookupInput = z.infer<typeof updateStatusLookupSchema>;

export const listStatusLookupQuerySchema = z.object({
  type: statusLookupTypeSchema,
  includeDeleted: z.coerce.boolean().default(false),
});
export type ListStatusLookupQuery = z.infer<typeof listStatusLookupQuerySchema>;

export const statusLookupUsageSchema = z.object({
  type: statusLookupTypeSchema,
  code: z.string(),
  count: z.number().int().nonnegative(),
});
export type StatusLookupUsage = z.infer<typeof statusLookupUsageSchema>;
