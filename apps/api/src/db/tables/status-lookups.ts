import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// Admin-editable lookup table for the 4 dynamic status lists:
//   - 'sources'           — shared between leads.source and candidates.source
//   - 'lead_status'       — leads.status (free-text in DB, no transition logic)
//   - 'dismissal_reason'  — dismissals.reasonCode
//   - 'no_show_reason'    — candidates.noShowReason
//
// Soft-delete only (deletedAt). Existing DB rows referencing a deleted code
// keep their value — frontend falls back to raw code if lookup is missing.
// `isSystem=true` rows are seeded defaults — protected from hard delete.
export const statusLookups = pgTable(
  'status_lookups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: text('type').notNull(),
    code: text('code').notNull(),
    labelPl: text('label_pl').notNull(),
    labelUa: text('label_ua').notNull(),
    // 2026-07-10 — retention channel grouping, only used for type='sources'
    // (social / jobBoards / website / formRecruiter / other). Admin-editable;
    // drives retentionByChannel classification. Null for all other types.
    groupKey: text('group_key'),
    sortOrder: integer('sort_order').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    // Partial unique: (type, code) only enforced for non-deleted rows so a code
    // can be reused after soft-delete.
    activeCodeIdx: uniqueIndex('status_lookups_active_code_idx')
      .on(t.type, t.code)
      .where(sql`${t.deletedAt} IS NULL`),
    typeSortIdx: index('status_lookups_type_sort_idx').on(
      t.type,
      t.sortOrder,
      t.labelPl,
    ),
    deletedIdx: index('status_lookups_deleted_idx')
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL`),
  }),
);

export const statusLookupsRelations = relations(statusLookups, ({ one }) => ({
  createdBy: one(users, {
    fields: [statusLookups.createdById],
    references: [users.id],
  }),
}));

export type StatusLookup = typeof statusLookups.$inferSelect;
export type NewStatusLookup = typeof statusLookups.$inferInsert;
