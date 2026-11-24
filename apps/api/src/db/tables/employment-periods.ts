import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { candidates } from './candidates';
import { users } from './users';
import { projects } from './projects';

// 2026-06-01 status-model rework. One row per employment episode of a candidate
// (now kind='client'). First hire creates row N=1. Dismissal closes the row
// (dismissedAt set). Rehire creates row N=2. Retention analytics iterates over
// this table grouping by candidate_id / project_id.
//
// The candidate row keeps denormalized snapshots of the latest episode in
// housing_type / coordinator_id / project_id / employed_at / dismissed_at —
// list pages render from those without joining this table.
export const employmentPeriods = pgTable(
  'employment_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    employedAt: timestamp('employed_at', { withTimezone: true }).notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedReason: text('dismissed_reason'),
    housingType: text('housing_type'),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    coordinatorId: uuid('coordinator_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    candidateIdx: index('employment_periods_candidate_id_idx').on(t.candidateId),
    employedAtIdx: index('employment_periods_employed_at_idx').on(t.employedAt),
    // At most one open episode per candidate at any time.
    openPerCandidateIdx: uniqueIndex('employment_periods_open_per_candidate_idx')
      .on(t.candidateId)
      .where(sql`${t.dismissedAt} IS NULL`),
  }),
);

export const employmentPeriodsRelations = relations(
  employmentPeriods,
  ({ one }) => ({
    candidate: one(candidates, {
      fields: [employmentPeriods.candidateId],
      references: [candidates.id],
    }),
    project: one(projects, {
      fields: [employmentPeriods.projectId],
      references: [projects.id],
    }),
    coordinator: one(users, {
      fields: [employmentPeriods.coordinatorId],
      references: [users.id],
    }),
    creator: one(users, {
      fields: [employmentPeriods.createdBy],
      references: [users.id],
    }),
  }),
);

export type EmploymentPeriod = typeof employmentPeriods.$inferSelect;
export type NewEmploymentPeriod = typeof employmentPeriods.$inferInsert;
