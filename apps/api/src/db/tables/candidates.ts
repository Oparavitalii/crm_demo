import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { candidateStatus, candidateKind } from '../enums';
import { users } from './users';
import { freelancers } from './freelancers';
import { consents } from './consents';
import { dismissals } from './dismissals';
import { messages } from './messages';
import { projects } from './projects';

export const candidates = pgTable(
  'candidates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // 2026-06-12: previously split into first_name + last_name. Every form/UI
    // label already read "Imię i nazwisko" / "Ім'я та прізвище" — one field.
    // Backfill in migration 0045 concatenates the old columns before drop.
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    birthDate: date('birth_date'),
    nationality: text('nationality'),
    workStartDate: timestamp('work_start_date', { withTimezone: true }),
    workEndDate: timestamp('work_end_date', { withTimezone: true }),
    workEndReason: text('work_end_reason'),
    // Free-text addendum used verbatim in the retention report.
    reasonNote: text('reason_note'),
    status: candidateStatus('status').notNull().default('new'),
    // FAZA 19: flips to 'client' on auto-promotion (status -> employed).
    kind: candidateKind('kind').notNull().default('candidate'),
    // FAZA 19.5 denormalized housing snapshot — captures whether the candidate
    // lived in OUR housing or OWN housing while transitioning through pipeline.
    housingType: text('housing_type'),
    // FAZA 26 lifecycle checklist — `documents_submitted_at` is stamped on
    // first transition to status='documents_submitted'. `arrived_at` is set
    // from the form (Дата приїзду) — represents physical arrival to housing.
    documentsSubmittedAt: timestamp('documents_submitted_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    recruiterId: uuid('recruiter_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Coordinator assigned at promotion to client (status -> employed).
    // Recruiter picks who manages the client going forward.
    coordinatorId: uuid('coordinator_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    freelancerId: uuid('freelancer_id').references(() => freelancers.id, {
      onDelete: 'set null',
    }),
    // Client project (Northwind Logistics Wrocław, Contoso Foods Poznań, ...). Nullable: not every candidate
    // is tied to a project yet (e.g. fresh public-form submissions).
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    // Free-form text — admins can extend the source list inline. Common values:
    // facebook / instagram / website / work_ua / flagma / referral / unknown.
    source: text('source'),
    // 2026-06-10 Excel-import prep: 4 new free-text fields from the client's
    // workbook. `position` and `legalStatus` resolve to a code from the
    // `status_lookups` table (types 'position' / 'legal_status') — any user can
    // extend the list inline. The other two are pure free text.
    position: text('position'),
    legalStatus: text('legal_status'),
    reconciliationPeriod: text('reconciliation_period'),
    // 2026-06-10 Block 7 (Звірка / Виплати) — three soft-enum text columns
    // backed by `status_lookups` (types: work_outcome / payout_status /
    // payment_status). Set at month-end reconciliation. Null = "not decided
    // yet" for that month. Same pattern as `position` / `legal_status`.
    workOutcome: text('work_outcome'),
    payoutStatus: text('payout_status'),
    paymentStatus: text('payment_status'),
    // 2026-06-10 Block 7 follow-up — «Утримання кандидата». Categorical bucket
    // (under_month / month_plus / … / off_target) picked by the coordinator
    // at month-end reconciliation. Backed by status_lookups type='retention'.
    retention: text('retention'),
    // 2026-06-12 — free-text messenger contact (TG/WA/Viber handle or phone).
    // Single column on purpose: recruiters type whatever the candidate gave
    // them ("TG: @ivan", "WA: +48123…") instead of picking a type from a list.
    messenger: text('messenger'),
    // 2026-06-12 — free-text work history ("Досвід роботи"). Rendered as an
    // autosizing <Textarea>. Cap is enforced at the Zod layer (~5000 chars).
    experience: text('experience'),
    notes: text('notes'),
    consentId: uuid('consent_id').references(() => consents.id, {
      onDelete: 'set null',
    }),
    processingRestricted: boolean('processing_restricted')
      .notNull()
      .default(false),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    emailIdx: index('candidates_email_idx').on(t.email),
    phoneIdx: index('candidates_phone_idx').on(t.phone),
    statusIdx: index('candidates_status_idx').on(t.status),
    kindIdx: index('candidates_kind_idx').on(t.kind),
    recruiterIdx: index('candidates_recruiter_id_idx').on(t.recruiterId),
    coordinatorIdx: index('candidates_coordinator_id_idx').on(t.coordinatorId),
    freelancerIdx: index('candidates_freelancer_id_idx').on(t.freelancerId),
    projectIdx: index('candidates_project_id_idx').on(t.projectId),
    consentIdx: index('candidates_consent_id_idx').on(t.consentId),
    anonymizedAtIdx: index('candidates_anonymized_at_idx').on(t.anonymizedAt),
  }),
);

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  recruiter: one(users, {
    fields: [candidates.recruiterId],
    references: [users.id],
  }),
  coordinator: one(users, {
    fields: [candidates.coordinatorId],
    references: [users.id],
  }),
  freelancer: one(freelancers, {
    fields: [candidates.freelancerId],
    references: [freelancers.id],
  }),
  project: one(projects, {
    fields: [candidates.projectId],
    references: [projects.id],
  }),
  consent: one(consents, {
    fields: [candidates.consentId],
    references: [consents.id],
  }),
  dismissals: many(dismissals),
  messages: many(messages),
}));

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
