import { z } from 'zod';
import { dateRangeFilterShape, emailSchema, idSchema, optionalTrimmedString, phoneSchema, paginationSchema } from './common';

// 2026-06-01 status-model rework: 8-value lifecycle. Legacy 4 values
// (arrived, no_show, our_housing, own_housing) dropped in migration 0024.
// `cancelled` added — picked from the [Відмінити] reason modal.
export const candidateStatusSchema = z.enum([
  'new',
  'in_progress',
  'documents_submitted',
  'cancelled',
  'employed',
  're_employed',
  'dismissed',
  'blacklist',
]);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;
export const CANDIDATE_STATUSES = candidateStatusSchema.options;

export const candidateKindSchema = z.enum(['candidate', 'client']);
export type CandidateKind = z.infer<typeof candidateKindSchema>;

// Canonical lifecycle order of statuses. Historically this drove the
// forward-only transition validator (removed 2026-07-02 — all roles may now
// change status in any direction); kept as the display/sort order reference.
export const STATUS_RANK: Record<CandidateStatus, number> = {
  new: 0,
  in_progress: 1,
  documents_submitted: 2,
  cancelled: 3,
  employed: 4,
  re_employed: 5,
  dismissed: 6,
  blacklist: 7,
};

// Source is free-form text since 2026-05-21 (migration 0013) — admins can add
// custom sources from the create-lead form (e.g. olx, referral). The list
// below is exported only as a default-suggestion array for autocomplete UIs.
// Renamed `manual` -> `unknown` per client feedback 2026-05-29 (FAZA 24a) so
// recruiters consciously pick a source instead of defaulting to "manually added".
export const candidateSourceSchema = z.string().trim().min(1).max(50);
export type CandidateSource = z.infer<typeof candidateSourceSchema>;

// FAZA 19.5 denormalized housing snapshot — captures whether the candidate
// lived in OUR housing or OWN housing while passing through the pipeline.
// Stays on the row after auto-promotion to `employed` so client list can
// display housing context without joining placements.
export const housingTypeSchema = z.enum(['own', 'our']);
export type HousingType = z.infer<typeof housingTypeSchema>;
export const HOUSING_TYPES = housingTypeSchema.options;

// FAZA 26 lifecycle checklist — captures whether the candidate arrived to the
// workplace or no-showed. Independent of the `status` enum so a recruiter can
// flip status back/forward while preserving the milestone. Stays on the row
// after auto-promotion.
export const arrivalStatusSchema = z.enum(['arrived', 'no_show']);
export type ArrivalStatus = z.infer<typeof arrivalStatusSchema>;

// 2026-06-01 cancel reasons — codes shared with `CANCEL_REASONS` constant.
export const cancelReasonCodeSchema = z.enum([
  'no_show_lost_contact',
  'personal_reasons',
  'bad_conditions',
  'client_closed_position',
  'legalization_rejected',
  'legal_employment_issue',
  'blacklist',
  'other',
]);
export type CancelReasonCode = z.infer<typeof cancelReasonCodeSchema>;
// DEPRECATED fallback list — kept for UI loading state only. Source of truth
// is the status_lookups table since 2026-05-30; prefer
// useStatusLookup('sources') in frontend code.
export const CANDIDATE_SOURCES = [
  'facebook',
  'instagram',
  'website',
  'work_ua',
  'flagma',
  'referral',
  'unknown',
] as const;

export const createCandidateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  birthDate: z.string().date().nullish(),
  nationality: optionalTrimmedString(50),
  workStartDate: z.string().datetime().nullish(),
  workEndDate: z.string().datetime().nullish(),
  workEndReason: optionalTrimmedString(2000),
  status: candidateStatusSchema.optional(),
  kind: candidateKindSchema.optional(),
  // recruiterId is OPTIONAL on create — admin/anyone can add a candidate first
  // and assign a recruiter later (post-feedback 2026-06-02). Frontend pre-fills
  // with current user for role=recruiter (service still auto-coerces to self).
  recruiterId: idSchema.nullish(),
  coordinatorId: idSchema.nullish(),
  freelancerId: idSchema.nullish(),
  projectId: idSchema.nullish(),
  submittedToVacancyId: idSchema.nullish(),
  reasonNote: optionalTrimmedString(2000),
  source: candidateSourceSchema.nullish(),
  housingType: housingTypeSchema.nullish(),
  // Lifecycle milestones — `documentsSubmittedAt` stamped on first transition
  // to status='documents_submitted', `arrivedAt` set explicitly from the form.
  documentsSubmittedAt: z.string().datetime().nullish(),
  arrivedAt: z.string().datetime().nullish(),
  // 2026-06-10 Excel-import prep: 4 free-text candidate fields. `position` and
  // `legalStatus` resolve to codes from status_lookups (types 'position' and
  // 'legal_status'); the other two are pure free text. All optional.
  position: z.string().trim().max(200).nullish(),
  legalStatus: z.string().trim().max(200).nullish(),
  reconciliationPeriod: z.string().trim().max(200).nullish(),
  // 2026-06-10 Block 7 (Звірка / Виплати) — three soft-enum text fields backed
  // by status_lookups (types 'work_outcome', 'payout_status', 'payment_status').
  // The UI renders them as Mantine badges + admin-editable dropdowns.
  workOutcome: z.string().trim().max(50).nullish(),
  payoutStatus: z.string().trim().max(50).nullish(),
  paymentStatus: z.string().trim().max(50).nullish(),
  // 2026-06-10 «Утримання» — how long the post-hire client stayed on the
  // job, picked from the `retention` status_lookups (under_month, month_plus,
  // two_months_plus, three_months_plus, six_months_plus, eleven_months_plus,
  // off_target).
  retention: z.string().trim().max(50).nullish(),
  // 2026-06-12 — free-text messenger contact (TG/WA/Viber handle or any
  // similar handle/number). Recruiter types the raw value, no structure.
  messenger: optionalTrimmedString(200),
  // 2026-06-12 — work-history description, free text up to ~5000 chars
  // (matches `notes` cap). Optional.
  experience: optionalTrimmedString(5000),
  notes: optionalTrimmedString(5000),
  // 2026-07-14 — manual-create consent capture. When a recruiter adds a
  // candidate by hand (not via the public form), they may attest that the
  // candidate agreed to be contacted for marketing, obtained offline. The
  // service turns these into email_marketing / sms_marketing rows in `consents`
  // with source='manual_verbal'|'manual_paper'. All optional; omitting them
  // records NO consent (the safe default). Never sent by the update path — a
  // consent is evidence of a point-in-time act, not an editable field.
  emailConsentAccepted: z.boolean().optional(),
  smsConsentAccepted: z.boolean().optional(),
  consentBasis: z.enum(['manual_verbal', 'manual_paper']).optional(),
});

// DEPRECATED fallback list — kept for UI loading state only. Source of truth
// is the status_lookups table since 2026-05-30; prefer
// useStatusLookup('no_show_reason') in frontend code.
export const NO_SHOW_REASONS = [
  'lost_contact',
  'personal_reasons',
  'unsuitable_conditions',
  'client_no_longer_needs',
  'blacklist',
  'legalization_rejected',
  'legalization_problem',
  'other',
] as const;
export type NoShowReason = (typeof NO_SHOW_REASONS)[number];
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;

// Consent fields are create-only — a consent is a point-in-time act, not an
// editable attribute. Omit them from the update surface so an edit can never
// silently fabricate (or revoke) a consent row.
export const updateCandidateSchema = createCandidateSchema
  .omit({ emailConsentAccepted: true, smsConsentAccepted: true, consentBasis: true })
  .partial();
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;

export const candidateSchema = createCandidateSchema.extend({
  id: idSchema,
  status: candidateStatusSchema,
  kind: candidateKindSchema,
  // Read responses can still return null here — anonymized rows and legacy
  // rows have no recruiter. Create requires it (F3), but the response shape
  // must accept null to avoid breaking lists and detail GETs.
  recruiterId: idSchema.nullable(),
  documentsSubmittedAt: z.string().datetime().nullable().optional(),
  arrivedAt: z.string().datetime().nullable().optional(),
  anonymizedAt: z.string().datetime().nullable(),
  processingRestricted: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // consentId links to the GDPR row — kept in the response even though the
  // sister fields (externalId / cvUrl / photoUrl) were dropped 2026-06-10
  // because consent has compliance value.
  consentId: idSchema.nullable().optional(),
  // Set only on list responses — true when this candidate matches another
  // (non-anonymized) candidate by email, phone, or name (case-insensitive).
  hasDuplicate: z.boolean().optional(),
  // Enriched fields, set only by GET /candidates/:id (single-record fetch).
  // Lists keep these undefined to avoid N+1 joins on large queries.
  recruiterFirstName: z.string().nullable().optional(),
  recruiterLastName: z.string().nullable().optional(),
  // Joined from users.is_freelancer for the assigned recruiter. Drives the
  // "Фрілансер / Наш" badge in the candidates UI (replaces the legacy
  // freelancers-table column rendering). Null when no recruiter assigned.
  recruiterIsFreelancer: z.boolean().nullable().optional(),
  coordinatorFirstName: z.string().nullable().optional(),
  coordinatorLastName: z.string().nullable().optional(),
  freelancerFirstName: z.string().nullable().optional(),
  freelancerLastName: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  // Project start_date denormalized onto each candidate row at read time.
  // Single source of truth — when admin edits projects.start_date, every
  // assigned candidate reflects it instantly without per-row updates.
  projectStartDate: z.string().nullable().optional(),
  // 2026-06-01 status-model rework. Populated only on list responses via a
  // scalar subquery in candidates.repo. Detail GETs may omit it.
  commentsCount: z.number().int().nonnegative().optional(),
  lastCommentBody: z.string().nullable().optional(),
  // Active consent flags — computed per row (list) and on the detail GET.
  // True = an active (non-withdrawn) consent of that type exists for this
  // candidate. Drives the RODO / Email / SMS consent badges + filter.
  // rodoConsent = application_form (the obligatory processing basis).
  rodoConsent: z.boolean().optional(),
  emailConsent: z.boolean().optional(),
  smsConsent: z.boolean().optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

// 2026-06-12: lifecycle bucket — derived from `status`, not from the legacy
// `kind` column. `/candidates` lists rows whose status is in the first four
// (new / in_progress / documents_submitted / cancelled); `/clients` lists
// the latter four (employed / re_employed / dismissed / blacklist). Used
// instead of the old `kind` filter so a coordinator can flip a row between
// the two views just by moving its status (no extra column to sync).
export const CANDIDATE_STATUS_BUCKETS = {
  candidate: ['new', 'in_progress', 'documents_submitted', 'cancelled'],
  client: ['employed', 're_employed', 'dismissed', 'blacklist'],
} as const satisfies Record<'candidate' | 'client', readonly CandidateStatus[]>;
export const candidateStatusBucketSchema = z.enum(['candidate', 'client']);
export type CandidateStatusBucket = z.infer<typeof candidateStatusBucketSchema>;

export const listCandidatesQuerySchema = paginationSchema.extend({
  status: candidateStatusSchema.optional(),
  // Filter by kind on /candidates (defaults to 'candidate') or /clients ('client').
  // When omitted: both kinds returned (legacy behavior, used by analytics).
  kind: candidateKindSchema.optional(),
  // 2026-06-12 — status bucket filter (replaces the kind-driven split).
  statusBucket: candidateStatusBucketSchema.optional(),
  recruiterId: idSchema.optional(),
  coordinatorId: idSchema.optional(),
  freelancerId: idSchema.optional(),
  projectId: idSchema.optional(),
  source: candidateSourceSchema.optional(),
  housingType: housingTypeSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  // 2026-06-10 Excel-import filters. `position` + `legalStatus` are exact-code
  // matches (Drizzle eq) since they map to status_lookups codes; the other two
  // are free text matched with ilike '%value%'.
  position: z.string().trim().min(1).max(200).optional(),
  legalStatus: z.string().trim().min(1).max(200).optional(),
  reconciliationPeriod: z.string().trim().min(1).max(200).optional(),
  // 2026-06-10 Block 7 filters — exact-code matches (lookup-backed).
  workOutcome: z.string().trim().min(1).max(50).optional(),
  payoutStatus: z.string().trim().min(1).max(50).optional(),
  paymentStatus: z.string().trim().min(1).max(50).optional(),
  retention: z.string().trim().min(1).max(50).optional(),
  // 2026-06-10 — Failed Candidates report keys on workEndReason now that the
  // dedicated no_show_reason column was dropped. Same `dismissal_reason`
  // lookup pool drives both this filter and the column on the candidate row.
  workEndReason: z.string().trim().min(1).max(100).optional(),
  includeAnonymized: z.coerce.boolean().default(false),
  hasEmail: z.coerce.boolean().optional(),
  hasPhone: z.coerce.boolean().optional(),
  duplicatesOnly: z.coerce.boolean().optional(),
  // 2026-07-14 — filter by active consent status.
  //  'rodo' → has active application_form (RODO) consent;
  //  'email' → has active email_marketing; 'sms' → has active sms_marketing;
  //  'any' → has any marketing consent; 'none' → has no marketing consent.
  consentStatus: z.enum(['rodo', 'email', 'sms', 'any', 'none']).optional(),
  ...dateRangeFilterShape,
});
export type ListCandidatesQuery = z.infer<typeof listCandidatesQuerySchema>;

export const listCandidatesResponseSchema = z.object({
  items: z.array(candidateSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListCandidatesResponse = z.infer<typeof listCandidatesResponseSchema>;

export const duplicateMatchSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string().nullable(),
  matchedBy: z.array(z.enum(['email', 'phone', 'name'])),
});
export type DuplicateMatch = z.infer<typeof duplicateMatchSchema>;

// Public submission — single endpoint for the agency website contact form + Make.com
// (FB Lead Ads). Mounted at /public/candidates AND /public/leads (legacy alias
// kept so the existing PHP form + Make.com webhook keep working). Either email
// OR phone must be provided. `message` is stored verbatim into candidates.notes.
//
// 2026-06-12 — new per-recruiter form fields:
//   * birthDate / nationality / messenger / experience — already exist on
//     candidates table; the public submission can now populate them.
//   * recruiterSlug — when present, server resolves it to a recruiter and
//     auto-assigns the candidate so it shows up only in that recruiter's view.
//     Unknown / missing slug → candidate lands unassigned (admin-only view).
//   * consentAccepted — RODO art. 7 ust. 1 evidence. Required on the new
//     /apply/:slug form (legacy PHP / Make.com payloads omit it for back-compat;
//     the new form passes consentAccepted to trigger creation of a `consents`
//     row that gets linked to the candidate via candidate.consentId).
export const submitPublicCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: emailSchema.nullish(),
    phone: phoneSchema.nullish(),
    message: optionalTrimmedString(5000),
    jobTitle: optionalTrimmedString(200),
    jobId: z.coerce.number().int().positive().nullish(),
    source: candidateSourceSchema.optional().default('website'),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date').nullish(),
    nationality: optionalTrimmedString(100),
    messenger: optionalTrimmedString(200),
    experience: optionalTrimmedString(5000),
    recruiterSlug: z.string().trim().min(1).max(100).nullish(),
    consentAccepted: z.boolean().optional(),
    // Optional, independent from consentAccepted. When true (and email is
    // present — consents are keyed on candidateEmail), a separate
    // `sms_marketing` consent row is created. Bulk SMS sends only to
    // candidates holding an active row of this type.
    smsConsentAccepted: z.boolean().optional(),
    // Optional email-marketing opt-in (mirror of smsConsentAccepted). When true
    // and an email is present, an `email_marketing` consent row is created.
    // Bulk EMAIL sends only to candidates holding an active row of this type.
    emailConsentAccepted: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'email_or_phone_required',
    path: ['email'],
  });
export type SubmitPublicCandidateInput = z.infer<typeof submitPublicCandidateSchema>;

// Returned by GET /public/recruiters/:slug — minimum data the public form
// needs to greet the candidate by the recruiter's name. No email, no role.
export const publicRecruiterInfoSchema = z.object({
  slug: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});
export type PublicRecruiterInfo = z.infer<typeof publicRecruiterInfoSchema>;
