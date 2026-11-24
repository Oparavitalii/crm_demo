import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { candidates } from './candidates';

export const freelancers = pgTable(
  'freelancers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    activeIdx: index('freelancers_is_active_idx').on(t.isActive),
    emailIdx: index('freelancers_email_idx').on(t.email),
  }),
);

export const freelancersRelations = relations(freelancers, ({ many }) => ({
  candidatesRecruited: many(candidates),
}));

export type Freelancer = typeof freelancers.$inferSelect;
export type NewFreelancer = typeof freelancers.$inferInsert;
