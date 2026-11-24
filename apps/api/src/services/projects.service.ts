import type { Project } from '../db/tables/projects';
import * as repo from '../repositories/projects.repo';
import type { ProjectWithMetrics } from '../repositories/projects.repo';
import * as audit from './audit.service';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors';
import type {
  CreateProjectInput,
  ListProjectsQuery,
  UpdateProjectInput,
} from '@crm/shared';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

export async function listProjects(
  query: ListProjectsQuery,
  actor: Actor,
): Promise<{
  items: ProjectWithMetrics[];
  total: number;
  page: number;
  pageSize: number;
}> {
  // Projects themselves are shared (every user sees the same list of
  // projects), but the per-project staffing metric — foundCount / missingCount
  // / percentFilled — is filtered to the actor's own candidates so the
  // progress bar reflects THEIR contribution. Admin sees the global metric.
  const scope = {
    recruiterId: actor.role === 'recruiter' ? actor.id : undefined,
    coordinatorId: actor.role === 'coordinator' ? actor.id : undefined,
  };
  const { items, total } = await repo.list(query, scope);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getProject(id: string, _actor: Actor): Promise<Project> {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('project');
  return row;
}

export async function createProject(
  input: CreateProjectInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<Project> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const existing = await repo.findByName(input.name);
  if (existing) {
    throw new AppError('DUPLICATE', { id: existing.id, name: existing.name }, 409);
  }

  const row = await repo.insert({
    name: input.name,
    isActive: input.isActive,
    notes: input.notes ?? null,
    headcountNeeded: input.headcountNeeded,
    startDate: input.startDate ?? null,
  });

  await audit.log({
    actorId: actor.id,
    action: 'create_project',
    entityType: 'project',
    entityId: row.id,
    newValue: {
      name: row.name,
      isActive: row.isActive,
      headcountNeeded: row.headcountNeeded,
      startDate: row.startDate,
    },
    ...ctx,
  });

  return row;
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<Project> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('project');

  if (patch.name && patch.name !== existing.name) {
    const dup = await repo.findByName(patch.name);
    if (dup) throw new AppError('DUPLICATE', { id: dup.id, name: dup.name }, 409);
  }

  // Staffing baseline reset: bump headcount_reset_at only when the inputs
  // that materially change "what the client needs" move. Touching notes or
  // isActive does NOT reset the baseline.
  const headcountChanged =
    patch.headcountNeeded !== undefined && patch.headcountNeeded !== existing.headcountNeeded;
  const startDateChanged =
    patch.startDate !== undefined && (patch.startDate ?? null) !== existing.startDate;
  const shouldResetBaseline = headcountChanged || startDateChanged;

  const updatePayload: Partial<typeof existing> & { headcountResetAt?: Date } = {
    ...(patch as Partial<typeof existing>),
  };
  if (shouldResetBaseline) {
    updatePayload.headcountResetAt = new Date();
  }

  const row = await repo.update(id, updatePayload as never);
  if (!row) throw new NotFoundError('project');

  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    oldValue[key] = (existing as Record<string, unknown>)[key as string];
    newValue[key] = (row as Record<string, unknown>)[key as string];
  }
  if (shouldResetBaseline) {
    oldValue.headcountResetAt = existing.headcountResetAt;
    newValue.headcountResetAt = row.headcountResetAt;
  }

  await audit.log({
    actorId: actor.id,
    action: 'update_project',
    entityType: 'project',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  return row;
}

export async function deleteProject(id: string, actor: Actor, ctx: ReqCtx): Promise<void> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('project');

  // Audit BEFORE remove so the trail survives FK violations.
  await audit.log({
    actorId: actor.id,
    action: 'delete_project',
    entityType: 'project',
    entityId: id,
    oldValue: { name: existing.name },
    ...ctx,
  });

  try {
    await repo.remove(id);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === '23503') {
      // Foreign key violation — soft-delete via isActive=false instead.
      throw new AppError(
        'HAS_REFERENCES',
        { hint: 'mark inactive instead of deleting' },
        409,
      );
    }
    throw err;
  }
}
