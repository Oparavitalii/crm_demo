import { z } from 'zod';
import { idSchema } from './common';

// FAZA 27: per-candidate threaded comments. Body is bounded at 5k chars to
// match the candidates.notes limit (recruiters paste long status updates).
export const createCandidateCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type CreateCandidateCommentInput = z.infer<
  typeof createCandidateCommentSchema
>;

export const candidateCommentSchema = z.object({
  id: idSchema,
  candidateId: idSchema,
  authorId: idSchema.nullable(),
  body: z.string(),
  createdAt: z.string().datetime(),
  // Enriched on list / create responses — author display names via JOIN.
  // Optional + nullable: `null` when the author row exists but has empty
  // names (shouldn't happen), `undefined` when not enriched at all.
  authorFirstName: z.string().nullable().optional(),
  authorLastName: z.string().nullable().optional(),
});
export type CandidateComment = z.infer<typeof candidateCommentSchema>;

export const listCandidateCommentsResponseSchema = z.object({
  items: z.array(candidateCommentSchema),
  total: z.number().int().nonnegative(),
});
export type ListCandidateCommentsResponse = z.infer<
  typeof listCandidateCommentsResponseSchema
>;
