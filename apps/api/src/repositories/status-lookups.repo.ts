import { and, asc, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  statusLookups,
  type StatusLookup,
  type NewStatusLookup,
} from '../db/tables/status-lookups';
import { candidates } from '../db/tables/candidates';
import { dismissals } from '../db/tables/dismissals';
import type { StatusLookupType } from '@crm/shared';

export async function listActive(type: StatusLookupType): Promise<StatusLookup[]> {
  return db
    .select()
    .from(statusLookups)
    .where(and(eq(statusLookups.type, type), isNull(statusLookups.deletedAt)))
    .orderBy(asc(statusLookups.sortOrder), asc(statusLookups.labelPl));
}

export async function listAll(type: StatusLookupType): Promise<StatusLookup[]> {
  return db
    .select()
    .from(statusLookups)
    .where(eq(statusLookups.type, type))
    .orderBy(asc(statusLookups.sortOrder), asc(statusLookups.labelPl));
}

export async function listDeleted(): Promise<StatusLookup[]> {
  return db
    .select()
    .from(statusLookups)
    .where(isNotNull(statusLookups.deletedAt))
    .orderBy(desc(statusLookups.deletedAt));
}

export async function findById(id: string): Promise<StatusLookup | undefined> {
  const [row] = await db.select().from(statusLookups).where(eq(statusLookups.id, id));
  return row;
}

export async function findActiveByTypeAndCode(
  type: StatusLookupType,
  code: string,
): Promise<StatusLookup | undefined> {
  const [row] = await db
    .select()
    .from(statusLookups)
    .where(
      and(
        eq(statusLookups.type, type),
        eq(statusLookups.code, code),
        isNull(statusLookups.deletedAt),
      ),
    );
  return row;
}

export async function insert(input: NewStatusLookup): Promise<StatusLookup> {
  const [row] = await db.insert(statusLookups).values(input).returning();
  if (!row) throw new Error('Failed to insert status_lookup');
  return row;
}

export async function update(
  id: string,
  patch: Partial<NewStatusLookup>,
): Promise<StatusLookup | undefined> {
  const [row] = await db
    .update(statusLookups)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(statusLookups.id, id))
    .returning();
  return row;
}

export async function softDelete(id: string): Promise<StatusLookup | undefined> {
  const [row] = await db
    .update(statusLookups)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(statusLookups.id, id))
    .returning();
  return row;
}

export async function restore(id: string): Promise<StatusLookup | undefined> {
  const [row] = await db
    .update(statusLookups)
    .set({ deletedAt: null, updatedAt: sql`now()` })
    .where(eq(statusLookups.id, id))
    .returning();
  return row;
}

export async function hardDelete(id: string): Promise<boolean> {
  const result = await db.delete(statusLookups).where(eq(statusLookups.id, id));
  return (result.rowCount ?? 0) > 0;
}

// Count rows that reference a given code across the relevant table. Used to
// warn the admin before delete and to block hard-delete when usage > 0.
export async function getUsageCount(
  type: StatusLookupType,
  code: string,
): Promise<number> {
  const rows = await (async () => {
    switch (type) {
      case 'sources':
        // 2026-06-12: leads entity retired — count only candidates.source now.
        return db
          .select({ c: count() })
          .from(candidates)
          .where(eq(candidates.source, code));
      case 'dismissal_reason':
        return db
          .select({ c: count() })
          .from(dismissals)
          .where(eq(dismissals.reasonCode, code));
      case 'no_show_reason':
        // 2026-06-10: `no_show_reason` column was dropped. The "used by" check
        // now counts candidates whose `work_end_reason` (same lookup pool)
        // matches the code, so soft-deleting a reason still warns the admin.
        return db
          .select({ c: count() })
          .from(candidates)
          .where(eq(candidates.workEndReason, code));
      case 'position':
        return db
          .select({ c: count() })
          .from(candidates)
          .where(eq(candidates.position, code));
      case 'legal_status':
        return db
          .select({ c: count() })
          .from(candidates)
          .where(eq(candidates.legalStatus, code));
      case 'nationality':
        return db
          .select({ c: count() })
          .from(candidates)
          .where(eq(candidates.nationality, code));
      default:
        return [] as { c: number }[];
    }
  })();
  return Number(rows[0]?.c ?? 0);
}

// Every active row across every type, ordered so the service can group them
// without re-sorting. Backs GET /status-lookups/all — one query replacing the
// nine separate per-type requests a candidate list used to fire, each of which
// cost a requireAuth session lookup and its own pool connection.
export async function listAllActiveGrouped(): Promise<StatusLookup[]> {
  return db
    .select()
    .from(statusLookups)
    .where(isNull(statusLookups.deletedAt))
    .orderBy(asc(statusLookups.type), asc(statusLookups.sortOrder), asc(statusLookups.labelPl));
}
