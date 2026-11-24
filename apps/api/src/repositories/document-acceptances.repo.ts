import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import {
  documentAcceptances,
  type DocumentAcceptance,
  type NewDocumentAcceptance,
} from '../db/tables/document-acceptances';
import { documents, type Document } from '../db/tables/documents';
import { users } from '../db/tables/users';

export async function insert(
  input: NewDocumentAcceptance,
): Promise<DocumentAcceptance> {
  const [row] = await db.insert(documentAcceptances).values(input).returning();
  if (!row) throw new Error('Failed to insert acceptance');
  return row;
}

export async function findByDocVersionUser(params: {
  documentId: string;
  version: number;
  userId: string;
}): Promise<DocumentAcceptance | undefined> {
  return db.query.documentAcceptances.findFirst({
    where: and(
      eq(documentAcceptances.documentId, params.documentId),
      eq(documentAcceptances.version, params.version),
      eq(documentAcceptances.userId, params.userId),
    ),
  });
}

// Returns published, requires_acceptance, non-deleted documents the user
// has NOT yet accepted at their current version. Filtered by visibleToRoles
// AT THE SERVICE LAYER (this repo does not see the user's role).
export async function listPendingForUser(userId: string): Promise<Document[]> {
  const acceptedRows = await db
    .select({ docId: documentAcceptances.documentId, version: documentAcceptances.version })
    .from(documentAcceptances)
    .where(eq(documentAcceptances.userId, userId));
  const acceptedSet = new Set(acceptedRows.map((r) => `${r.docId}:${r.version}`));

  const candidateDocs = await db.query.documents.findMany({
    where: and(
      eq(documents.requiresAcceptance, true),
      isNull(documents.deletedAt),
      isNotNull(documents.publishedAt),
    ),
  });

  return candidateDocs.filter((d) => !acceptedSet.has(`${d.id}:${d.version}`));
}

export async function listForDocument(documentId: string): Promise<
  Array<DocumentAcceptance & {
    userEmail: string;
    userFirstName: string | null;
    userLastName: string | null;
  }>
> {
  const rows = await db
    .select({
      id: documentAcceptances.id,
      documentId: documentAcceptances.documentId,
      version: documentAcceptances.version,
      userId: documentAcceptances.userId,
      acceptedAt: documentAcceptances.acceptedAt,
      ip: documentAcceptances.ip,
      userAgent: documentAcceptances.userAgent,
      userEmail: users.email,
      userFirstName: users.firstName,
      userLastName: users.lastName,
    })
    .from(documentAcceptances)
    .leftJoin(users, eq(documentAcceptances.userId, users.id))
    .where(eq(documentAcceptances.documentId, documentId))
    .orderBy(desc(documentAcceptances.acceptedAt));

  return rows.map((r) => ({
    ...r,
    userEmail: r.userEmail ?? '(deleted)',
  }));
}

export async function listForUser(userId: string): Promise<
  Array<DocumentAcceptance & { documentSlug: string; documentTitle: string }>
> {
  const rows = await db
    .select({
      id: documentAcceptances.id,
      documentId: documentAcceptances.documentId,
      version: documentAcceptances.version,
      userId: documentAcceptances.userId,
      acceptedAt: documentAcceptances.acceptedAt,
      ip: documentAcceptances.ip,
      userAgent: documentAcceptances.userAgent,
      documentSlug: documents.slug,
      documentTitle: documents.title,
    })
    .from(documentAcceptances)
    .leftJoin(documents, eq(documentAcceptances.documentId, documents.id))
    .where(eq(documentAcceptances.userId, userId))
    .orderBy(desc(documentAcceptances.acceptedAt));

  return rows.map((r) => ({
    ...r,
    documentSlug: r.documentSlug ?? '(deleted)',
    documentTitle: r.documentTitle ?? '(deleted)',
  }));
}
