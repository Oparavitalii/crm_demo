import { z } from 'zod';
import { idSchema } from './common';

// 2026-06-12: leads entity retired — only candidate duplicates remain. Kept as
// an enum (not a literal) so the type stays open for future entity types.
export const duplicateEntityTypeSchema = z.enum(['candidate']);
export type DuplicateEntityType = z.infer<typeof duplicateEntityTypeSchema>;

// Shape returned by GET /candidates/:id/duplicates.
// Frontend renders this in DuplicateManagerModal.
// Named "Record" (not "Match") to avoid collision with `DuplicateMatch` in
// candidate.ts which is the create-time block payload (different shape).
export const duplicateRecordSchema = z.object({
  id: idSchema,
  matchedBy: z.array(z.enum(['email', 'phone', 'name'])),
  // Display fields — we don't reuse full record schemas because the modal only
  // needs enough to show the row + decide action.
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type DuplicateRecord = z.infer<typeof duplicateRecordSchema>;

export const duplicatesResponseSchema = z.object({
  items: z.array(duplicateRecordSchema),
});
export type DuplicatesResponse = z.infer<typeof duplicatesResponseSchema>;

// POST /duplicates/ignore — mark a pair as "not a duplicate".
export const ignoreDuplicateSchema = z.object({
  entityType: duplicateEntityTypeSchema,
  idA: idSchema,
  idB: idSchema,
});
export type IgnoreDuplicateInput = z.infer<typeof ignoreDuplicateSchema>;
