import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { candidates } from './candidates';

// Re-consent (double opt-in) tokens. A "consent campaign" email carries a
// per-candidate link `${APP_URL}/consent/confirm/${token}`. When the candidate
// clicks it and confirms, the public confirm endpoint turns the token into one
// or more active rows in `consents` (email_marketing / sms_marketing) with
// `source='re_consent_email'`. The click itself — captured with ip + userAgent
// + timestamp on the resulting consent row — is the RODO art. 7 evidence.
//
// Contact identifiers are SNAPSHOT at send time (not read live off the
// candidate) so a later email/phone edit can't retarget an outstanding token.
export const consentOptinTokens = pgTable(
  'consent_optin_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // The secret mailed in the link. UUIDv4 = 122 bits of entropy; unique idx.
    token: uuid('token').defaultRandom().notNull(),
    // Cascade: a token is meaningless once its candidate is deleted.
    candidateId: uuid('candidate_id')
      .references(() => candidates.id, { onDelete: 'cascade' })
      .notNull(),
    candidateEmail: text('candidate_email'),
    candidatePhone: text('candidate_phone'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // One-shot lifetime. Confirm endpoint rejects tokens past this instant.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Set the moment the token is redeemed — a redeemed token can't be reused.
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => ({
    tokenIdx: uniqueIndex('consent_optin_tokens_token_idx').on(t.token),
    candidateIdx: index('consent_optin_tokens_candidate_id_idx').on(t.candidateId),
    // At least one identifier or the token can grant no consent.
    emailOrPhone: check(
      'consent_optin_tokens_email_or_phone',
      sql`${t.candidateEmail} IS NOT NULL OR ${t.candidatePhone} IS NOT NULL`,
    ),
  }),
);

export type ConsentOptinToken = typeof consentOptinTokens.$inferSelect;
export type NewConsentOptinToken = typeof consentOptinTokens.$inferInsert;
