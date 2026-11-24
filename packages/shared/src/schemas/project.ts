import { z } from 'zod';
import { idSchema, optionalTrimmedString, paginationSchema } from './common';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  isActive: z.boolean().default(true),
  notes: optionalTrimmedString(2000),
  // How many people the client requires for this project (manual input).
  headcountNeeded: z.number().int().nonnegative().default(0),
  // Calendar day the project starts on site (YYYY-MM-DD). Nullable: not all
  // projects have a known start date yet.
  startDate: z.string().date().nullish(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectSchema = createProjectSchema.extend({
  id: idSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Staffing baseline — `foundCount` only counts candidates updated after this
  // moment. Bumped server-side whenever headcountNeeded or startDate changes.
  headcountResetAt: z.string().datetime(),
  // Computed staffing-progress fields, only populated by list/detail
  // endpoints. `foundCount` excludes cancelled, blacklist and anonymized
  // candidates; dismissed candidates ARE counted because the project staffed
  // them historically. `percentFilled` is 0..1 and 0 when headcountNeeded=0.
  foundCount: z.number().int().nonnegative().optional(),
  missingCount: z.number().int().nonnegative().optional(),
  percentFilled: z.number().min(0).max(1).optional(),
});
export type Project = z.infer<typeof projectSchema>;

// Projects fit on a single page in any realistic agency (max ~50). Default
// pageSize is bumped so the candidate-form dropdown gets the full list at once.
const stringBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

export const projectSortFieldSchema = z.enum(['startDate', 'createdAt', 'name']);
export type ProjectSortField = z.infer<typeof projectSortFieldSchema>;
export const projectSortDirSchema = z.enum(['asc', 'desc']);
export type ProjectSortDir = z.infer<typeof projectSortDirSchema>;

export const listProjectsQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  isActive: stringBool.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  // Default sort: latest startDate first (NULLS LAST handled in repo) so the
  // most recently launched projects float to the top of the list. Users can
  // switch to alphabetical (name) or signup order (createdAt) via the UI.
  sortBy: projectSortFieldSchema.default('startDate'),
  sortDir: projectSortDirSchema.default('desc'),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const listProjectsResponseSchema = z.object({
  items: z.array(projectSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
