import { and, count, desc, eq, gte, inArray, lt, lte, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, type NewAuditLogEntry, type AuditLogEntry } from '../db/tables/audit-log';
import { users } from '../db/tables/users';
import type { ListAuditLogQuery } from '@crm/shared';

export type EnrichedAuditLogEntry = AuditLogEntry & {
  actorFirstName: string | null;
  actorLastName: string | null;
};

export async function insert(entry: NewAuditLogEntry): Promise<void> {
  await db.insert(auditLog).values(entry);
}

export async function list(
  query: ListAuditLogQuery,
): Promise<{ items: EnrichedAuditLogEntry[]; total: number }> {
  const where: SQL[] = [];

  if (query.actorId) where.push(eq(auditLog.actorId, query.actorId));
  if (query.action) where.push(eq(auditLog.action, query.action));
  if (query.entityType) where.push(eq(auditLog.entityType, query.entityType));
  if (query.entityId) where.push(eq(auditLog.entityId, query.entityId));
  if (query.from) where.push(gte(auditLog.createdAt, new Date(query.from)));
  if (query.to) where.push(lte(auditLog.createdAt, new Date(query.to)));

  const pageSize = Math.min(query.pageSize, 100);
  const offset = (query.page - 1) * pageSize;
  const condition = where.length ? and(...where) : undefined;

  const [items, totalRow] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        oldValue: auditLog.oldValue,
        newValue: auditLog.newValue,
        ip: auditLog.ip,
        userAgent: auditLog.userAgent,
        createdAt: auditLog.createdAt,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .where(condition)
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ c: count() }).from(auditLog).where(condition).then((r) => r[0]),
  ]);

  return { items: items as EnrichedAuditLogEntry[], total: totalRow?.c ?? 0 };
}

/**
 * C-1: Fetch ALL audit entries for a single entityId without pagination cap.
 * Pages through in batches of 500 until exhausted.
 */
export async function listAll(entityId: string): Promise<AuditLogEntry[]> {
  const PAGE_SIZE = 500;
  const results: AuditLogEntry[] = [];
  let offset = 0;

  while (true) {
    const batch = await db.query.auditLog.findMany({
      where: eq(auditLog.entityId, entityId),
      orderBy: desc(auditLog.createdAt),
      limit: PAGE_SIZE,
      offset,
    });
    results.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return results;
}

/**
 * C-2: Fetch ALL audit entries for a set of entityIds.
 * Used for cross-entity audit in RODO export (placements, dismissals, messages).
 */
export async function listByEntityIds(ids: string[]): Promise<AuditLogEntry[]> {
  if (ids.length === 0) return [];

  const PAGE_SIZE = 500;
  const results: AuditLogEntry[] = [];
  let offset = 0;

  while (true) {
    const batch = await db.query.auditLog.findMany({
      where: inArray(auditLog.entityId, ids),
      orderBy: desc(auditLog.createdAt),
      limit: PAGE_SIZE,
      offset,
    });
    results.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return results;
}

// Retention: delete rows older than `cutoff`. Called from cron/retention.ts.
// Returns the number of rows removed for cron telemetry.
export async function purgeOlderThan(cutoff: Date): Promise<number> {
  const result = await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
  return result.rowCount ?? 0;
}
