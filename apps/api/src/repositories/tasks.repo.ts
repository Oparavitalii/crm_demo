import { alias } from 'drizzle-orm/pg-core';
import {
  and,
  count,
  desc,
  eq,
  isNull,
  isNotNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/client';
import { tasks, type Task, type NewTask } from '../db/tables/tasks';
import { users } from '../db/tables/users';
import { candidates } from '../db/tables/candidates';
import type { ListTasksQuery } from '@crm/shared';

export type EnrichedTask = Task & {
  assigneeFirstName: string | null;
  assigneeLastName: string | null;
  candidateFirstName: string | null;
  candidateLastName: string | null;
  createdByFirstName: string | null;
  createdByLastName: string | null;
};

export interface ListFilter {
  query: ListTasksQuery;
  // Scope params applied at SERVICE level for RBAC. The recruiter/coordinator
  // sees tasks assigned to them OR on candidates they own (OR'd in WHERE).
  scopeAssigneeId?: string;
  scopeRecruiterId?: string;
  scopeCoordinatorId?: string;
}

// Returns end-of-today (23:59:59.999) in UTC. Used by dueTodayOnly filter to
// surface tasks due before midnight UTC. Agency is PL+UA but timestamps in DB
// are timestamptz so this is a deliberate UTC boundary; the frontend can do
// a local check if it needs PL-time accuracy.
function endOfTodayUtc(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

export async function list(f: ListFilter): Promise<{ items: EnrichedTask[]; total: number }> {
  const assignee = alias(users, 'assignee');
  // Second alias on users so we can surface the creator's name without
  // colliding with the assignee join. Both joins are cheap on a small users
  // table and avoid an N+1 lookup from the frontend.
  const creator = alias(users, 'creator');

  const where: SQL[] = [];

  if (f.query.candidateId) where.push(eq(tasks.candidateId, f.query.candidateId));
  if (f.query.assigneeId) where.push(eq(tasks.assigneeId, f.query.assigneeId));
  if (f.query.type) where.push(eq(tasks.type, f.query.type));
  if (f.query.status) where.push(eq(tasks.status, f.query.status));

  if (f.query.state === 'open') where.push(isNull(tasks.doneAt));
  else if (f.query.state === 'done') where.push(isNotNull(tasks.doneAt));

  if (f.query.overdueOnly) {
    where.push(isNull(tasks.doneAt));
    where.push(lt(tasks.dueAt, sql`now()`));
  }
  if (f.query.dueTodayOnly) {
    where.push(isNull(tasks.doneAt));
    where.push(lt(tasks.dueAt, endOfTodayUtc()));
  }

  // RBAC scope: OR across the 3 signals. Recruiter sees tasks where
  // (assigneeId = me) OR (candidate.recruiterId = me). Coordinator: same
  // but with coordinatorId. Admin/readonly pass no scope params.
  const scopeClauses: SQL[] = [];
  if (f.scopeAssigneeId) scopeClauses.push(eq(tasks.assigneeId, f.scopeAssigneeId));
  if (f.scopeRecruiterId) scopeClauses.push(eq(candidates.recruiterId, f.scopeRecruiterId));
  if (f.scopeCoordinatorId) scopeClauses.push(eq(candidates.coordinatorId, f.scopeCoordinatorId));
  if (scopeClauses.length > 0) {
    where.push(or(...scopeClauses)!);
  }

  const condition = where.length ? and(...where) : undefined;
  const offset = (f.query.page - 1) * f.query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: tasks.id,
        candidateId: tasks.candidateId,
        assigneeId: tasks.assigneeId,
        type: tasks.type,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        dueAt: tasks.dueAt,
        doneAt: tasks.doneAt,
        createdById: tasks.createdById,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        assigneeFirstName: assignee.firstName,
        assigneeLastName: assignee.lastName,
        // 2026-06-12 leads/name refactor: candidates.first_name + last_name
        // collapsed into a single `name` column. We keep the
        // `candidateFirstName` / `candidateLastName` shape on EnrichedTask (and
        // in shared schema) so the frontend Phase-2 migration is decoupled —
        // pack the full name into firstName and leave lastName null. Display
        // formatters use `${first} ${last}`.trim() which keeps rendering OK.
        candidateFirstName: candidates.name,
        candidateLastName: sql<string | null>`NULL`,
        createdByFirstName: creator.firstName,
        createdByLastName: creator.lastName,
      })
      .from(tasks)
      .leftJoin(assignee, eq(tasks.assigneeId, assignee.id))
      .leftJoin(creator, eq(tasks.createdById, creator.id))
      .leftJoin(candidates, eq(tasks.candidateId, candidates.id))
      .where(condition)
      // Open tasks first (doneAt IS NULL); within those, closest due date first
      // (NULL dueAt sinks to the bottom); fallback: newest created first.
      .orderBy(
        sql`${tasks.doneAt} ASC NULLS FIRST`,
        sql`${tasks.dueAt} ASC NULLS LAST`,
        desc(tasks.createdAt),
      )
      .limit(f.query.pageSize)
      .offset(offset),
    db
      .select({ c: count() })
      .from(tasks)
      .leftJoin(candidates, eq(tasks.candidateId, candidates.id))
      .where(condition)
      .then((r) => r[0]),
  ]);

  return { items: rows as EnrichedTask[], total: totalRow?.c ?? 0 };
}

export async function findById(id: string): Promise<Task | undefined> {
  return db.query.tasks.findFirst({ where: eq(tasks.id, id) });
}

// Same projection as list() but filtered to a single task id. Used by
// getTask in the service so the detail view hydrates assignee/candidate/
// creator names in ONE round-trip instead of findById + list (2 trips).
export async function findByIdEnriched(id: string): Promise<EnrichedTask | undefined> {
  const assignee = alias(users, 'assignee');
  const creator = alias(users, 'creator');
  const [row] = await db
    .select({
      id: tasks.id,
      candidateId: tasks.candidateId,
      assigneeId: tasks.assigneeId,
      type: tasks.type,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      dueAt: tasks.dueAt,
      doneAt: tasks.doneAt,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      assigneeFirstName: assignee.firstName,
      assigneeLastName: assignee.lastName,
      candidateFirstName: candidates.name,
      candidateLastName: sql<string | null>`NULL`,
      createdByFirstName: creator.firstName,
      createdByLastName: creator.lastName,
    })
    .from(tasks)
    .leftJoin(assignee, eq(tasks.assigneeId, assignee.id))
    .leftJoin(creator, eq(tasks.createdById, creator.id))
    .leftJoin(candidates, eq(tasks.candidateId, candidates.id))
    .where(eq(tasks.id, id))
    .limit(1);
  return row as EnrichedTask | undefined;
}

export async function insert(input: NewTask): Promise<Task> {
  const [row] = await db.insert(tasks).values(input).returning();
  if (!row) throw new Error('Failed to insert task');
  return row;
}

export async function update(id: string, patch: Partial<NewTask>): Promise<Task | undefined> {
  const [row] = await db
    .update(tasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(tasks).where(eq(tasks.id, id));
  return (result.rowCount ?? 0) > 0;
}
