import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  bulkSendInputSchema,
  candidateStatusSchema,
  candidateSourceSchema,
  consentCampaignSchema,
  idSchema,
} from '@crm/shared';
import * as bulkSendService from '../../services/bulk-send.service';
import { sendConsentCampaign } from '../../services/consent-campaign.service';
import { requireAuth, requireRole } from '../../middleware/auth';
import { getClientIp } from '../../middleware/audit';

const previewQuerySchema = z.object({
  status: candidateStatusSchema.optional(),
  source: candidateSourceSchema.optional(),
  recruiterId: idSchema.optional(),
  // Audience depends on the template channel: email → has email; sms → has
  // phone AND an active sms_marketing consent. Defaults to email for
  // backward compat with pre-SMS clients.
  channel: z.enum(['email', 'sms']).optional().default('email'),
  // Comma-separated candidate IDs for the "send to selected" modal preview.
  // A GET query can't cleanly carry an array; we split + drop non-UUIDs below
  // (candidates.id is a uuid column — a malformed value would crash the cast).
  recipientIds: z.string().optional(),
});

export const sendRouter = new Hono()
  .use('*', requireAuth)
  .get(
    '/preview-recipients',
    requireRole(['admin', 'recruiter']),
    zValidator('query', previewQuerySchema),
    async (c) => {
      const { channel, recipientIds: rawIds, ...filters } = c.req.valid('query');
      const recipientIds = rawIds
        ? rawIds.split(',').filter((id) => idSchema.safeParse(id).success)
        : undefined;
      const actor = { id: c.var.userId, role: c.var.userRole };
      const result = await bulkSendService.previewRecipients(
        filters,
        actor,
        channel,
        recipientIds && recipientIds.length > 0 ? recipientIds : undefined,
      );
      return c.json(result);
    },
  )
  .post(
    '/send-bulk',
    requireRole(['admin']),
    zValidator('json', bulkSendInputSchema),
    async (c) => {
      const input = c.req.valid('json');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const result = await bulkSendService.sendBulk(input, actor, ctx);
      return c.json(result);
    },
  )
  .post(
    '/consent-campaign',
    requireRole(['admin']),
    zValidator('json', consentCampaignSchema),
    async (c) => {
      const input = c.req.valid('json');
      const actor = { id: c.var.userId, role: c.var.userRole };
      const ctx = { ip: getClientIp(c), userAgent: c.req.header('user-agent') ?? null };
      const result = await sendConsentCampaign(input, actor, ctx);
      return c.json(result);
    },
  )
  .get('/history', requireRole(['admin', 'recruiter']), async (c) => {
    const actor = { id: c.var.userId, role: c.var.userRole };
    const result = await bulkSendService.getHistory(actor, 100);
    return c.json(result);
  });
