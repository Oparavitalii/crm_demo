import type { Dismissal } from '../db/tables/dismissals';
import * as repo from '../repositories/dismissals.repo';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as periodsRepo from '../repositories/employment-periods.repo';
import * as audit from './audit.service';
import { NotFoundError, ForbiddenError } from '../lib/errors';
import * as candidatesService from './candidates.service';
import type {
  CreateDismissalInput,
  ListDismissalsQuery,
  UpdateDismissalInput,
} from '@crm/shared';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

async function assertCandidateAccess(candidateId: string, actor: Actor): Promise<void> {
  await candidatesService.getCandidate(candidateId, actor);
}

export async function listDismissals(
  query: ListDismissalsQuery,
  actor: Actor,
): Promise<{ items: Dismissal[]; total: number; page: number; pageSize: number }> {
  if (query.candidateId) {
    await assertCandidateAccess(query.candidateId, actor);
  } else if (actor.role === 'recruiter') {
    return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
  }

  const { items, total } = await repo.list(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function listEnrichedDismissals(
  query: ListDismissalsQuery,
  actor: Actor,
): Promise<{
  items: repo.EnrichedDismissalRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  // FAZA 20 scope: recruiters see dismissals of their own candidates,
  // coordinators see dismissals of clients they manage. Admin sees all.
  const scopeRecruiterId = actor.role === 'recruiter' ? actor.id : undefined;
  const scopeCoordinatorId = actor.role === 'coordinator' ? actor.id : undefined;
  const { items, total } = await repo.listEnriched(query, scopeRecruiterId, scopeCoordinatorId);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

// Hard cap to avoid OOM if someone exports the entire dataset without filters.
// 10k rows × ~9 cells ≈ a few MB workbook — comfortably safe.
const EXPORT_HARD_LIMIT = 10_000;

function toDateOrNull(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function joinName(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ''} ${last ?? ''}`.trim();
}

export async function exportDismissalsXlsx(
  query: ListDismissalsQuery,
  actor: Actor,
): Promise<{ buffer: ArrayBuffer; rowCount: number }> {
  // Same RBAC scoping as the registry list endpoint.
  const scopeRecruiterId = actor.role === 'recruiter' ? actor.id : undefined;
  const scopeCoordinatorId = actor.role === 'coordinator' ? actor.id : undefined;

  const items = await repo.listAllEnrichedForExport(
    query,
    scopeRecruiterId,
    scopeCoordinatorId,
    EXPORT_HARD_LIMIT,
  );

  // exceljs is one of the largest packages in the dependency list and is used
  // by this one export. index.ts imports every router eagerly, so a static
  // import here keeps it resident in every request-serving process for the
  // life of the machine — memory the request path never gets back on a box
  // that had 13 MB free after three days of uptime on 2026-07-28.
  const { default: ExcelJS } = await import('exceljs');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CRM Demo';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Dismissals');

  // Header in Polish per spec; widths tuned for the visible content.
  worksheet.columns = [
    { header: 'Imię i nazwisko', key: 'candidate', width: 24 },
    { header: 'Projekt', key: 'project', width: 20 },
    { header: 'Data zatrudnienia', key: 'employedAt', width: 16, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Data zwolnienia', key: 'dismissedAt', width: 16, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Kod powodu', key: 'reasonCode', width: 14 },
    { header: 'Powód', key: 'reason', width: 28 },
    { header: 'Notatki', key: 'notes', width: 32 },
    { header: 'Zarejestrował', key: 'recordedBy', width: 22 },
    { header: 'Koordynator', key: 'coordinator', width: 22 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF2F2F2' },
  };
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  // Auto-filter on the header row, all 9 columns (A..I).
  worksheet.autoFilter = { from: 'A1', to: 'I1' };

  // Freeze the header row so it stays visible while scrolling.
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  for (const r of items) {
    worksheet.addRow({
      candidate: r.candidateName ?? '',
      project: r.projectName ?? '',
      employedAt: toDateOrNull(r.workStartDate),
      dismissedAt: toDateOrNull(r.dismissedAt),
      reasonCode: r.reasonCode ?? '',
      reason: r.reason ?? '',
      notes: r.notes ?? '',
      recordedBy: joinName(r.recordedByFirstName, r.recordedByLastName),
      coordinator: joinName(r.coordinatorFirstName, r.coordinatorLastName),
    });
  }

  // ExcelJS declares its own `Buffer extends ArrayBuffer` interface that gets
  // merged with `@types/node`'s `Buffer`. At runtime the value IS a Node Buffer
  // (a Uint8Array subclass over an ArrayBuffer). We narrow via `unknown` and
  // slice to a freshly-allocated ArrayBuffer so the body has no stray bytes
  // from any pooled allocator.
  const raw = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return { buffer: ab, rowCount: items.length };
}

export async function getDismissal(id: string, actor: Actor): Promise<Dismissal> {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('dismissal');

  if (actor.role === 'recruiter') {
    await assertCandidateAccess(row.candidateId, actor);
  }

  return row;
}

export async function createDismissal(
  input: CreateDismissalInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<Dismissal> {
  await assertCandidateAccess(input.candidateId, actor);

  const dismissedAt = new Date(input.dismissedAt);

  const row = await repo.insert({
    candidateId: input.candidateId,
    dismissedAt,
    reason: input.reason,
    reasonCode: input.reasonCode ?? null,
    recordedById: actor.id,
    notes: input.notes ?? null,
  });

  // mcp_test M12: registry-side dismissal create must sync the candidate
  // lifecycle (status, dates, housing) so reports keyed on candidates.status
  // see the dismissal — without this, /dismissals/* and /candidates/:id
  // diverge silently. `dismissCandidate` does the same sync when invoked from
  // the lifecycle endpoint. Close any open employment period (no-op when none
  // open) so analytics aren't left hanging.
  await periodsRepo.closeOpen(input.candidateId, dismissedAt, row.reasonCode ?? row.reason ?? null);
  const candidateUpdated = await candidatesRepo.update(input.candidateId, {
    status: 'dismissed',
    workEndDate: dismissedAt,
    workEndReason: row.reasonCode ?? row.reason ?? null,
    housingType: null,
  });

  await audit.log({
    actorId: actor.id,
    action: 'create_dismissal',
    entityType: 'dismissal',
    entityId: row.id,
    newValue: { candidateId: row.candidateId, reason: row.reason, dismissedAt: row.dismissedAt },
    ...ctx,
  });

  // Separate audit row for the candidate state change — same pattern as
  // candidates.service.dismissCandidate (RODO trail per entity).
  if (candidateUpdated) {
    await audit.log({
      actorId: actor.id,
      action: 'dismiss_candidate',
      entityType: 'candidate',
      entityId: input.candidateId,
      newValue: {
        dismissedAt: dismissedAt.toISOString(),
        viaDismissalRowId: row.id,
      },
      ...ctx,
    });
  }

  return row;
}

export async function updateDismissal(
  id: string,
  patch: UpdateDismissalInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<Dismissal> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('dismissal');

  // Per spec: coordinator can fully manage placements/dismissals (create/read/update/delete is restricted to admin).
  // Recruiters are scoped to their own candidates.
  if (actor.role === 'recruiter') {
    await assertCandidateAccess(existing.candidateId, actor);
  }

  const dbPatch: Record<string, unknown> = {};
  if (patch.dismissedAt !== undefined) dbPatch.dismissedAt = new Date(patch.dismissedAt);
  if (patch.reason !== undefined) dbPatch.reason = patch.reason;
  if (patch.reasonCode !== undefined) dbPatch.reasonCode = patch.reasonCode;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;

  const row = await repo.update(id, dbPatch as never);
  if (!row) throw new NotFoundError('dismissal');

  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(dbPatch)) {
    oldValue[key] = (existing as Record<string, unknown>)[key];
    newValue[key] = (row as Record<string, unknown>)[key];
  }

  await audit.log({
    actorId: actor.id,
    action: 'update_dismissal',
    entityType: 'dismissal',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  // Mirror the correction onto the candidate's denormalized exit date and the
  // employment period. createDismissal writes candidates.workEndDate =
  // dismissedAt and closes the period; editing ONLY the dismissal row would
  // leave the candidate card/list/detail showing the stale date ("дата виходу
  // не виправляється"). We only sync when this dismissal is the operative one —
  // the candidate is currently dismissed and its workEndDate equals this
  // dismissal's previous date — so editing an older historical dismissal (after
  // a re-hire) never clobbers the current exit date.
  const dateChanged =
    patch.dismissedAt !== undefined && existing.dismissedAt.getTime() !== row.dismissedAt.getTime();
  const reasonChanged = patch.reason !== undefined || patch.reasonCode !== undefined;
  if (dateChanged || reasonChanged) {
    const candidate = await candidatesRepo.findById(existing.candidateId);
    const isOperative =
      candidate?.status === 'dismissed' &&
      candidate.workEndDate instanceof Date &&
      candidate.workEndDate.getTime() === existing.dismissedAt.getTime();
    if (isOperative) {
      const newReason = row.reasonCode ?? row.reason ?? null;
      await candidatesRepo.update(existing.candidateId, {
        workEndDate: row.dismissedAt,
        workEndReason: newReason,
      });
      await periodsRepo.adjustClosedDismissal(
        existing.candidateId,
        existing.dismissedAt,
        row.dismissedAt,
        newReason,
      );
      await audit.log({
        actorId: actor.id,
        action: 'dismiss_candidate',
        entityType: 'candidate',
        entityId: existing.candidateId,
        oldValue: { workEndDate: existing.dismissedAt.toISOString() },
        newValue: {
          workEndDate: row.dismissedAt.toISOString(),
          workEndReason: newReason,
          viaDismissalRowId: row.id,
          corrected: true,
        },
        ...ctx,
      });
    }
  }

  return row;
}

export async function deleteDismissal(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<void> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('dismissal');

  // Audit BEFORE delete — never lose the trail if the audit insert fails.
  await audit.log({
    actorId: actor.id,
    action: 'delete_dismissal',
    entityType: 'dismissal',
    entityId: id,
    oldValue: { candidateId: existing.candidateId, reason: existing.reason },
    ...ctx,
  });

  await repo.remove(id);
}
