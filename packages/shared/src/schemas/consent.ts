import { z } from 'zod';
import { idSchema, paginationSchema } from './common';

// Public withdraw-consent payload. The token is a UUID generated when the
// consent was recorded — mailed to the candidate in the unsubscribe footer.
// 122 bits of entropy: brute-forcing is infeasible without also bypassing
// the IP rate limiter on /public/consents/withdraw.
export const withdrawConsentSchema = z.object({
  token: z.string().uuid(),
});
export type WithdrawConsentInput = z.infer<typeof withdrawConsentSchema>;

export const withdrawConsentResponseSchema = z.object({
  withdrawn: z.boolean(),
  anonymized: z.boolean(),
});
export type WithdrawConsentResponse = z.infer<typeof withdrawConsentResponseSchema>;

// ---------------------------------------------------------------------------
// Consent taxonomy — single source of truth for the string literals written to
// consents.consent_type / .version / .source. Backend and frontend both import
// these instead of duplicating the raw strings.
// ---------------------------------------------------------------------------

// What was consented to.
export const CONSENT_TYPES = {
  applicationForm: 'application_form', // RODO processing basis (apply form)
  emailMarketing: 'email_marketing', // marketing/outreach by email
  smsMarketing: 'sms_marketing', // marketing/outreach by SMS
} as const;
export type ConsentType = (typeof CONSENT_TYPES)[keyof typeof CONSENT_TYPES];

// Version identifier of the clause text the person agreed to. Bump on any
// material change to the wording so old and new consents stay distinguishable.
export const CONSENT_VERSIONS = {
  applicationForm: 'polityka-prywatnosci-2026',
  emailMarketing: 'email-marketing-2026-v1',
  smsMarketing: 'sms-marketing-2026-v1',
} as const;

// How/where the consent was obtained (consents.source). RODO accountability.
export const CONSENT_SOURCES = {
  applyForm: 'apply_form', // public /apply/:slug checkbox
  reConsentEmail: 're_consent_email', // clicked the confirm link in a campaign
  manualVerbal: 'manual_verbal', // staff attests: given verbally (by phone)
  manualPaper: 'manual_paper', // staff attests: signed on paper
  intake: 'intake', // RODO basis auto-recorded when staff creates a candidate
  backfill: 'backfill', // RODO basis backfilled for the pre-existing base
  adminOverride: 'admin_override', // admin set the consent directly (audited)
  import: 'import', // migrated from a previous system
  smsStopInbound: 'sms_stop_inbound', // withdrawn marker from inbound STOP
} as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[keyof typeof CONSENT_SOURCES];

// Marketing channels a candidate can opt into. `application_form` is a
// processing basis, not a channel, so it is deliberately absent here.
export const consentChannelSchema = z.enum(['email', 'sms']);
export type ConsentChannel = z.infer<typeof consentChannelSchema>;

// ---------------------------------------------------------------------------
// Re-consent (double opt-in) via the confirm link.
// ---------------------------------------------------------------------------

// GET /public/consents/optin/:token — the confirm page fetches this to know
// which channel checkboxes to render (a candidate with only a phone can't opt
// into email, and vice-versa). Returns 400 INVALID_TOKEN for a missing/expired/
// consumed token, same neutral signal as the withdraw flow.
export const optinTokenInfoResponseSchema = z.object({
  hasEmail: z.boolean(),
  hasPhone: z.boolean(),
  // Current active state — the manage page prefills its checkboxes with these
  // so the candidate sees what they're currently signed up for.
  emailConsent: z.boolean(),
  smsConsent: z.boolean(),
});
export type OptinTokenInfoResponse = z.infer<typeof optinTokenInfoResponseSchema>;

// POST /public/consents/confirm — the candidate SETS their preferences. `channels`
// is the desired ON set: an applicable channel present → consent ensured active,
// absent → withdrawn. An empty array is valid (turn everything off). The token is
// NOT consumed — the manage link keeps working until it expires, so they can
// change their mind again from any email we've sent.
export const confirmConsentSchema = z.object({
  token: z.string().uuid(),
  channels: z.array(consentChannelSchema),
});
export type ConfirmConsentInput = z.infer<typeof confirmConsentSchema>;

export const confirmConsentResponseSchema = z.object({
  confirmed: z.boolean(),
  // Channels now holding an active consent for this candidate — includes ones
  // that were already active before this click (idempotent re-submit).
  channels: z.array(consentChannelSchema),
});
export type ConfirmConsentResponse = z.infer<typeof confirmConsentResponseSchema>;

// ---------------------------------------------------------------------------
// Staff-side consent actions on an EXISTING candidate (candidate detail card).
// ---------------------------------------------------------------------------

// POST /candidates/:id/send-consent-request — the system mints a token and emails
// the candidate a confirm/manage link. The operator NEVER sees the link, so they
// cannot self-approve. No body. Requires the candidate to have an email.
export const sendConsentRequestResponseSchema = z.object({
  sent: z.boolean(),
});
export type SendConsentRequestResponse = z.infer<typeof sendConsentRequestResponseSchema>;

// POST /candidates/consent-requests — bulk version: pick many candidates in the
// list, email each a confirm/manage link in one shot. Candidates without an
// email are skipped (reported), best-effort per recipient.
export const bulkConsentRequestSchema = z.object({
  candidateIds: z.array(idSchema).min(1).max(100),
});
export type BulkConsentRequestInput = z.infer<typeof bulkConsentRequestSchema>;

export const bulkConsentRequestResponseSchema = z.object({
  sent: z.number().int().nonnegative(),
  skippedNoEmail: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type BulkConsentRequestResponse = z.infer<typeof bulkConsentRequestResponseSchema>;

// POST /candidates/:id/admin-consent — ADMIN-ONLY override. An admin may set the
// email/sms marketing consent directly (on OR off). Every change is audit-logged
// (`admin_set_consent`). This is the only non-mail path to change consent, kept
// for data fixes / honoring written requests; recruiters/coordinators cannot.
export const adminSetConsentSchema = z.object({
  email: z.boolean(),
  sms: z.boolean(),
});
export type AdminSetConsentInput = z.infer<typeof adminSetConsentSchema>;

export const adminSetConsentResponseSchema = z.object({
  emailConsent: z.boolean(),
  smsConsent: z.boolean(),
});
export type AdminSetConsentResponse = z.infer<typeof adminSetConsentResponseSchema>;

// ---------------------------------------------------------------------------
// Consent history — the "Історія згод" tab in the audit log (admin-only). One
// row per consent record: acceptedAt is the grant, withdrawnAt the revoke.
// ---------------------------------------------------------------------------

export const consentHistoryConsentTypeSchema = z.enum([
  'application_form',
  'email_marketing',
  'sms_marketing',
]);

export const listConsentHistoryQuerySchema = paginationSchema.extend({
  consentType: consentHistoryConsentTypeSchema.optional(),
  status: z.enum(['active', 'withdrawn']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListConsentHistoryQuery = z.infer<typeof listConsentHistoryQuerySchema>;

export const consentHistoryItemSchema = z.object({
  id: idSchema,
  candidateName: z.string().nullable(),
  candidateEmail: z.string().nullable(),
  candidatePhone: z.string().nullable(),
  consentType: z.string(),
  source: z.string().nullable(),
  acceptedAt: z.string().datetime(),
  withdrawnAt: z.string().datetime().nullable(),
  ip: z.string().nullable(),
});
export type ConsentHistoryItem = z.infer<typeof consentHistoryItemSchema>;

export const listConsentHistoryResponseSchema = z.object({
  items: z.array(consentHistoryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListConsentHistoryResponse = z.infer<typeof listConsentHistoryResponseSchema>;
