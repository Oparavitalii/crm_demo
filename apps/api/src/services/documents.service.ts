import type { Document, NewDocument } from '../db/tables/documents';
import type { DocumentAcceptance } from '../db/tables/document-acceptances';
import * as repo from '../repositories/documents.repo';
import * as accRepo from '../repositories/document-acceptances.repo';
import * as audit from './audit.service';
import { putObject, presignGet, deleteObject } from '../clients/r2.client';
import { AppError, NotFoundError, ForbiddenError } from '../lib/errors';
import type {
  AcceptDocumentInput,
  CreateDocumentMdInput,
  CreateDocumentFileMetaInput,
  ListDocumentsQuery,
  UpdateDocumentInput,
} from '@crm/shared';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

function canView(doc: Document, actor: Actor): boolean {
  return doc.visibleToRoles.includes(actor.role);
}

export async function listDocuments(
  query: ListDocumentsQuery,
  actor: Actor,
): Promise<{ items: Document[]; total: number; page: number; pageSize: number }> {
  const { items, total } = await repo.list(query);
  const filtered = items.filter((d) => canView(d, actor));
  return { items: filtered, total, page: query.page, pageSize: query.pageSize };
}

export async function getDocumentBySlug(slug: string, actor: Actor): Promise<Document> {
  const row = await repo.findBySlug(slug);
  if (!row) throw new NotFoundError('document');
  if (!canView(row, actor)) throw new ForbiddenError('document not visible to your role');
  return row;
}

export async function getDocumentFileUrl(id: string, actor: Actor): Promise<string> {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('document');
  if (!canView(row, actor)) throw new ForbiddenError();
  if (!row.fileKey) throw new AppError('VALIDATION', { reason: 'document_has_no_file' }, 400);
  return presignGet(row.fileKey);
}

// Admin-only get-by-id. Service-level role check matches the other admin
// service entries (createMarkdownDocument, updateDocument, etc.). Used by
// AdminDocumentEditPage so it doesn't have to fetch a page of 200 to find one.
export async function getDocumentByIdAdmin(id: string, actor: Actor): Promise<Document> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('document');
  return row;
}

export async function createMarkdownDocument(
  input: CreateDocumentMdInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<Document> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const dup = await repo.findBySlugIncludingDeleted(input.slug);
  if (dup) throw new AppError('DUPLICATE', { field: 'slug' }, 409);

  const row = await repo.insert({
    slug: input.slug,
    title: input.title,
    category: input.category,
    contentMd: input.contentMd,
    fileKey: null,
    fileMime: null,
    fileSizeBytes: null,
    requiresAcceptance: input.requiresAcceptance,
    visibleToRoles: input.visibleToRoles,
    createdBy: actor.id,
  } as NewDocument);

  await audit.log({
    actorId: actor.id,
    action: 'create_document',
    entityType: 'document',
    entityId: row.id,
    newValue: { slug: row.slug, title: row.title, category: row.category, kind: 'markdown' },
    ...ctx,
  });

  return row;
}

export async function createFileDocument(
  meta: CreateDocumentFileMetaInput,
  file: { body: Buffer; mime: string; sizeBytes: number },
  actor: Actor,
  ctx: ReqCtx,
): Promise<Document> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');
  if (file.mime !== 'application/pdf') {
    throw new AppError('VALIDATION', { reason: 'only_pdf_allowed' }, 415);
  }
  if (file.sizeBytes > 10 * 1024 * 1024) {
    throw new AppError('VALIDATION', { reason: 'file_too_large_10mb' }, 413);
  }
  const dup = await repo.findBySlugIncludingDeleted(meta.slug);
  if (dup) throw new AppError('DUPLICATE', { field: 'slug' }, 409);

  // We need a stable id first to build the key. Insert with placeholder, then
  // re-construct the key based on the returned id and upload to R2. If either
  // R2 upload or DB finalization fails, we soft-delete the row + remove the R2
  // object so we don't leave orphans (audit-friendly: failure leaves a trail).
  const tempKey = `documents/pending/${crypto.randomUUID()}`;
  const row = await repo.insert({
    slug: meta.slug,
    title: meta.title,
    category: meta.category,
    contentMd: null,
    fileKey: tempKey,
    fileMime: file.mime,
    fileSizeBytes: file.sizeBytes,
    requiresAcceptance: meta.requiresAcceptance,
    visibleToRoles: meta.visibleToRoles,
    createdBy: actor.id,
  } as NewDocument);

  const finalKey = `documents/${row.id}/v${row.version}.pdf`;
  let updated: Document | undefined;
  try {
    await putObject({ key: finalKey, body: file.body, contentType: file.mime });
    updated = await repo.update(row.id, { fileKey: finalKey });
    if (!updated) throw new Error('Failed to finalize file document');
  } catch (err) {
    // Best-effort cleanup. R2 delete and soft-delete failures are non-fatal —
    // the original error is what callers care about.
    await deleteObject(finalKey).catch(() => undefined);
    await repo.softDelete(row.id).catch(() => undefined);
    throw err;
  }

  await audit.log({
    actorId: actor.id,
    action: 'create_document',
    entityType: 'document',
    entityId: row.id,
    newValue: {
      slug: row.slug,
      title: row.title,
      category: row.category,
      kind: 'file',
      mime: file.mime,
      sizeBytes: file.sizeBytes,
    },
    ...ctx,
  });

  return updated;
}

export async function updateDocument(
  id: string,
  patch: UpdateDocumentInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<Document> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('document');

  const isPublished = existing.publishedAt !== null;
  const requiresAcceptance =
    patch.requiresAcceptance ?? existing.requiresAcceptance;
  // Only bump version if a USER-VISIBLE field actually changed value. Without
  // this guard, re-saving an unchanged published doc would force every user
  // to re-accept — training admins to fear the edit button.
  const contentChanged =
    (patch.title !== undefined && patch.title !== existing.title) ||
    (patch.contentMd !== undefined && patch.contentMd !== existing.contentMd);
  const shouldBumpVersion = isPublished && requiresAcceptance && contentChanged;

  const finalPatch: Partial<NewDocument> = { ...patch };
  if (shouldBumpVersion) finalPatch.version = existing.version + 1;

  const row = await repo.update(id, finalPatch);
  if (!row) throw new NotFoundError('document');

  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    oldValue[key] = (existing as Record<string, unknown>)[key as string];
    newValue[key] = (row as Record<string, unknown>)[key as string];
  }
  if (shouldBumpVersion) {
    oldValue.version = existing.version;
    newValue.version = row.version;
  }

  await audit.log({
    actorId: actor.id,
    action: 'update_document',
    entityType: 'document',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  return row;
}

export async function publishDocument(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<Document> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('document');
  if (existing.publishedAt !== null) {
    throw new AppError('VALIDATION', { reason: 'already_published' }, 409);
  }
  const row = await repo.update(id, { publishedAt: new Date() });
  if (!row) throw new NotFoundError('document');

  await audit.log({
    actorId: actor.id,
    action: 'publish_document',
    entityType: 'document',
    entityId: id,
    newValue: { publishedAt: row.publishedAt },
    ...ctx,
  });

  return row;
}

export async function softDeleteDocument(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<void> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('document');

  // Audit BEFORE delete — never lose the trail if delete fails.
  await audit.log({
    actorId: actor.id,
    action: 'delete_document',
    entityType: 'document',
    entityId: id,
    oldValue: { slug: existing.slug, title: existing.title, version: existing.version },
    ...ctx,
  });

  await repo.softDelete(id);
  // Note: R2 file intentionally kept after soft-delete (audit-friendly).
}

export async function acceptDocument(
  input: { documentId: string } & AcceptDocumentInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<DocumentAcceptance> {
  const doc = await repo.findById(input.documentId);
  if (!doc) throw new NotFoundError('document');
  if (!canView(doc, actor)) throw new ForbiddenError();
  if (doc.publishedAt === null) {
    throw new AppError('VALIDATION', { reason: 'document_not_published' }, 409);
  }
  if (doc.version !== input.version) {
    throw new AppError(
      'VALIDATION',
      { reason: 'version_mismatch', current: doc.version, submitted: input.version },
      409,
    );
  }

  const existing = await accRepo.findByDocVersionUser({
    documentId: doc.id,
    version: doc.version,
    userId: actor.id,
  });
  if (existing) return existing;

  const row = await accRepo.insert({
    documentId: doc.id,
    version: doc.version,
    userId: actor.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  await audit.log({
    actorId: actor.id,
    action: 'accept_document',
    entityType: 'document',
    entityId: doc.id,
    newValue: { version: doc.version, slug: doc.slug },
    ...ctx,
  });

  return row;
}

export async function listPendingAcceptancesForUser(
  actor: Actor,
): Promise<Array<{ document: Document }>> {
  const all = await accRepo.listPendingForUser(actor.id);
  const visible = all.filter((d) => canView(d, actor));
  return visible.map((d) => ({ document: d }));
}

export async function listAcceptancesForDocument(
  documentId: string,
  actor: Actor,
): Promise<Awaited<ReturnType<typeof accRepo.listForDocument>>> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');
  return accRepo.listForDocument(documentId);
}

export async function listAcceptancesForUser(
  userId: string,
): Promise<Awaited<ReturnType<typeof accRepo.listForUser>>> {
  return accRepo.listForUser(userId);
}
