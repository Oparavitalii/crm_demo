import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { duplicateIgnores, type DuplicateIgnore } from '../db/tables/duplicate-ignores';

// 2026-06-12: leads entity retired. Only candidate-type ignore pairs remain.
// Type stays open for future entity types.
export type EntityType = 'candidate';

// Returns [smallerId, largerId] so a pair is unique regardless of click order.
function normalizePair(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

export async function add(input: {
  entityType: EntityType;
  idA: string;
  idB: string;
  createdById: string | null;
}): Promise<DuplicateIgnore> {
  const [a, b] = normalizePair(input.idA, input.idB);
  const [row] = await db
    .insert(duplicateIgnores)
    .values({
      entityType: input.entityType,
      idA: a,
      idB: b,
      createdById: input.createdById,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Already exists — fetch the existing record so the caller gets a real return.
  const existing = await db.query.duplicateIgnores.findFirst({
    where: and(
      eq(duplicateIgnores.entityType, input.entityType),
      eq(duplicateIgnores.idA, a),
      eq(duplicateIgnores.idB, b),
    ),
  });
  if (!existing) throw new Error('duplicate_ignore_upsert_failed');
  return existing;
}

export async function remove(input: {
  entityType: EntityType;
  idA: string;
  idB: string;
}): Promise<boolean> {
  const [a, b] = normalizePair(input.idA, input.idB);
  const result = await db
    .delete(duplicateIgnores)
    .where(
      and(
        eq(duplicateIgnores.entityType, input.entityType),
        eq(duplicateIgnores.idA, a),
        eq(duplicateIgnores.idB, b),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

// Returns the set of pairs (as "minId|maxId" strings) marked as not-duplicate.
// Caller can quickly check `ignoredPairs.has(\`${idA}|${idB}\`.split('|').sort().join('|'))`.
export async function listIgnored(entityType: EntityType): Promise<Set<string>> {
  const rows = await db
    .select({ idA: duplicateIgnores.idA, idB: duplicateIgnores.idB })
    .from(duplicateIgnores)
    .where(eq(duplicateIgnores.entityType, entityType));
  return new Set(rows.map((r) => `${r.idA}|${r.idB}`));
}

export function pairKey(idA: string, idB: string): string {
  const [a, b] = normalizePair(idA, idB);
  return `${a}|${b}`;
}
