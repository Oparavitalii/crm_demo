import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import {
  documents,
  type Document,
  type NewDocument,
} from '../db/tables/documents';
import type { ListDocumentsQuery } from '@opushr/shared';

export async function list(
  query: ListDocumentsQuery,
): Promise<{ items: Document[]; total: number }> {
  const where: SQL[] = [isNull(documents.deletedAt)];
  if (query.category) where.push(eq(documents.category, query.category));
  if (query.requiresAcceptance !== undefined) {
    where.push(eq(documents.requiresAcceptance, query.requiresAcceptance));
  }
  if (query.q) {
    const term = `%${query.q}%`;
    const orClause = or(ilike(documents.title, term), ilike(documents.slug, term));
    if (orClause) where.push(orClause);
  }

  const condition = and(...where);
  const offset = (query.page - 1) * query.pageSize;

  const [items, totalRow] = await Promise.all([
    db.query.documents.findMany({
      where: condition,
      orderBy: [asc(documents.category), asc(documents.title)],
      limit: query.pageSize,
      offset,
    }),
    db.select({ c: count() }).from(documents).where(condition).then((r) => r[0]),
  ]);

  return { items, total: totalRow?.c ?? 0 };
}

export async function findById(id: string): Promise<Document | undefined> {
  return db.query.documents.findFirst({
    where: and(eq(documents.id, id), isNull(documents.deletedAt)),
  });
}

export async function findBySlug(slug: string): Promise<Document | undefined> {
  return db.query.documents.findFirst({
    where: and(eq(documents.slug, slug), isNull(documents.deletedAt)),
  });
}

export async function findBySlugIncludingDeleted(
  slug: string,
): Promise<Document | undefined> {
  return db.query.documents.findFirst({ where: eq(documents.slug, slug) });
}

export async function insert(input: NewDocument): Promise<Document> {
  const [row] = await db.insert(documents).values(input).returning();
  if (!row) throw new Error('Failed to insert document');
  return row;
}

export async function update(
  id: string,
  patch: Partial<NewDocument>,
): Promise<Document | undefined> {
  const [row] = await db
    .update(documents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning();
  return row;
}

export async function softDelete(id: string): Promise<boolean> {
  const result = await db
    .update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(documents.id, id));
  return (result.rowCount ?? 0) > 0;
}
