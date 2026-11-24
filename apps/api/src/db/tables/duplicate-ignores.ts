import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// Records explicit "these two records are NOT duplicates" decisions made by a user.
// `entityType` distinguishes candidates from leads (no foreign key — the rows may
// be deleted later and we keep the decision as a soft signal for `findDuplicateIds`).
//
// idA/idB are stored sorted (idA < idB) so the pair is unique regardless of which
// row the user clicked first. Composite primary key enforces uniqueness.
export const duplicateIgnores = pgTable(
  'duplicate_ignores',
  {
    entityType: text('entity_type').notNull(),
    idA: uuid('id_a').notNull(),
    idB: uuid('id_b').notNull(),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.entityType, t.idA, t.idB] }),
    typeIdx: index('duplicate_ignores_type_idx').on(t.entityType),
  }),
);

export type DuplicateIgnore = typeof duplicateIgnores.$inferSelect;
export type NewDuplicateIgnore = typeof duplicateIgnores.$inferInsert;
