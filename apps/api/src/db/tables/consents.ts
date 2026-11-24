import { relations, sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { candidates } from './candidates';

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // 2026-07-04: email is no longer mandatory. `sms_marketing` consent is
    // keyed on the phone number (the SMS identity), so a phone-only applicant
    // can opt in — previously impossible because consent required an email.
    // `application_form` consent still carries email. A CHECK enforces that at
    // least one identifier is present.
    candidateEmail: text('candidate_email'),
    candidatePhone: text('candidate_phone'),
    consentType: text('consent_type').notNull(),
    version: text('version').notNull(),
    // Provenance of the consent — how/where it was obtained. Nullable because
    // rows created before 2026-07 (and legacy imports) have no recorded source.
    // Values (see CONSENT_SOURCES in @crm/shared): 'apply_form',
    // 're_consent_email', 'manual_verbal', 'manual_paper', 'import',
    // 'sms_stop_inbound'. Used for RODO accountability — we must be able to
    // prove HOW each consent was collected, not just that it exists.
    source: text('source'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    // Unguessable one-shot token used by the public withdraw endpoint. Mailed
    // out in unsubscribe links — the candidate proves identity by holding it,
    // no login required. UUIDv4 = 122 bits of entropy. Indexed unique.
    withdrawalToken: uuid('withdrawal_token').defaultRandom().notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    emailIdx: index('consents_candidate_email_idx').on(t.candidateEmail),
    phoneIdx: index('consents_candidate_phone_idx').on(t.candidatePhone),
    typeIdx: index('consents_consent_type_idx').on(t.consentType),
    withdrawnAtIdx: index('consents_withdrawn_at_idx').on(t.withdrawnAt),
    withdrawalTokenIdx: uniqueIndex('consents_withdrawal_token_idx').on(t.withdrawalToken),
    emailOrPhone: check(
      'consents_email_or_phone',
      sql`${t.candidateEmail} IS NOT NULL OR ${t.candidatePhone} IS NOT NULL`,
    ),
  }),
);

export const consentsRelations = relations(consents, ({ many }) => ({
  candidates: many(candidates),
}));

export type Consent = typeof consents.$inferSelect;
export type NewConsent = typeof consents.$inferInsert;
