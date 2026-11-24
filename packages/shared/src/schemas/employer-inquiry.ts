import { z } from 'zod';
import { idSchema, optionalTrimmedString, paginationSchema } from './common';

export const employerInquiryStatusSchema = z.enum([
  'new',
  'contacted',
  'accepted',
  'rejected',
  'archived',
]);
export type EmployerInquiryStatus = z.infer<typeof employerInquiryStatusSchema>;
export const EMPLOYER_INQUIRY_STATUSES = employerInquiryStatusSchema.options;

export const employerInquirySourceSchema = z.enum(['web', 'manual']);
export type EmployerInquirySource = z.infer<typeof employerInquirySourceSchema>;
export const EMPLOYER_INQUIRY_SOURCES = employerInquirySourceSchema.options;

// Public submission — accessible without auth. Strict validation, no internal fields.
export const submitEmployerInquirySchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  contactPerson: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().min(7).max(30),
  message: z.string().trim().min(10).max(5000),
  privacyAccepted: z.literal(true, {
    errorMap: () => ({ message: 'privacy_required' }),
  }),
});
export type SubmitEmployerInquiryInput = z.infer<typeof submitEmployerInquirySchema>;

// Admin/coordinator can create manually (e.g. phone call followup) — more lenient on privacyAccepted.
export const createEmployerInquirySchema = submitEmployerInquirySchema.extend({
  privacyAccepted: z.boolean(),
  source: employerInquirySourceSchema.default('manual'),
  internalNotes: optionalTrimmedString(5000),
});
export type CreateEmployerInquiryInput = z.infer<typeof createEmployerInquirySchema>;

export const updateEmployerInquirySchema = z
  .object({
    companyName: z.string().trim().min(2).max(200),
    contactPerson: z.string().trim().min(2).max(150),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().min(7).max(30),
    message: z.string().trim().min(1).max(5000),
    status: employerInquiryStatusSchema,
    assignedToId: idSchema.nullable(),
    internalNotes: optionalTrimmedString(5000),
  })
  .partial();
export type UpdateEmployerInquiryInput = z.infer<typeof updateEmployerInquirySchema>;

export const employerInquirySchema = z.object({
  id: idSchema,
  companyName: z.string(),
  contactPerson: z.string(),
  email: z.string(),
  phone: z.string(),
  message: z.string(),
  privacyAccepted: z.boolean(),
  status: employerInquiryStatusSchema,
  source: employerInquirySourceSchema,
  assignedToId: idSchema.nullable(),
  internalNotes: z.string().nullable(),
  contactedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmployerInquiry = z.infer<typeof employerInquirySchema>;

export const listEmployerInquiriesQuerySchema = paginationSchema.extend({
  status: employerInquiryStatusSchema.optional(),
  assignedToId: idSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});
export type ListEmployerInquiriesQuery = z.infer<typeof listEmployerInquiriesQuerySchema>;

export const listEmployerInquiriesResponseSchema = z.object({
  items: z.array(employerInquirySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListEmployerInquiriesResponse = z.infer<typeof listEmployerInquiriesResponseSchema>;
