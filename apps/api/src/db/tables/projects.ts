import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { candidates } from './candidates';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    // Headcount the client requires for this project (manually entered, e.g.
    // Adventure Works Opole needs 20). Used together with start_date and the live count of
    // assigned candidates to drive the staffing-progress columns on /projects.
    headcountNeeded: integer('headcount_needed').notNull().default(0),
    // Project start date on the client site (calendar day, not timestamp —
    // projects start on a specific morning, not a moment).
    startDate: date('start_date'),
    // Staffing baseline timestamp. `foundCount` only counts candidates whose
    // `updated_at` is >= this value, so when a recruiter resets a project's
    // headcount/startDate (e.g. Adventure Works Opole wants 20 more bodies starting next
    // Monday), the progress bar restarts from 0 instead of carrying over the
    // historical placements. Bumped by the update endpoint when
    // `headcountNeeded` or `startDate` changes.
    headcountResetAt: timestamp('headcount_reset_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    nameIdx: uniqueIndex('projects_name_idx').on(t.name),
    isActiveIdx: index('projects_is_active_idx').on(t.isActive),
  }),
);

export const projectsRelations = relations(projects, ({ many }) => ({
  candidates: many(candidates),
}));

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
