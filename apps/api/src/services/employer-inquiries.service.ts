import type { EmployerInquiry } from '../db/tables/employer-inquiries';
import * as repo from '../repositories/employer-inquiries.repo';
import * as audit from './audit.service';
import { NotFoundError, ForbiddenError, AppError } from '../lib/errors';
import type {
  CreateEmployerInquiryInput,
  ListEmployerInquiriesQuery,
  SubmitEmployerInquiryInput,
  UpdateEmployerInquiryInput,
} from '@opushr/shared';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

const SPAM_THRESHOLD_24H = 5;

export async function listInquiries(
  query: ListEmployerInquiriesQuery,
  _actor: Actor,
): Promise<{ items: EmployerInquiry[]; total: number; page: number; pageSize: number }> {
  const { items, total } = await repo.list(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getInquiry(id: string, _actor: Actor): Promise<EmployerInquiry> {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('employer_inquiry');
  return row;
}

// Public submission — called from website form. No auth required.
// Performs basic anti-spam check (rate-limit by email/IP).
export async function submitFromPublic(
  input: SubmitEmployerInquiryInput,
  ctx: ReqCtx,
): Promise<{ id: string }> {
  const recent = await repo.recentSubmissionsCount(input.email, ctx.ip);
  if (recent >= SPAM_THRESHOLD_24H) {
    throw new AppError('VALIDATION', { reason: 'rate_limit_exceeded' }, 429);
  }

  const row = await repo.insert({
    companyName: input.companyName,
    contactPerson: input.contactPerson,
    email: input.email,
    phone: input.phone,
    message: input.message,
    privacyAccepted: true,
    status: 'new',
    source: 'web',
    ipAddress: ctx.ip,
    userAgent: ctx.userAgent,
  });

  await audit.log({
    actorId: null,
    action: 'submit_employer_inquiry',
    entityType: 'employer_inquiry',
    entityId: row.id,
    newValue: { companyName: row.companyName, email: row.email, source: 'web' },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { id: row.id };
}

export async function createInquiry(
  input: CreateEmployerInquiryInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<EmployerInquiry> {
  if (actor.role === 'readonly') throw new ForbiddenError('readonly cannot create');

  const row = await repo.insert({
    companyName: input.companyName,
    contactPerson: input.contactPerson,
    email: input.email,
    phone: input.phone,
    message: input.message,
    privacyAccepted: input.privacyAccepted,
    status: 'new',
    source: input.source,
    internalNotes: input.internalNotes ?? null,
  });

  await audit.log({
    actorId: actor.id,
    action: 'create_employer_inquiry',
    entityType: 'employer_inquiry',
    entityId: row.id,
    newValue: { companyName: row.companyName, email: row.email, source: row.source },
    ...ctx,
  });

  return row;
}

export async function updateInquiry(
  id: string,
  patch: UpdateEmployerInquiryInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<EmployerInquiry> {
  if (actor.role === 'readonly') throw new ForbiddenError('readonly cannot update');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('employer_inquiry');

  const dbPatch: Record<string, unknown> = { ...patch };

  // Lifecycle timestamps
  if (patch.status && patch.status !== existing.status) {
    if (patch.status === 'contacted' && !existing.contactedAt) {
      dbPatch.contactedAt = new Date();
    }
    if (
      (patch.status === 'accepted' || patch.status === 'rejected' || patch.status === 'archived') &&
      !existing.closedAt
    ) {
      dbPatch.closedAt = new Date();
    }
  }

  const row = await repo.update(id, dbPatch as never);
  if (!row) throw new NotFoundError('employer_inquiry');

  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    oldValue[key] = (existing as Record<string, unknown>)[key as string];
    newValue[key] = (row as Record<string, unknown>)[key as string];
  }

  await audit.log({
    actorId: actor.id,
    action: 'update_employer_inquiry',
    entityType: 'employer_inquiry',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  return row;
}

export async function deleteInquiry(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<void> {
  if (actor.role !== 'admin') throw new ForbiddenError('admin only');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('employer_inquiry');

  // Audit BEFORE delete — never lose the trail if the audit insert fails.
  await audit.log({
    actorId: actor.id,
    action: 'delete_employer_inquiry',
    entityType: 'employer_inquiry',
    entityId: id,
    oldValue: { companyName: existing.companyName, email: existing.email },
    ...ctx,
  });

  await repo.remove(id);
}
