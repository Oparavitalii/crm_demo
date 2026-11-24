import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  messageChannel,
  messageDirection,
  messageStatus,
} from '../enums';
import { users } from './users';
import { candidates } from './candidates';

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    channel: messageChannel('channel').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    variables: text('variables').array().notNull().default(sql`'{}'::text[]`),
    // When true, this (email) template is auto-sent as the welcome/onboarding
    // message to every newly created candidate. At most one is honored (newest
    // wins). If the body contains {{consentConfirmUrl}}, the auto-send also
    // mints an opt-in token so the welcome doubles as a consent ask.
    autoSendOnCreate: boolean('auto_send_on_create').notNull().default(false),
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
    channelIdx: index('message_templates_channel_idx').on(t.channel),
    createdByIdx: index('message_templates_created_by_id_idx').on(t.createdById),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    candidateId: uuid('candidate_id').references(() => candidates.id, {
      onDelete: 'set null',
    }),
    channel: messageChannel('channel').notNull(),
    direction: messageDirection('direction').notNull().default('outbound'),
    templateId: uuid('template_id').references(() => messageTemplates.id, {
      onDelete: 'set null',
    }),
    subject: text('subject'),
    body: text('body').notNull(),
    status: messageStatus('status').notNull().default('queued'),
    externalId: text('external_id'),
    sentById: uuid('sent_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    candidateIdx: index('messages_candidate_id_idx').on(t.candidateId),
    statusIdx: index('messages_status_idx').on(t.status),
    channelIdx: index('messages_channel_idx').on(t.channel),
    externalIdIdx: index('messages_external_id_idx').on(t.externalId),
    templateIdx: index('messages_template_id_idx').on(t.templateId),
    sentByIdx: index('messages_sent_by_id_idx').on(t.sentById),
  }),
);

export const messageTemplatesRelations = relations(
  messageTemplates,
  ({ one, many }) => ({
    createdBy: one(users, {
      fields: [messageTemplates.createdById],
      references: [users.id],
    }),
    messages: many(messages),
  }),
);

export const messagesRelations = relations(messages, ({ one }) => ({
  candidate: one(candidates, {
    fields: [messages.candidateId],
    references: [candidates.id],
  }),
  template: one(messageTemplates, {
    fields: [messages.templateId],
    references: [messageTemplates.id],
  }),
  sentBy: one(users, {
    fields: [messages.sentById],
    references: [users.id],
  }),
}));

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
