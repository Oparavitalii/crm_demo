import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { documents } from './documents';
import { users } from './users';

export const documentAcceptances = pgTable(
  'document_acceptances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    uniqDocVerUser: uniqueIndex('document_acceptances_doc_ver_user_uniq').on(
      t.documentId,
      t.version,
      t.userId,
    ),
    userIdx: index('document_acceptances_user_idx').on(t.userId),
    docVersionIdx: index('document_acceptances_doc_version_idx').on(t.documentId, t.version),
  }),
);

export const documentAcceptancesRelations = relations(documentAcceptances, ({ one }) => ({
  document: one(documents, {
    fields: [documentAcceptances.documentId],
    references: [documents.id],
  }),
  user: one(users, {
    fields: [documentAcceptances.userId],
    references: [users.id],
  }),
}));

export type DocumentAcceptance = typeof documentAcceptances.$inferSelect;
export type NewDocumentAcceptance = typeof documentAcceptances.$inferInsert;
