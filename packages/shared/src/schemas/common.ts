import { z } from 'zod';

export const idSchema = z.string().uuid();
export type Id = z.infer<typeof idSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

// Sanitize helper for OPTIONAL text fields. Trims whitespace, converts
// empty / whitespace-only strings to null. Use on every optional field
// on create/update schemas so we never persist `""` or `"   "`.
export function optionalTrimmedString(max = 500) {
  return z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const trimmed = v.trim();
      return trimmed === '' ? null : trimmed;
    },
    z.string().max(max).nullable().optional(),
  );
}

// Shared date range filter — used by analytics dashboard AND every list page.
// `all` means no date filtering. `custom` requires `from` and `to`.
export const dateRangePresetSchema = z.enum([
  'today',
  '7d',
  '30d',
  'thisMonth',
  'lastMonth',
  'quarter',
  'all',
  'custom',
]);
export type DateRangePreset = z.infer<typeof dateRangePresetSchema>;

// Use `.merge()` onto a list query schema, OR spread `.shape` into one.
// `from/to` are ISO 8601 datetime strings WITH offset (e.g. 2026-05-19T00:00:00Z).
export const dateRangeFilterShape = {
  preset: dateRangePresetSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
};
export const dateRangeFilterSchema = z.object(dateRangeFilterShape);
export type DateRangeFilter = z.infer<typeof dateRangeFilterSchema>;

// 2026-07-10 — normalize the Excel float artifact before validating: numeric
// spreadsheet columns exported phones as "380936645458.0", which then failed
// every full-form save with HTTP 400. Strip the trailing ".0" instead of
// rejecting; everything else stays as strict as before.
export const phoneSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().replace(/\.0$/, '') : v),
  z
    .string()
    .trim()
    .min(7)
    .max(20)
    .regex(/^[+\d\s\-()]+$/, 'Invalid phone format'),
);

export const emailSchema = z.string().email().toLowerCase().trim();

export const apiErrorSchema = z.object({
  error: z.string(),
  meta: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
