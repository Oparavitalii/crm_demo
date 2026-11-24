import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { candidates } from './candidates';
import { users } from './users';

// FAZA 27: per-candidate threaded comments. Separate from `candidates.notes`
// (which stays as a single-summary blurb) — this table is append-only-ish
// (recruiters add new entries over time, only author/admin can remove).
export const candidateComments = pgTable(
  'candidate_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    candidateIdx: index('candidate_comments_candidate_id_idx').on(t.candidateId),
    createdAtIdx: index('candidate_comments_created_at_idx').on(t.createdAt),
  }),
);

export const candidateCommentsRelations = relations(
  candidateComments,
  ({ one }) => ({
    candidate: one(candidates, {
      fields: [candidateComments.candidateId],
      references: [candidates.id],
    }),
    author: one(users, {
      fields: [candidateComments.authorId],
      references: [users.id],
    }),
  }),
);

export type CandidateComment = typeof candidateComments.$inferSelect;
export type NewCandidateComment = typeof candidateComments.$inferInsert;
