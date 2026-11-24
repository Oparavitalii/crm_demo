import { z } from 'zod';
import { idSchema, optionalTrimmedString } from './common';
import { housingTypeSchema } from './candidate';

// 2026-06-01 status-model rework. Employment-period CRUD payloads.
//
// 2026-06-10: candidate-level lifecycle timestamps (employed_at, dismissed_at,
// cancel_reason_code, …) were dropped from the candidates table. The form-driven
// `workStartDate` / `workEndDate` columns now carry those dates. Cancel flow
// keeps only a free-text reasonNote (no coded reasonCode anymore).

// Used by `[Працевлаштувати]` button on candidate detail. Flips candidate to
// status='employed', kind='client', inserts a fresh row in employment_periods.
export const hireCandidateSchema = z.object({
  workStartDate: z.string().datetime(),
  // 2026-07-02 — optional per client request ("only name is obligatory").
  // employment_periods.housing_type is nullable, so a hire without housing
  // simply leaves the housing dashboards blank for that period.
  housingType: housingTypeSchema.nullish(),
  projectId: idSchema.nullish(),
  coordinatorId: idSchema.nullish(),
});
export type HireCandidateInput = z.infer<typeof hireCandidateSchema>;

// Used by `[Звільнити]` button on client detail. Closes the open period (sets
// dismissedAt + reason), sets candidate.status='dismissed'. The `dismissals`
// table also receives a row for the existing retention report.
export const dismissCandidateSchema = z.object({
  workEndDate: z.string().datetime(),
  reasonCode: optionalTrimmedString(100),
  reasonNote: optionalTrimmedString(2000),
});
export type DismissCandidateInput = z.infer<typeof dismissCandidateSchema>;

// Used by `[Повторно працевлаштувати]` on dismissed client. Inserts a new
// employment_periods row, sets status='re_employed'.
export const rehireCandidateSchema = hireCandidateSchema;
export type RehireCandidateInput = HireCandidateInput;

// Used by `[Відмінити]` modal. 2026-06-10: cancel_reason_code column was
// dropped — only a free-text reasonNote remains (optional since 2026-07-02:
// every field independent per client request).
export const cancelCandidateSchema = z.object({
  reasonNote: optionalTrimmedString(2000),
});
export type CancelCandidateInput = z.infer<typeof cancelCandidateSchema>;

export const employmentPeriodSchema = z.object({
  id: idSchema,
  candidateId: idSchema,
  employedAt: z.string().datetime(),
  dismissedAt: z.string().datetime().nullable(),
  dismissedReason: z.string().nullable(),
  housingType: housingTypeSchema.nullable(),
  projectId: idSchema.nullable(),
  coordinatorId: idSchema.nullable(),
  createdAt: z.string().datetime(),
  createdBy: idSchema.nullable(),
  projectName: z.string().nullable().optional(),
  coordinatorFirstName: z.string().nullable().optional(),
  coordinatorLastName: z.string().nullable().optional(),
});
export type EmploymentPeriod = z.infer<typeof employmentPeriodSchema>;

export const listEmploymentPeriodsResponseSchema = z.object({
  items: z.array(employmentPeriodSchema),
});
export type ListEmploymentPeriodsResponse = z.infer<typeof listEmploymentPeriodsResponseSchema>;
