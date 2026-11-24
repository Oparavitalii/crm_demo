import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { candidates } from './candidates';
import { users } from './users';

// F16: per-candidate tasks / reminders for recruiters and the manager.
// Canonical types: 'contact' | 'email' | 'other' (UI-enforced; column is text
// for forward compatibility — adding a new type doesn't require a migration).
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Optional candidate link. Per-candidate tasks cascade-delete with the
    // candidate (anonymization removes them too). Standalone tasks (created
    // from the Tasks sidebar panel) leave this null.
    candidateId: uuid('candidate_id').references(() => candidates.id, {
      onDelete: 'cascade',
    }),
    // Set null on user deactivation: the task survives so it can be reassigned.
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    // Workflow state. 'new' → 'in_work' → 'completed' OR 'cancelled'.
    // `doneAt` is auto-stamped on transitions to/from 'completed' (service layer)
    // to keep dashboard queries on the existing `done_at` index working.
    status: text('status').notNull().default('new'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    // Stamped when marked done. The dueAt index below is partial on this column.
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    candidateIdx: index('tasks_candidate_id_idx').on(t.candidateId),
    assigneeIdx: index('tasks_assignee_id_idx').on(t.assigneeId),
    // Partial index — only open tasks ordered by dueAt. Most queries are
    // "what's due for me / for this candidate" filtered to doneAt IS NULL.
    dueAtIdx: index('tasks_due_at_idx')
      .on(t.dueAt)
      .where(sql`${t.doneAt} IS NULL`),
  }),
);

export const tasksRelations = relations(tasks, ({ one }) => ({
  candidate: one(candidates, {
    fields: [tasks.candidateId],
    references: [candidates.id],
  }),
  assignee: one(users, {
    fields: [tasks.assigneeId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [tasks.createdById],
    references: [users.id],
  }),
}));

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
