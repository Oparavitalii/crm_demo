import { z } from 'zod';
import { idSchema } from './common';
import { candidateStatusSchema, candidateSourceSchema } from './candidate';

export const bulkSendInputSchema = z.object({
  templateId: idSchema,
  // 2026-06-12: leads entity retired — candidate is the only valid target.
  // Kept as a literal enum (rather than removed) for forward-compat if other
  // entity types ever land. The frontend doesn't need to set this field.
  entityType: z.enum(['candidate']).optional().default('candidate'),
  filters: z
    .object({
      status: candidateStatusSchema.optional(),
      source: candidateSourceSchema.optional(),
      recruiterId: idSchema.optional(),
    })
    .optional()
    .default({}),
  // Explicit checkbox-selection from the list. When non-empty, overrides
  // filter-based audience selection — sends ONLY to these IDs.
  recipientIds: z.array(idSchema).max(100).optional(),
  // SMS only, admin only. When true, the send is NOT filtered by an active
  // sms_marketing consent — it reaches candidates who signed consent offline
  // (paper form) but have no digital record. A compliance-sensitive override:
  // the service audit-logs it (includeWithoutConsent + sentWithoutConsent) and
  // never fabricates consent rows. Optional; omitted/undefined = consent-gated
  // (the service treats only an explicit `true` as the override).
  includeWithoutConsent: z.boolean().optional(),
  dryRun: z.boolean().default(false),
});
export type BulkSendInput = z.infer<typeof bulkSendInputSchema>;

export const bulkSendResponseSchema = z.object({
  recipientsTotal: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  // How many of the recipients had NO active sms_marketing consent — non-zero
  // only on an admin consent-override SMS send. Surfaced so the UI + audit can
  // show the operator exactly how many offline-consent recipients were reached.
  sentWithoutConsent: z.number().int().nonnegative().default(0),
  dryRun: z.boolean(),
  messageIds: z.array(idSchema),
});
export type BulkSendResponse = z.infer<typeof bulkSendResponseSchema>;

export const previewRecipientsResponseSchema = z.object({
  // Recipients that WILL receive under the default (consent-gated) send.
  // Email: everyone matched. SMS: those with an active sms_marketing consent.
  count: z.number().int().nonnegative(),
  // SMS only: additional candidates who have a phone but NO active consent.
  // Drives the "N didn't accept SMS — send to them too?" warning + the
  // "send to all" override button. Always 0 for email.
  withoutConsent: z.number().int().nonnegative().default(0),
});
export type PreviewRecipientsResponse = z.infer<typeof previewRecipientsResponseSchema>;

// Re-consent ("consent campaign") send. Same audience-selection shape as a
// bulk email, but the template MUST contain the {{consentConfirmUrl}}
// placeholder — the service mints a per-candidate opt-in token, substitutes the
// link, and sends. Candidates who ALREADY hold an active email_marketing
// consent are skipped (no point re-asking). This is how a lawful re-permission
// campaign is run against candidates who had contact with us but never opted in.
export const consentCampaignSchema = z.object({
  templateId: idSchema,
  filters: z
    .object({
      status: candidateStatusSchema.optional(),
      source: candidateSourceSchema.optional(),
      recruiterId: idSchema.optional(),
    })
    .optional()
    .default({}),
  recipientIds: z.array(idSchema).max(100).optional(),
  dryRun: z.boolean().default(false),
});
export type ConsentCampaignInput = z.infer<typeof consentCampaignSchema>;

export const consentCampaignResponseSchema = z.object({
  recipientsTotal: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  // Recipients skipped because they already hold an active email_marketing
  // consent — surfaced so the operator sees the campaign didn't re-spam them.
  skippedAlreadyConsented: z.number().int().nonnegative().default(0),
  dryRun: z.boolean(),
  messageIds: z.array(idSchema),
});
export type ConsentCampaignResponse = z.infer<typeof consentCampaignResponseSchema>;

export const communicationsHistoryItemSchema = z.object({
  id: idSchema,
  candidateId: idSchema.nullable(),
  candidateName: z.string().nullable(),
  templateId: idSchema.nullable(),
  templateName: z.string().nullable(),
  subject: z.string().nullable(),
  // Channel of the message ('email' | 'sms') and who sent it (null =
  // system-triggered: onboarding / public-form).
  channel: z.string(),
  senderName: z.string().nullable(),
  status: z.string(),
  sentAt: z.string().datetime().nullable(),
  // Populated from the Resend webhook (email.delivered / email.opened). Null
  // until the corresponding signed event has been received by /webhooks/resend.
  deliveredAt: z.string().datetime().nullable(),
  openedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CommunicationsHistoryItem = z.infer<typeof communicationsHistoryItemSchema>;

export const communicationsHistoryResponseSchema = z.object({
  items: z.array(communicationsHistoryItemSchema),
  total: z.number().int().nonnegative(),
});
export type CommunicationsHistoryResponse = z.infer<typeof communicationsHistoryResponseSchema>;
