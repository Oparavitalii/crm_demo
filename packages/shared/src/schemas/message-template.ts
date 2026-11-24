import { z } from 'zod';
import { idSchema, optionalTrimmedString, paginationSchema } from './common';

export const messageChannelSchema = z.enum(['email', 'sms']);
export type MessageChannel = z.infer<typeof messageChannelSchema>;

export const createMessageTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  channel: messageChannelSchema,
  subject: optionalTrimmedString(500),
  body: z.string().min(1).max(50000),
  variables: z.array(z.string().max(50)).default([]),
  // Onboarding auto-send: when true this email template is sent automatically to
  // every newly created candidate. Only meaningful for channel==='email'.
  // Optional (not defaulted) so the service/tests can omit it — treated as false.
  autoSendOnCreate: z.boolean().optional(),
});
export type CreateMessageTemplateInput = z.infer<typeof createMessageTemplateSchema>;

export const updateMessageTemplateSchema = createMessageTemplateSchema.partial();
export type UpdateMessageTemplateInput = z.infer<typeof updateMessageTemplateSchema>;

export const messageTemplateSchema = createMessageTemplateSchema.extend({
  id: idSchema,
  autoSendOnCreate: z.boolean(),
  createdById: idSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;

export const listMessageTemplatesQuerySchema = paginationSchema.extend({
  channel: messageChannelSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListMessageTemplatesQuery = z.infer<typeof listMessageTemplatesQuerySchema>;

export const listMessageTemplatesResponseSchema = z.object({
  items: z.array(messageTemplateSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListMessageTemplatesResponse = z.infer<typeof listMessageTemplatesResponseSchema>;
