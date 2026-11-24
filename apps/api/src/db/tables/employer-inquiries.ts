import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { employerInquiryStatus, employerInquirySource } from '../enums';
import { users } from './users';

export const employerInquiries = pgTable(
  'employer_inquiries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyName: text('company_name').notNull(),
    contactPerson: text('contact_person').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    message: text('message').notNull(),
    privacyAccepted: boolean('privacy_accepted').notNull().default(false),
    status: employerInquiryStatus('status').notNull().default('new'),
    source: employerInquirySource('source').notNull().default('web'),
    assignedToId: uuid('assigned_to_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    internalNotes: text('internal_notes'),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    statusIdx: index('employer_inquiries_status_idx').on(t.status),
    emailIdx: index('employer_inquiries_email_idx').on(t.email),
    assignedToIdx: index('employer_inquiries_assigned_to_idx').on(t.assignedToId),
    createdAtIdx: index('employer_inquiries_created_at_idx').on(t.createdAt),
  }),
);

export const employerInquiriesRelations = relations(employerInquiries, ({ one }) => ({
  assignedTo: one(users, {
    fields: [employerInquiries.assignedToId],
    references: [users.id],
  }),
}));

export type EmployerInquiry = typeof employerInquiries.$inferSelect;
export type NewEmployerInquiry = typeof employerInquiries.$inferInsert;
