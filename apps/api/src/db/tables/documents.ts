import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { documentCategory, userRole } from '../enums';
import { users } from './users';
import { documentAcceptances } from './document-acceptances';

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    category: documentCategory('category').notNull(),
    contentMd: text('content_md'),
    fileKey: text('file_key'),
    fileMime: text('file_mime'),
    fileSizeBytes: integer('file_size_bytes'),
    version: integer('version').notNull().default(1),
    requiresAcceptance: boolean('requires_acceptance').notNull().default(false),
    visibleToRoles: userRole('visible_to_roles')
      .array()
      .notNull()
      .default(sql`ARRAY['admin','recruiter','coordinator','readonly']::user_role[]`)
      .$type<ReadonlyArray<'admin' | 'recruiter' | 'coordinator' | 'readonly'>>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    slugIdx: index('documents_slug_idx').on(t.slug),
    categoryIdx: index('documents_category_idx').on(t.category),
    requiresAcceptanceIdx: index('documents_requires_acceptance_idx').on(t.requiresAcceptance),
    contentXor: check(
      'documents_content_xor',
      sql`(${t.contentMd} IS NOT NULL AND ${t.fileKey} IS NULL) OR (${t.contentMd} IS NULL AND ${t.fileKey} IS NOT NULL)`,
    ),
  }),
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export const documentsRelations = relations(documents, ({ many, one }) => ({
  acceptances: many(documentAcceptances),
  createdByUser: one(users, {
    fields: [documents.createdBy],
    references: [users.id],
  }),
}));
