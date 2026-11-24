import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import {
  employerInquiries,
  type EmployerInquiry,
  type NewEmployerInquiry,
} from '../db/tables/employer-inquiries';
import type { ListEmployerInquiriesQuery } from '@crm/shared';

export async function list(
  query: ListEmployerInquiriesQuery,
): Promise<{ items: EmployerInquiry[]; total: number }> {
  const where: SQL[] = [];

  if (query.status) where.push(eq(employerInquiries.status, query.status));
  if (query.assignedToId) where.push(eq(employerInquiries.assignedToId, query.assignedToId));
  if (query.q) {
    const term = `%${query.q}%`;
    const orClause = or(
      ilike(employerInquiries.companyName, term),
      ilike(employerInquiries.contactPerson, term),
      ilike(employerInquiries.email, term),
    );
    if (orClause) where.push(orClause);
  }
  if (query.dateFrom) where.push(gte(employerInquiries.createdAt, new Date(query.dateFrom)));
  if (query.dateTo) {
    const endOfDay = new Date(query.dateTo);
    endOfDay.setUTCHours(23, 59, 59, 999);
    where.push(lte(employerInquiries.createdAt, endOfDay));
  }

  const condition = where.length ? and(...where) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  const [items, totalRow] = await Promise.all([
    db.query.employerInquiries.findMany({
      where: condition,
      orderBy: desc(employerInquiries.createdAt),
      limit: query.pageSize,
      offset,
    }),
    db.select({ c: count() }).from(employerInquiries).where(condition).then((r) => r[0]),
  ]);

  return { items, total: totalRow?.c ?? 0 };
}

export async function findById(id: string): Promise<EmployerInquiry | undefined> {
  return db.query.employerInquiries.findFirst({ where: eq(employerInquiries.id, id) });
}

export async function insert(input: NewEmployerInquiry): Promise<EmployerInquiry> {
  const [row] = await db.insert(employerInquiries).values(input).returning();
  if (!row) throw new Error('Failed to insert employer inquiry');
  return row;
}

export async function update(
  id: string,
  patch: Partial<NewEmployerInquiry>,
): Promise<EmployerInquiry | undefined> {
  const [row] = await db
    .update(employerInquiries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(employerInquiries.id, id))
    .returning();
  return row;
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(employerInquiries).where(eq(employerInquiries.id, id));
  return (result.rowCount ?? 0) > 0;
}

// Anti-spam: same email + IP submitting more than N inquiries in last 24h
export async function recentSubmissionsCount(
  email: string,
  ip: string | null,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const where = [
    gte(employerInquiries.createdAt, since),
    eq(employerInquiries.email, email),
  ];
  if (ip) {
    const orClause = or(
      eq(employerInquiries.email, email),
      eq(employerInquiries.ipAddress, ip),
    );
    if (orClause) where[1] = orClause;
  }
  const [row] = await db.select({ c: count() }).from(employerInquiries).where(and(...where));
  return row?.c ?? 0;
}

// Analytics helpers
export async function statsByStatus(): Promise<
  Array<{ status: string; count: number }>
> {
  const rows = await db
    .select({ status: employerInquiries.status, count: count() })
    .from(employerInquiries)
    .groupBy(employerInquiries.status);
  return rows.map((r) => ({ status: r.status as string, count: r.count }));
}

export async function countSince(since: Date): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(employerInquiries)
    .where(gte(employerInquiries.createdAt, since));
  return row?.c ?? 0;
}
