import * as repo from '../repositories/tasks.repo';
import type { EnrichedTask } from '../repositories/tasks.repo';
import * as candidatesService from './candidates.service';
import * as audit from './audit.service';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors';
import { shouldScopeToRecruiter, shouldScopeToCoordinator } from '../lib/scope';
import type {
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
} from '@crm/shared';
import type { Task as TaskRow } from '../db/tables/tasks';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

// RBAC scope params for listTasks. Recruiter/coordinator sees tasks where:
//   assigneeId = me OR candidate.<their-fk> = me
// Admin/readonly: no scope (see all).
function resolveListScope(actor: Actor): {
  scopeAssigneeId?: string;
  scopeRecruiterId?: string;
  scopeCoordinatorId?: string;
} {
  if (shouldScopeToRecruiter(actor.role)) {
    return { scopeAssigneeId: actor.id, scopeRecruiterId: actor.id };
  }
  if (shouldScopeToCoordinator(actor.role)) {
    return { scopeAssigneeId: actor.id, scopeCoordinatorId: actor.id };
  }
  return {};
}

// Per-task visibility: delegate candidate-scope check to candidatesService.
// If the actor is the assignee, that's an authorization signal on its own —
// assignment grants visibility even if candidate scope changed afterwards.
// Standalone tasks (candidateId IS NULL) are visible to assignee + creator + admin.
async function assertCanSeeTask(task: TaskRow, actor: Actor): Promise<void> {
  if (task.assigneeId === actor.id) return;
  if (task.createdById === actor.id) return;
  if (actor.role === 'admin' || actor.role === 'readonly') return;
  if (!task.candidateId) {
    throw new NotFoundError('task');
  }
  await candidatesService.getCandidate(task.candidateId, actor);
}

export async function listTasks(
  query: ListTasksQuery,
  actor: Actor,
): Promise<{
  items: EnrichedTask[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const scope = resolveListScope(actor);
  const { items, total } = await repo.list({ query, ...scope });
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getTask(id: string, actor: Actor): Promise<EnrichedTask> {
  const row = await repo.findByIdEnriched(id);
  if (!row) throw new NotFoundError('task');
  await assertCanSeeTask(row, actor);
  return row;
}

export async function createTask(
  input: CreateTaskInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<TaskRow> {
  // Enforce candidate-scope RBAC only when a candidate link is provided.
  // Standalone tasks (no candidateId) skip this check — they're personal/admin
  // tasks created from the Tasks sidebar panel.
  if (input.candidateId) {
    await candidatesService.getCandidate(input.candidateId, actor);
  }

  // 2026-06-13 — only admins may create tasks for someone else. Recruiters /
  // coordinators / readonly users must pick themselves as the assignee. The
  // UI already mirrors this rule (AddTaskModal disables the Select for
  // non-admins) — this is the server-side safety net.
  if (actor.role !== 'admin' && input.assigneeId !== actor.id) {
    throw new AppError('FORBIDDEN', { reason: 'assignee_not_self' }, 403);
  }

  const status = input.status ?? 'new';
  const row = await repo.insert({
    candidateId: input.candidateId ?? null,
    assigneeId: input.assigneeId,
    // Type defaults to 'other' — the simplified UI no longer asks for it.
    type: input.type ?? 'other',
    title: input.title,
    description: input.description ?? null,
    status,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    doneAt: status === 'completed' ? new Date() : null,
    createdById: actor.id,
  });

  await audit.log({
    actorId: actor.id,
    action: 'create_task',
    entityType: 'task',
    entityId: row.id,
    newValue: {
      candidateId: row.candidateId,
      assigneeId: row.assigneeId,
      type: row.type,
      title: row.title,
      status: row.status,
      dueAt: row.dueAt,
    },
    ...ctx,
  });

  return row;
}

export async function updateTask(
  id: string,
  patch: UpdateTaskInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<TaskRow> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('task');
  await assertCanSeeTask(existing, actor);

  if (patch.assigneeId !== undefined && actor.role !== 'admin' && patch.assigneeId !== actor.id) {
    throw new AppError('FORBIDDEN', { reason: 'assignee_not_self' }, 403);
  }

  // Compute the field-level patch with proper Date conversions.
  const updates: Partial<TaskRow> = {};
  if (patch.assigneeId !== undefined) updates.assigneeId = patch.assigneeId;
  if (patch.type !== undefined) updates.type = patch.type;
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description ?? null;
  if (patch.dueAt !== undefined) updates.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;

  // Sync status <-> doneAt. status='completed' stamps doneAt; any other status
  // clears it. Frontend may still send doneAt directly (legacy toggle path) —
  // we mirror it back into status so the two stay consistent.
  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status === 'completed') {
      updates.doneAt = existing.doneAt ?? new Date();
    } else {
      updates.doneAt = null;
    }
  } else if (patch.doneAt !== undefined) {
    const next = patch.doneAt ? new Date(patch.doneAt) : null;
    updates.doneAt = next;
    updates.status = next ? 'completed' : existing.status === 'completed' ? 'new' : existing.status;
  }

  if (Object.keys(updates).length === 0) return existing;

  const updated = await repo.update(id, updates);
  if (!updated) throw new NotFoundError('task');

  // Audit diff: only fields that actually changed.
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(updates) as (keyof TaskRow)[]) {
    if (existing[key] !== updated[key]) {
      oldValue[key] = existing[key];
      newValue[key] = updated[key];
    }
  }
  if (Object.keys(newValue).length > 0) {
    await audit.log({
      actorId: actor.id,
      action: 'update_task',
      entityType: 'task',
      entityId: id,
      oldValue,
      newValue,
      ...ctx,
    });
  }

  return updated;
}

export async function deleteTask(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('task');

  // Admin OR creator may delete. Visibility scope intentionally NOT applied
  // here — once a recruiter creates a task, they can clean it up even if
  // their access to the candidate later changed (mirrors candidate-comments).
  if (actor.role !== 'admin' && existing.createdById !== actor.id) {
    throw new ForbiddenError('not your task');
  }

  // Audit BEFORE remove (RODO traceability — docs/Engineering_Rules.md).
  await audit.log({
    actorId: actor.id,
    action: 'delete_task',
    entityType: 'task',
    entityId: id,
    oldValue: {
      candidateId: existing.candidateId,
      assigneeId: existing.assigneeId,
      type: existing.type,
      title: existing.title,
      dueAt: existing.dueAt,
      doneAt: existing.doneAt,
    },
    ...ctx,
  });

  await repo.remove(id);
}
