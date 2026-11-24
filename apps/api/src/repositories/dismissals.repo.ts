import { alias } from 'drizzle-orm/pg-core';
import { and, count, desc, eq, gte, ilike, lt, lte, type SQL } from 'drizzle-orm';
import { db, type Executor } from '../db/client';
import { dismissals, type Dismissal, type NewDismissal } from '../db/tables/dismissals';
import { candidates } from '../db/tables/candidates';
import { users } from '../db/tables/users';
import { projects } from '../db/tables/projects';
import type { ListDismissalsQuery } from '@crm/shared';
import { resolveDateRange } from '../lib/date-range';

export interface EnrichedDismissalRow extends Dismissal {
  candidateName: string | null;
  candidateSource: string | null;
  recordedByFirstName: string | null;
  recordedByLastName: string | null;
  recruiterFirstName: string | null;
  recruiterLastName: string | null;
  coordinatorFirstName: string | null;
  coordinatorLastName: string | null;
  projectName: string | null;
  workStartDate: Date | null;
  daysWorked: number | null;
  reasonNote: string | null;
}

export async function list(
  query: ListDismissalsQuery,
): Promise<{ items: Dismissal[]; total: number }> {
  const where: SQL[] = [];

  if (query.candidateId) where.push(eq(dismissals.candidateId, query.candidateId));
  if (query.recordedById) where.push(eq(dismissals.recordedById, query.recordedById));
  if (query.reason) where.push(ilike(dismissals.reason, `%${query.reason}%`));
  if (query.reasonCode) where.push(eq(dismissals.reasonCode, query.reasonCode));

  const { since, until } = resolveDateRange({
    preset: query.preset,
    from: query.from,
    to: query.to,
  });
  if (since) where.push(gte(dismissals.dismissedAt, since));
  if (until) where.push(lt(dismissals.dismissedAt, until));

  const condition = where.length ? and(...where) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  const [items, totalRow] = await Promise.all([
    db.query.dismissals.findMany({
      where: condition,
      orderBy: desc(dismissals.dismissedAt),
      limit: query.pageSize,
      offset,
    }),
    db.select({ c: count() }).from(dismissals).where(condition).then((r) => r[0]),
  ]);

  return { items, total: totalRow?.c ?? 0 };
}

export async function findById(id: string): Promise<Dismissal | undefined> {
  return db.query.dismissals.findFirst({ where: eq(dismissals.id, id) });
}

export async function listByCandidate(candidateId: string): Promise<Dismissal[]> {
  return db.query.dismissals.findMany({
    where: eq(dismissals.candidateId, candidateId),
    orderBy: desc(dismissals.dismissedAt),
  });
}

export async function insert(input: NewDismissal, exec: Executor = db): Promise<Dismissal> {
  const [row] = await exec.insert(dismissals).values(input).returning();
  if (!row) throw new Error('Failed to insert dismissal');
  return row;
}

export async function update(
  id: string,
  patch: Partial<NewDismissal>,
): Promise<Dismissal | undefined> {
  const [row] = await db
    .update(dismissals)
    .set(patch)
    .where(eq(dismissals.id, id))
    .returning();
  return row;
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(dismissals).where(eq(dismissals.id, id));
  return (result.rowCount ?? 0) > 0;
}

export async function listEnriched(
  query: ListDismissalsQuery,
  scopeRecruiterId?: string,
  scopeCoordinatorId?: string,
): Promise<{ items: EnrichedDismissalRow[]; total: number }> {
  const where: SQL[] = [];

  // Alias `users` three times: recorded_by (who filed it), the candidate's
  // recruiter, and the candidate's coordinator (both shown in retention report).
  const recordedBy = alias(users, 'recorded_by');
  const recruiter = alias(users, 'recruiter');
  const coordinator = alias(users, 'coordinator');

  if (query.candidateId) where.push(eq(dismissals.candidateId, query.candidateId));
  if (query.recordedById) where.push(eq(dismissals.recordedById, query.recordedById));
  if (query.source) where.push(eq(candidates.source, query.source as never));
  if (query.reason) where.push(ilike(dismissals.reason, `%${query.reason}%`));
  if (query.reasonCode) where.push(eq(dismissals.reasonCode, query.reasonCode));
  if (query.recruiterId) where.push(eq(candidates.recruiterId, query.recruiterId));
  if (query.coordinatorId) where.push(eq(candidates.coordinatorId, query.coordinatorId));
  if (query.projectId) where.push(eq(candidates.projectId, query.projectId));
  if (query.q) {
    const q = `%${query.q}%`;
    where.push(ilike(candidates.name, q));
  }
  if (query.dateFrom) where.push(gte(dismissals.dismissedAt, new Date(query.dateFrom)));
  if (query.dateTo) {
    const endOfDay = new Date(query.dateTo);
    endOfDay.setUTCHours(23, 59, 59, 999);
    where.push(lte(dismissals.dismissedAt, endOfDay));
  }
  const { since, until } = resolveDateRange({
    preset: query.preset,
    from: query.from,
    to: query.to,
  });
  if (since) where.push(gte(dismissals.dismissedAt, since));
  if (until) where.push(lt(dismissals.dismissedAt, until));
  if (scopeRecruiterId) where.push(eq(candidates.recruiterId, scopeRecruiterId));
  if (scopeCoordinatorId) where.push(eq(candidates.coordinatorId, scopeCoordinatorId));

  const condition = where.length ? and(...where) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  const itemsQuery = db
    .select({
      id: dismissals.id,
      candidateId: dismissals.candidateId,
      dismissedAt: dismissals.dismissedAt,
      reason: dismissals.reason,
      reasonCode: dismissals.reasonCode,
      recordedById: dismissals.recordedById,
      notes: dismissals.notes,
      createdAt: dismissals.createdAt,
      candidateName: candidates.name,
      candidateSource: candidates.source,
      reasonNote: candidates.reasonNote,
      workStartDate: candidates.workStartDate,
      recordedByFirstName: recordedBy.firstName,
      recordedByLastName: recordedBy.lastName,
      recruiterFirstName: recruiter.firstName,
      recruiterLastName: recruiter.lastName,
      coordinatorFirstName: coordinator.firstName,
      coordinatorLastName: coordinator.lastName,
      projectName: projects.name,
    })
    .from(dismissals)
    .leftJoin(candidates, eq(dismissals.candidateId, candidates.id))
    .leftJoin(recordedBy, eq(dismissals.recordedById, recordedBy.id))
    .leftJoin(recruiter, eq(candidates.recruiterId, recruiter.id))
    .leftJoin(coordinator, eq(candidates.coordinatorId, coordinator.id))
    .leftJoin(projects, eq(candidates.projectId, projects.id))
    .where(condition)
    .orderBy(desc(dismissals.dismissedAt))
    .limit(query.pageSize)
    .offset(offset);

  const totalQuery = db
    .select({ c: count() })
    .from(dismissals)
    .leftJoin(candidates, eq(dismissals.candidateId, candidates.id))
    .where(condition);

  const [rawItems, totalRow] = await Promise.all([itemsQuery, totalQuery.then((r) => r[0])]);

  const items: EnrichedDismissalRow[] = rawItems.map((r) => {
    const daysWorked =
      r.workStartDate && r.dismissedAt
        ? Math.max(
            0,
            Math.floor(
              (r.dismissedAt.getTime() - r.workStartDate.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;
    return { ...r, daysWorked } as EnrichedDismissalRow;
  });

  return { items, total: totalRow?.c ?? 0 };
}

// Same filters / scoping as `listEnriched`, but returns ALL matching rows
// (paginated only by `hardLimit`) for the CSV export endpoint. We intentionally
// reuse the same WHERE construction to keep export output in sync with what
// the operator sees in the registry table.
export async function listAllEnrichedForExport(
  query: ListDismissalsQuery,
  scopeRecruiterId: string | undefined,
  scopeCoordinatorId: string | undefined,
  hardLimit: number,
): Promise<EnrichedDismissalRow[]> {
  const where: SQL[] = [];

  const recordedBy = alias(users, 'recorded_by');
  const recruiter = alias(users, 'recruiter');
  const coordinator = alias(users, 'coordinator');

  if (query.candidateId) where.push(eq(dismissals.candidateId, query.candidateId));
  if (query.recordedById) where.push(eq(dismissals.recordedById, query.recordedById));
  if (query.source) where.push(eq(candidates.source, query.source as never));
  if (query.reason) where.push(ilike(dismissals.reason, `%${query.reason}%`));
  if (query.reasonCode) where.push(eq(dismissals.reasonCode, query.reasonCode));
  if (query.recruiterId) where.push(eq(candidates.recruiterId, query.recruiterId));
  if (query.coordinatorId) where.push(eq(candidates.coordinatorId, query.coordinatorId));
  if (query.projectId) where.push(eq(candidates.projectId, query.projectId));
  if (query.q) {
    const q = `%${query.q}%`;
    where.push(ilike(candidates.name, q));
  }
  if (query.dateFrom) where.push(gte(dismissals.dismissedAt, new Date(query.dateFrom)));
  if (query.dateTo) {
    const endOfDay = new Date(query.dateTo);
    endOfDay.setUTCHours(23, 59, 59, 999);
    where.push(lte(dismissals.dismissedAt, endOfDay));
  }
  const { since, until } = resolveDateRange({
    preset: query.preset,
    from: query.from,
    to: query.to,
  });
  if (since) where.push(gte(dismissals.dismissedAt, since));
  if (until) where.push(lt(dismissals.dismissedAt, until));
  if (scopeRecruiterId) where.push(eq(candidates.recruiterId, scopeRecruiterId));
  if (scopeCoordinatorId) where.push(eq(candidates.coordinatorId, scopeCoordinatorId));

  const condition = where.length ? and(...where) : undefined;

  const rawItems = await db
    .select({
      id: dismissals.id,
      candidateId: dismissals.candidateId,
      dismissedAt: dismissals.dismissedAt,
      reason: dismissals.reason,
      reasonCode: dismissals.reasonCode,
      recordedById: dismissals.recordedById,
      notes: dismissals.notes,
      createdAt: dismissals.createdAt,
      candidateName: candidates.name,
      candidateSource: candidates.source,
      reasonNote: candidates.reasonNote,
      workStartDate: candidates.workStartDate,
      recordedByFirstName: recordedBy.firstName,
      recordedByLastName: recordedBy.lastName,
      recruiterFirstName: recruiter.firstName,
      recruiterLastName: recruiter.lastName,
      coordinatorFirstName: coordinator.firstName,
      coordinatorLastName: coordinator.lastName,
      projectName: projects.name,
    })
    .from(dismissals)
    .leftJoin(candidates, eq(dismissals.candidateId, candidates.id))
    .leftJoin(recordedBy, eq(dismissals.recordedById, recordedBy.id))
    .leftJoin(recruiter, eq(candidates.recruiterId, recruiter.id))
    .leftJoin(coordinator, eq(candidates.coordinatorId, coordinator.id))
    .leftJoin(projects, eq(candidates.projectId, projects.id))
    .where(condition)
    .orderBy(desc(dismissals.dismissedAt))
    .limit(hardLimit);

  return rawItems.map((r) => {
    const daysWorked =
      r.workStartDate && r.dismissedAt
        ? Math.max(
            0,
            Math.floor(
              (r.dismissedAt.getTime() - r.workStartDate.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;
    return { ...r, daysWorked } as EnrichedDismissalRow;
  });
}
