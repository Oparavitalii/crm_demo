import { z } from 'zod';
import { idSchema, optionalTrimmedString, paginationSchema } from './common';

export const documentCategoryEnum = z.enum([
  'regulamin',
  'rodo',
  'procedura',
  'polityka',
  'inne',
]);
export type DocumentCategory = z.infer<typeof documentCategoryEnum>;

export const userRoleEnum = z.enum(['admin', 'recruiter', 'coordinator', 'readonly']);

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Base shape — used to derive create/update with XOR validation.
const documentBaseShape = {
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(slugRegex, 'slug must be lowercase-kebab-case'),
  title: z.string().trim().min(1).max(300),
  category: documentCategoryEnum,
  contentMd: optionalTrimmedString(200_000), // ~200KB markdown ceiling
  requiresAcceptance: z.boolean().default(false),
  visibleToRoles: z.array(userRoleEnum).min(1).default(['admin', 'recruiter', 'coordinator', 'readonly']),
};

// Create: either contentMd OR a separate file upload (fileKey set by backend
// after R2 upload). Front-end will use multipart for file uploads, JSON for MD.
export const createDocumentMdSchema = z.object({
  ...documentBaseShape,
  contentMd: z.string().trim().min(1).max(200_000),
});
export type CreateDocumentMdInput = z.infer<typeof createDocumentMdSchema>;

export const createDocumentFileMetaSchema = z.object({
  slug: documentBaseShape.slug,
  title: documentBaseShape.title,
  category: documentBaseShape.category,
  requiresAcceptance: documentBaseShape.requiresAcceptance,
  visibleToRoles: documentBaseShape.visibleToRoles,
});
export type CreateDocumentFileMetaInput = z.infer<typeof createDocumentFileMetaSchema>;

export const updateDocumentSchema = z
  .object({
    title: documentBaseShape.title.optional(),
    category: documentBaseShape.category.optional(),
    contentMd: z.string().trim().min(1).max(200_000).optional(),
    requiresAcceptance: z.boolean().optional(),
    visibleToRoles: z.array(userRoleEnum).min(1).optional(),
  })
  .strict();
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const acceptDocumentSchema = z.object({
  version: z.number().int().positive(),
});
export type AcceptDocumentInput = z.infer<typeof acceptDocumentSchema>;

export const documentSchema = z.object({
  id: idSchema,
  slug: z.string(),
  title: z.string(),
  category: documentCategoryEnum,
  contentMd: z.string().nullable(),
  fileKey: z.string().nullable(),
  fileMime: z.string().nullable(),
  fileSizeBytes: z.number().int().nullable(),
  version: z.number().int().positive(),
  requiresAcceptance: z.boolean(),
  visibleToRoles: z.array(userRoleEnum),
  publishedAt: z.string().datetime().nullable(),
  createdBy: idSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Document = z.infer<typeof documentSchema>;

export const listDocumentsQuerySchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  category: documentCategoryEnum.optional(),
  requiresAcceptance: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

export const listDocumentsResponseSchema = z.object({
  items: z.array(documentSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListDocumentsResponse = z.infer<typeof listDocumentsResponseSchema>;

export const pendingAcceptanceSchema = z.object({
  document: documentSchema,
});
export type PendingAcceptance = z.infer<typeof pendingAcceptanceSchema>;

export const documentAcceptanceSchema = z.object({
  id: idSchema,
  documentId: idSchema,
  version: z.number().int().positive(),
  userId: idSchema,
  acceptedAt: z.string().datetime(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type DocumentAcceptance = z.infer<typeof documentAcceptanceSchema>;

export const documentAcceptanceWithUserSchema = documentAcceptanceSchema.extend({
  userEmail: z.string(),
  userFirstName: z.string().nullable(),
  userLastName: z.string().nullable(),
});
export type DocumentAcceptanceWithUser = z.infer<typeof documentAcceptanceWithUserSchema>;
