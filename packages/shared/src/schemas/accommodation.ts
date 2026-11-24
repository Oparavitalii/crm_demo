import { z } from 'zod';
import { idSchema } from './common';

// Housing summary: a single candidate row inside one of the two groups
// (our housing / own housing). Just enough to render a list with a link.
export const housingCandidateSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.enum(['employed', 're_employed']),
  updatedAt: z.string().datetime(),
});
export type HousingCandidate = z.infer<typeof housingCandidateSchema>;

export const housingGroupSchema = z.object({
  count: z.number().int().nonnegative(),
  candidates: z.array(housingCandidateSchema),
});
export type HousingGroup = z.infer<typeof housingGroupSchema>;

export const housingSummarySchema = z.object({
  ourHousing: housingGroupSchema,
  ownHousing: housingGroupSchema,
});
export type HousingSummary = z.infer<typeof housingSummarySchema>;
