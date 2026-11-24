import { z } from 'zod';
import { idSchema, paginationSchema } from './common';

export const auditLogEntrySchema = z.object({
  id: idSchema,
  actorId: idSchema.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  // Enriched on list endpoints — actor's first/last name from `users` table.
  // Null when actor is null (system/public action) or user is deleted.
  actorFirstName: z.string().nullable().optional(),
  actorLastName: z.string().nullable().optional(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const listAuditLogQuerySchema = paginationSchema.extend({
  actorId: idSchema.optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;

export const listAuditLogResponseSchema = z.object({
  items: z.array(auditLogEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListAuditLogResponse = z.infer<typeof listAuditLogResponseSchema>;
