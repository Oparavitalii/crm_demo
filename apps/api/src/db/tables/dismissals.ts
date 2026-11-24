import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { candidates } from './candidates';

export const dismissals = pgTable(
  'dismissals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'restrict' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    // Canonical enum value (one of DISMISSAL_REASONS in shared) — used by the
    // retention report to group / count dismissals. The free-text `reason`
    // field above is kept for human-typed details and back-compat.
    reasonCode: text('reason_code'),
    recordedById: uuid('recorded_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    candidateIdx: index('dismissals_candidate_id_idx').on(t.candidateId),
    dismissedAtIdx: index('dismissals_dismissed_at_idx').on(t.dismissedAt),
    recordedByIdx: index('dismissals_recorded_by_id_idx').on(t.recordedById),
  }),
);

export const dismissalsRelations = relations(dismissals, ({ one }) => ({
  candidate: one(candidates, {
    fields: [dismissals.candidateId],
    references: [candidates.id],
  }),
  recordedBy: one(users, {
    fields: [dismissals.recordedById],
    references: [users.id],
  }),
}));

export type Dismissal = typeof dismissals.$inferSelect;
export type NewDismissal = typeof dismissals.$inferInsert;
