import * as repo from '../repositories/status-lookups.repo';
import * as audit from './audit.service';
import { TtlCache } from '../lib/ttl-cache';
import { AppError, NotFoundError } from '../lib/errors';
import type {
  CreateStatusLookupInput,
  StatusLookupType,
  UpdateStatusLookupInput,
} from '@opushr/shared';
import type { StatusLookup } from '../db/tables/status-lookups';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

// The taxonomy changes perhaps monthly but is read on every page load. A
// 5-minute TTL with single-flight means a burst of page opens costs one query
// instead of one per hook per user; every mutation below busts it explicitly
// so an admin edit shows up immediately rather than after the TTL.
const ALL_KEY = 'all';
const lookupCache = new TtlCache<Record<string, StatusLookup[]>>(5 * 60_000);

export function bustLookupCache(): void {
  lookupCache.delete(ALL_KEY);
}

// Test-only reset — the cache is module state and Vitest does not reset module
// registries between tests in this suite.
export function __resetLookupCache(): void {
  lookupCache.clear();
}

export async function listAllActive(): Promise<Record<string, StatusLookup[]>> {
  const cached = await lookupCache.getOrLoad(ALL_KEY, async () => {
    const rows = await repo.listAllActiveGrouped();
    const grouped: Record<string, StatusLookup[]> = {};
    for (const r of rows) {
      (grouped[r.type] ??= []).push(r);
    }
    return grouped;
  });
  return cached ?? {};
}

export async function listActive(type: StatusLookupType): Promise<StatusLookup[]> {
  return repo.listActive(type);
}

export async function listAll(type: StatusLookupType): Promise<StatusLookup[]> {
  return repo.listAll(type);
}

export async function listDeleted(): Promise<StatusLookup[]> {
  return repo.listDeleted();
}

export async function findById(id: string): Promise<StatusLookup | undefined> {
  return repo.findById(id);
}

export async function getUsage(type: StatusLookupType, code: string): Promise<number> {
  return repo.getUsageCount(type, code);
}

export async function create(
  input: CreateStatusLookupInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<StatusLookup> {
  const existing = await repo.findActiveByTypeAndCode(input.type, input.code);
  if (existing) {
    throw new AppError(
      'DUPLICATE',
      { entity: 'status_lookup', type: input.type, code: input.code },
      409,
    );
  }

  const row = await repo.insert({
    type: input.type,
    code: input.code,
    labelPl: input.labelPl,
    labelUa: input.labelUa,
    groupKey: input.groupKey ?? null,
    sortOrder: input.sortOrder,
    isSystem: false,
    createdById: actor.id,
  });

  await audit.log({
    actorId: actor.id,
    action: 'create_status_lookup',
    entityType: 'status_lookup',
    entityId: row.id,
    newValue: {
      type: row.type,
      code: row.code,
      labelPl: row.labelPl,
      labelUa: row.labelUa,
      sortOrder: row.sortOrder,
    },
    ...ctx,
  });

  bustLookupCache();
  return row;
}

export async function update(
  id: string,
  patch: UpdateStatusLookupInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<StatusLookup> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('status_lookup');

  const row = await repo.update(id, patch);
  if (!row) throw new NotFoundError('status_lookup');

  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    oldValue[key] = (existing as Record<string, unknown>)[key as string];
    newValue[key] = (row as Record<string, unknown>)[key as string];
  }

  await audit.log({
    actorId: actor.id,
    action: 'update_status_lookup',
    entityType: 'status_lookup',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  bustLookupCache();
  return row;
}

export async function softDelete(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ row: StatusLookup; usageCount: number }> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('status_lookup');
  if (existing.deletedAt) throw new AppError('VALIDATION', { reason: 'already_deleted' }, 409);

  // System codes (facebook, instagram, …) are part of the taxonomy contract
  // shared with the sidebar filter chips + analytics groupings. Soft-deleting
  // one silently breaks those surfaces, so block — admins can hide via UI
  // ordering but the row stays alive.
  if (existing.isSystem) {
    throw new AppError('FORBIDDEN', { reason: 'system_default_cannot_be_deleted' }, 409);
  }

  // 2026-06-12: usage count is still computed for the audit trail + return
  // value (so the UI can flash "N referenced rows now show as Unknown"), but
  // it no longer blocks soft-delete. Orphaned codes on candidates are
  // intentionally allowed — pickLabel + SourceBreakdown render them as
  // "Невідомо/Nieznane" instead of raw code so the surface stays clean.
  const usageCount = await repo.getUsageCount(
    existing.type as StatusLookupType,
    existing.code,
  );

  // Audit BEFORE remove (docs/Engineering_Rules.md) — soft-delete is still a state
  // change that must survive failures.
  await audit.log({
    actorId: actor.id,
    action: 'soft_delete_status_lookup',
    entityType: 'status_lookup',
    entityId: id,
    oldValue: {
      type: existing.type,
      code: existing.code,
      labelPl: existing.labelPl,
      labelUa: existing.labelUa,
      isSystem: existing.isSystem,
      usageCount,
    },
    ...ctx,
  });

  const row = await repo.softDelete(id);
  if (!row) throw new NotFoundError('status_lookup');
  bustLookupCache();
  return { row, usageCount };
}

export async function restore(id: string, actor: Actor, ctx: ReqCtx): Promise<StatusLookup> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('status_lookup');
  if (!existing.deletedAt) {
    throw new AppError('VALIDATION', { reason: 'not_deleted' }, 409);
  }

  // Reject restore when an active row with the same (type, code) already
  // exists — the partial unique index would block it anyway, but we surface
  // a clean conflict instead of a 500.
  const conflict = await repo.findActiveByTypeAndCode(
    existing.type as StatusLookupType,
    existing.code,
  );
  if (conflict) {
    throw new AppError(
      'DUPLICATE',
      { reason: 'active_code_exists', code: existing.code },
      409,
    );
  }

  const row = await repo.restore(id);
  if (!row) throw new NotFoundError('status_lookup');

  await audit.log({
    actorId: actor.id,
    action: 'restore_status_lookup',
    entityType: 'status_lookup',
    entityId: id,
    newValue: { type: row.type, code: row.code },
    ...ctx,
  });

  bustLookupCache();
  return row;
}

export async function hardDelete(id: string, actor: Actor, ctx: ReqCtx): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('status_lookup');

  if (existing.isSystem) {
    throw new AppError('FORBIDDEN', { reason: 'system_default_cannot_be_hard_deleted' }, 409);
  }

  const usageCount = await repo.getUsageCount(
    existing.type as StatusLookupType,
    existing.code,
  );
  if (usageCount > 0) {
    throw new AppError('HAS_REFERENCES', { usageCount, code: existing.code }, 409);
  }

  // Audit BEFORE remove (docs/Engineering_Rules.md).
  await audit.log({
    actorId: actor.id,
    action: 'hard_delete_status_lookup',
    entityType: 'status_lookup',
    entityId: id,
    oldValue: {
      type: existing.type,
      code: existing.code,
      labelPl: existing.labelPl,
      labelUa: existing.labelUa,
    },
    ...ctx,
  });

  await repo.hardDelete(id);
  bustLookupCache();
}
