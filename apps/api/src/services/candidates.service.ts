import type {
  Candidate as CandidateRow,
} from '../db/tables/candidates';
import { db } from '../db/client';
import { env } from '../env';
import * as repo from '../repositories/candidates.repo';
import * as periodsRepo from '../repositories/employment-periods.repo';
import * as dismissalsRepo from '../repositories/dismissals.repo';
import * as usersRepo from '../repositories/users.repo';
import * as consentsRepo from '../repositories/consents.repo';
import { consents } from '../db/tables/consents';
import * as audit from './audit.service';
import { sendWelcomeEmailOnCreate } from './onboarding.service';
import { sendConsentRequestEmail } from './email.service';
import { AppError, ERROR_CODES, NotFoundError } from '../lib/errors';
import { normalizeEmail, normalizeName, normalizePhone } from '../lib/normalize';
import { shouldScopeToRecruiter, shouldScopeToCoordinator } from '../lib/scope';
import {
  CONSENT_SOURCES,
  CONSENT_TYPES,
  CONSENT_VERSIONS,
  type AdminSetConsentInput,
  type CancelCandidateInput,
  type CandidateStatus,
  type CreateCandidateInput,
  type DismissCandidateInput,
  type HireCandidateInput,
  type ListCandidatesQuery,
  type RehireCandidateInput,
  type SubmitPublicCandidateInput,
  type UpdateCandidateInput,
} from '@opushr/shared';

export type EnrichedCandidate = CandidateRow & {
  recruiterFirstName: string | null;
  recruiterLastName: string | null;
  coordinatorFirstName: string | null;
  coordinatorLastName: string | null;
  freelancerFirstName: string | null;
  freelancerLastName: string | null;
  projectName: string | null;
  // Present on the single-record path (getCandidate → findByIdEnriched); the
  // report-style list (findFailedCandidates) leaves them undefined.
  rodoConsent?: boolean;
  emailConsent?: boolean;
  smsConsent?: boolean;
};

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

function canSee(c: CandidateRow, user: Actor): boolean {
  // Admins / readonly users see everyone.
  // Recruiters: strict own-only (2026-06-11) — recruiterId must equal user.id.
  //   Unassigned candidates (recruiterId === null) are NOT visible; admin must
  //   assign an owner first.
  // Coordinators: strict own-only — FAZA 28.
  if (shouldScopeToRecruiter(user.role)) {
    return c.recruiterId === user.id;
  }
  if (shouldScopeToCoordinator(user.role)) {
    // FAZA 28: strict own-only. Unassigned clients are invisible to all
    // coordinators by design — admin assigns coordinator at promotion to client
    // (status -> employed). Pre-FAZA-28 legacy clients were backfilled via
    // round-robin in migration 0021.
    // If a coordinator is deactivated, their assigned clients remain pointing
    // at them and become inaccessible until an admin reassigns coordinator_id.
    return c.coordinatorId === user.id;
  }
  return true;
}

// 2026-07-02 — the forward-only transition guard (assertValidTransition,
// Decision 3B) AND the reason_required guard for terminal statuses were both
// removed per client request: every role with access may move a status in ANY
// direction, and every field is independent (a dismissal may have no reason).
// What still holds:
//  - route-level role guards (delete stays admin-only);
//  - kind auto-promotion + lifecycle stamping in updateCandidate;
//  - horizontal isolation via canSee (recruiter/coordinator see own rows only).

export async function listCandidates(
  query: ListCandidatesQuery,
  user: Actor,
): Promise<{
  items: (CandidateRow & { hasDuplicate: boolean })[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const scopeRecruiterId = shouldScopeToRecruiter(user.role) ? user.id : undefined;
  const scopeCoordinatorId = shouldScopeToCoordinator(user.role) ? user.id : undefined;
  // Fetch the page + the duplicate-id set in parallel. The dupe query scans the
  // full table once (sub-second at ~1k rows) and is decoupled from pagination —
  // a row on page 5 still highlights if it dupes someone on page 1.
  const [{ items, total }, duplicateIds] = await Promise.all([
    repo.list({ query, scopeRecruiterId, scopeCoordinatorId }),
    repo.findDuplicateIds(scopeRecruiterId),
  ]);
  const itemsWithFlag = items.map((it) => ({ ...it, hasDuplicate: duplicateIds.has(it.id) }));
  return { items: itemsWithFlag, total, page: query.page, pageSize: query.pageSize };
}

// Failed Candidates Report — same RBAC scoping as listCandidates but the repo
// applies the additional "failed" predicate (status='cancelled' OR workEndReason
// IS NOT NULL). No mutation = no audit log.
export async function listFailedCandidates(
  query: ListCandidatesQuery,
  user: Actor,
): Promise<{
  items: EnrichedCandidate[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const scopeRecruiterId = shouldScopeToRecruiter(user.role) ? user.id : undefined;
  const scopeCoordinatorId = shouldScopeToCoordinator(user.role) ? user.id : undefined;
  const { items, total } = await repo.findFailedCandidates(
    query,
    scopeRecruiterId,
    scopeCoordinatorId,
  );
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getCandidate(id: string, user: Actor): Promise<EnrichedCandidate> {
  const row = await repo.findByIdEnriched(id);
  if (!row || !canSee(row, user)) throw new NotFoundError('candidate');
  return row;
}

export async function createCandidate(
  input: CreateCandidateInput,
  user: Actor,
  force: boolean,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  // F3: recruiterId is required by the Zod schema. Recruiters cannot set
  // an arbitrary recruiterId — service coerces to self regardless of input.
  // Admins pass the picked recruiter id explicitly.
  const recruiterId =
    user.role === 'recruiter' ? user.id : input.recruiterId;

  // Consent fields are not candidate columns — pull them out before insert and
  // materialize them as separate `consents` rows below.
  const { emailConsentAccepted, smsConsentAccepted, consentBasis, ...candidateInput } = input;

  await assertNoDuplicates(
    {
      email: candidateInput.email ?? null,
      phone: candidateInput.phone ?? null,
      name: candidateInput.name,
    },
    force,
  );

  const row = await repo.insert({
    ...candidateInput,
    recruiterId,
    status: candidateInput.status ?? 'new',
    workStartDate: candidateInput.workStartDate ? new Date(candidateInput.workStartDate) : null,
    workEndDate: candidateInput.workEndDate ? new Date(candidateInput.workEndDate) : null,
    documentsSubmittedAt: candidateInput.documentsSubmittedAt
      ? new Date(candidateInput.documentsSubmittedAt)
      : null,
    arrivedAt: candidateInput.arrivedAt ? new Date(candidateInput.arrivedAt) : null,
  });

  // Manual-create consent capture. The recruiter attests the candidate agreed
  // offline (verbally / on paper) — recorded as email_marketing / sms_marketing
  // rows with source='manual_*'. Omitting the flags records NO consent (safe
  // default), so a plain manual add never fabricates a basis to market.
  const consentSource =
    consentBasis === 'manual_paper' ? CONSENT_SOURCES.manualPaper : CONSENT_SOURCES.manualVerbal;
  const normEmail = candidateInput.email ? normalizeEmail(candidateInput.email) : null;
  const normPhone = normalizePhone(candidateInput.phone ?? null);

  // RODO processing basis — recorded on EVERY manual creation so no candidate
  // ever exists without a documented basis (RODO always "green"). source
  // 'intake' marks it as established at staff intake, not a signed form.
  if (normEmail || normPhone) {
    await db.insert(consents).values({
      candidateEmail: normEmail,
      candidatePhone: normPhone,
      consentType: CONSENT_TYPES.applicationForm,
      version: CONSENT_VERSIONS.applicationForm,
      source: CONSENT_SOURCES.intake,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  let emailConsentRecorded = false;
  let smsConsentRecorded = false;
  if (emailConsentAccepted === true && normEmail) {
    await db.insert(consents).values({
      candidateEmail: normEmail,
      consentType: CONSENT_TYPES.emailMarketing,
      version: CONSENT_VERSIONS.emailMarketing,
      source: consentSource,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    emailConsentRecorded = true;
  }
  if (smsConsentAccepted === true && (normPhone || normEmail)) {
    await db.insert(consents).values({
      candidateEmail: normEmail,
      candidatePhone: normPhone,
      consentType: CONSENT_TYPES.smsMarketing,
      version: CONSENT_VERSIONS.smsMarketing,
      source: consentSource,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    smsConsentRecorded = true;
  }

  await audit.log({
    actorId: user.id,
    action: 'create_candidate',
    entityType: 'candidate',
    entityId: row.id,
    newValue: { email: row.email, name: row.name, emailConsentRecorded, smsConsentRecorded },
    ...ctx,
  });

  // Best-effort onboarding/welcome email (no-op unless an admin flagged a
  // template auto-send). Never throws — must not fail candidate creation.
  await sendWelcomeEmailOnCreate(
    { id: row.id, name: row.name, email: row.email, phone: row.phone },
    user.id,
  );

  return row;
}

// Public submission — the agency website PHP contact form + Make.com (FB Lead Ads)
// + the new per-recruiter /apply/:slug form. No auth, dedup is non-blocking
// (a duplicate gets created and tagged in notes — public form must always
// accept input). Audit log uses null actor (anonymous submitter).
//
// 2026-06-12 additions:
//   * If `recruiterSlug` resolves to an active user, the candidate is
//     auto-assigned via candidate.recruiterId, so it shows up in that
//     recruiter's own-only view immediately.
//   * If `consentAccepted` is true (new form), we insert a row in `consents`
//     and link the candidate to it via candidate.consentId — RODO art. 7
//     ust. 1 evidence (acceptedAt + ip + userAgent + policy version).
//   * Legacy PHP / Make.com payloads omit consentAccepted; we skip the
//     consents insert in that case so existing webhooks keep working.
export async function submitFromPublic(
  input: SubmitPublicCandidateInput,
  ctx: ReqCtx,
): Promise<{ id: string }> {
  const matched = await repo.findFirstMatchingCandidate({
    email: input.email ?? null,
    phone: input.phone ?? null,
    name: input.name,
  });

  // Resolve recruiter slug → id. Unknown / inactive recruiter falls through
  // to null assignment (admin's queue), same as legacy submissions.
  let recruiterId: string | null = null;
  if (input.recruiterSlug) {
    const recruiter = await usersRepo.findByPublicSlug(input.recruiterSlug);
    if (recruiter && recruiter.isActive) {
      recruiterId = recruiter.id;
    }
  }

  // Source attribution — give admins a quick signal on where each lead came
  // from. If the form supplied a specific source we respect it.
  const source =
    input.source && input.source !== 'website'
      ? input.source
      : input.recruiterSlug
        ? 'form_recruiter'
        : 'website';

  // RODO consent row — only when the form explicitly passed consentAccepted.
  // Keeps legacy webhook payloads working without forcing them to lie about
  // consent (the PHP form has its own checkbox on the agency website).
  let consentId: string | null = null;
  let smsConsentRecorded = false;
  const normalizedConsentEmail = input.email ? normalizeEmail(input.email) : null;
  if (input.consentAccepted === true && normalizedConsentEmail) {
    const [consentRow] = await db
      .insert(consents)
      .values({
        candidateEmail: normalizedConsentEmail,
        consentType: 'application_form',
        version: 'polityka-prywatnosci-2026',
        source: CONSENT_SOURCES.applyForm,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })
      .returning({ id: consents.id });
    consentId = consentRow?.id ?? null;
  }

  // Optional SMS-marketing consent — separate row, separate type, so it can be
  // withdrawn independently (inbound STOP keyword, withdraw link). Keyed on the
  // PHONE (the SMS identity) so a phone-only applicant can opt in; email is
  // stored too when present. Bulk-send matches this consent by phone OR email.
  // candidate.consentId keeps pointing at the application_form row.
  const normalizedConsentPhone = normalizePhone(input.phone);
  if (input.smsConsentAccepted === true && (normalizedConsentPhone || normalizedConsentEmail)) {
    await db.insert(consents).values({
      candidateEmail: normalizedConsentEmail,
      candidatePhone: normalizedConsentPhone,
      consentType: 'sms_marketing',
      version: 'sms-marketing-2026-v1',
      source: CONSENT_SOURCES.applyForm,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    smsConsentRecorded = true;
  }

  // Optional email-marketing consent (mirror of the SMS opt-in). Keyed on the
  // email. Bulk EMAIL now sends only to candidates holding an active row here.
  let emailConsentRecorded = false;
  if (input.emailConsentAccepted === true && normalizedConsentEmail) {
    await db.insert(consents).values({
      candidateEmail: normalizedConsentEmail,
      consentType: CONSENT_TYPES.emailMarketing,
      version: CONSENT_VERSIONS.emailMarketing,
      source: CONSENT_SOURCES.applyForm,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    emailConsentRecorded = true;
  }

  const baseNotes = input.message ?? null;
  const notes = matched
    ? `${baseNotes ?? ''}${baseNotes ? '\n' : ''}[duplicate of ${matched.id}]`
    : baseNotes;

  const row = await repo.insert({
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    birthDate: input.birthDate ?? null,
    nationality: input.nationality ?? null,
    messenger: input.messenger ?? null,
    experience: input.experience ?? null,
    recruiterId,
    consentId,
    source,
    status: 'new',
    notes,
  });

  await audit.log({
    actorId: null,
    action: 'submit_public_candidate',
    entityType: 'candidate',
    entityId: row.id,
    newValue: {
      name: row.name,
      email: row.email,
      source,
      recruiterAssigned: recruiterId !== null,
      consentRecorded: consentId !== null,
      smsConsentRecorded,
      emailConsentRecorded,
    },
    ...ctx,
  });

  // Best-effort onboarding/welcome email — same hook as manual create. Anonymous
  // actor (public submitter), so sentById is null.
  await sendWelcomeEmailOnCreate(
    { id: row.id, name: row.name, email: row.email, phone: row.phone },
    null,
  );

  return { id: row.id };
}

// ADMIN-ONLY override: set the candidate's email/sms marketing consent directly
// (on OR off). The ONLY non-mail path to change consent — kept for data fixes /
// honoring written requests. Every change is audit-logged (`admin_set_consent`).
// The route enforces the admin role; recruiters/coordinators cannot reach this.
export async function adminSetConsent(
  candidateId: string,
  input: AdminSetConsentInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ emailConsent: boolean; smsConsent: boolean }> {
  const candidate = await repo.findByIdEnriched(candidateId);
  if (!candidate || !canSee(candidate, actor)) throw new NotFoundError('candidate');
  const normEmail = candidate.email ? normalizeEmail(candidate.email) : null;
  const normPhone = normalizePhone(candidate.phone ?? null);

  if (normEmail) {
    if (input.email) {
      const existing = await consentsRepo.findActiveConsentByType({
        consentType: CONSENT_TYPES.emailMarketing,
        email: normEmail,
        phone: null,
      });
      if (!existing) {
        await consentsRepo.insertConsent({
          candidateEmail: normEmail,
          consentType: CONSENT_TYPES.emailMarketing,
          version: CONSENT_VERSIONS.emailMarketing,
          source: CONSENT_SOURCES.adminOverride,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    } else {
      await consentsRepo.withdrawActiveConsentByType(
        { consentType: CONSENT_TYPES.emailMarketing, email: normEmail, phone: null },
        ctx,
      );
    }
  }

  if (normPhone || normEmail) {
    if (input.sms) {
      const existing = await consentsRepo.findActiveConsentByType({
        consentType: CONSENT_TYPES.smsMarketing,
        email: normEmail,
        phone: normPhone,
      });
      if (!existing) {
        await consentsRepo.insertConsent({
          candidateEmail: normEmail,
          candidatePhone: normPhone,
          consentType: CONSENT_TYPES.smsMarketing,
          version: CONSENT_VERSIONS.smsMarketing,
          source: CONSENT_SOURCES.adminOverride,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    } else {
      await consentsRepo.withdrawActiveConsentByType(
        { consentType: CONSENT_TYPES.smsMarketing, email: normEmail, phone: normPhone },
        ctx,
      );
    }
  }

  await audit.log({
    actorId: actor.id,
    action: 'admin_set_consent',
    entityType: 'candidate',
    entityId: candidateId,
    newValue: { email: input.email, sms: input.sms },
    ...ctx,
  });

  return {
    emailConsent: input.email && normEmail !== null,
    smsConsent: input.sms && (normPhone !== null || normEmail !== null),
  };
}

// Mints a fresh manage token and EMAILS the candidate the confirm/manage link.
// The operator NEVER sees the link → cannot self-approve. Requires an email.
export async function sendConsentRequest(
  candidateId: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ sent: boolean }> {
  const candidate = await repo.findByIdEnriched(candidateId);
  if (!candidate || !canSee(candidate, actor)) throw new NotFoundError('candidate');
  if (!candidate.email) {
    throw new AppError('VALIDATION', { reason: 'candidate_has_no_email' }, 400);
  }

  const tokenRow = await consentsRepo.createOptinToken({
    candidateId,
    candidateEmail: normalizeEmail(candidate.email),
    candidatePhone: normalizePhone(candidate.phone ?? null),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  const url = `${env.APP_URL}/consent/confirm/${tokenRow.token}`;
  await sendConsentRequestEmail(candidate.email, url, candidate.name);

  await audit.log({
    actorId: actor.id,
    action: 'send_consent_request',
    entityType: 'candidate',
    entityId: candidateId,
    ...ctx,
  });

  return { sent: true };
}

// Bulk version — email a confirm/manage link to many selected candidates at
// once. Best-effort per recipient; candidates without an email are skipped.
export async function sendConsentRequestsBulk(
  candidateIds: string[],
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ sent: number; skippedNoEmail: number; failed: number }> {
  let sent = 0;
  let skippedNoEmail = 0;
  let failed = 0;

  for (const id of [...new Set(candidateIds)]) {
    try {
      const candidate = await repo.findByIdEnriched(id);
      if (!candidate || !canSee(candidate, actor)) {
        failed++;
        continue;
      }
      if (!candidate.email) {
        skippedNoEmail++;
        continue;
      }
      const tokenRow = await consentsRepo.createOptinToken({
        candidateId: id,
        candidateEmail: normalizeEmail(candidate.email),
        candidatePhone: normalizePhone(candidate.phone ?? null),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      await sendConsentRequestEmail(
        candidate.email,
        `${env.APP_URL}/consent/confirm/${tokenRow.token}`,
        candidate.name,
      );
      sent++;
    } catch {
      failed++;
    }
  }

  await audit.log({
    actorId: actor.id,
    action: 'send_consent_requests_bulk',
    entityType: 'candidate',
    entityId: null,
    newValue: { requested: candidateIds.length, sent, skippedNoEmail, failed },
    ...ctx,
  });

  return { sent, skippedNoEmail, failed };
}

// Journals a REJECTED mutation attempt so admins can see in Журнал подій WHY
// a user's save bounced (the "Save button does nothing" support case).
// Records the error code + meta and the NAMES of the fields being changed —
// never the submitted values (they may carry PII the actor had no right to
// persist). Best-effort: its own failure must never mask the original error.
async function auditFailedAttempt(
  action: string,
  entityId: string,
  user: Actor,
  ctx: ReqCtx,
  err: unknown,
  fields?: string[],
): Promise<void> {
  const isApp = err instanceof AppError;
  try {
    await audit.log({
      actorId: user.id,
      action,
      entityType: 'candidate',
      entityId,
      newValue: {
        error: isApp ? err.code : 'INTERNAL',
        ...(isApp && err.meta ? { meta: err.meta } : {}),
        ...(fields && fields.length ? { fields } : {}),
      },
      ...ctx,
    });
  } catch {
    // swallow — journaling a failure must not replace the real error
  }
}

export async function updateCandidate(
  id: string,
  patch: UpdateCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  try {
    return await updateCandidateUnsafe(id, patch, user, ctx);
  } catch (err) {
    await auditFailedAttempt('update_candidate_failed', id, user, ctx, err, Object.keys(patch));
    throw err;
  }
}

async function updateCandidateUnsafe(
  id: string,
  patch: UpdateCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  const existing = await repo.findById(id);
  if (!existing || !canSee(existing, user)) throw new NotFoundError('candidate');

  // Recruiters cannot reassign to other recruiters (silently coerce to self).
  // Tested: candidates.service.test.ts "recruiter cannot reassign..."
  const coercedPatch: Record<string, unknown> = {
    ...patch,
    workStartDate: patch.workStartDate ? new Date(patch.workStartDate) : patch.workStartDate === null ? null : undefined,
    workEndDate: patch.workEndDate ? new Date(patch.workEndDate) : patch.workEndDate === null ? null : undefined,
    documentsSubmittedAt: patch.documentsSubmittedAt
      ? new Date(patch.documentsSubmittedAt)
      : patch.documentsSubmittedAt === null
        ? null
        : undefined,
    arrivedAt: patch.arrivedAt
      ? new Date(patch.arrivedAt)
      : patch.arrivedAt === null
        ? null
        : undefined,
  };

  const safePatch =
    user.role === 'recruiter' && coercedPatch.recruiterId && coercedPatch.recruiterId !== user.id
      ? { ...coercedPatch, recruiterId: user.id }
      : coercedPatch;

  // 2026-07-02 — the reason_required guard for terminal transitions was
  // removed per client request: every field is independent, a dismissal may
  // be recorded without a reason. Reports fall back to 'other'/blank.

  // Auto-promotion: first transition to `employed` flips kind→client + stamps
  // documentsSubmittedAt if status crosses that milestone. The auto-stamped
  // lifecycle timestamps (employed_at / dismissed_at / cancelled_at /
  // re_employed_at / blacklisted_at) were dropped 2026-06-10 — work_start_date
  // and work_end_date drive retention computation now.
  const statusChange = patch.status && patch.status !== existing.status ? patch.status : null;

  if (statusChange) {
    const now = new Date();
    if (statusChange === 'employed' || statusChange === 're_employed') {
      if (existing.kind !== 'client') safePatch.kind = 'client';
    } else if (statusChange === 'documents_submitted') {
      if (!existing.documentsSubmittedAt) safePatch.documentsSubmittedAt = now;
    }

    // When a client exits work (dismissed/cancelled/blacklist), clear housing.
    if (
      statusChange === 'dismissed' ||
      statusChange === 'cancelled' ||
      statusChange === 'blacklist'
    ) {
      if (patch.housingType === undefined) safePatch.housingType = null;
    }
  }

  // 2026-08-12 (client report): every status transition must keep
  // employment_periods in sync — retention analytics count exclusively from
  // that table, and this PATCH is reachable from the bulk status switcher and
  // the edit form's date auto-bump. Both used to leave episodes open, so a
  // candidate read "dismissed"/"cancelled" in the list yet counted as working
  // (100% retention) on /analytics.
  const exitsWork =
    statusChange === 'dismissed' || statusChange === 'cancelled' || statusChange === 'blacklist';
  const entersWork = statusChange === 'employed' || statusChange === 're_employed';

  const row =
    !exitsWork && !entersWork
      ? await repo.update(id, safePatch as never)
      : await db.transaction(async (tx) => {
          if (exitsWork) {
            const closedAt =
              safePatch.workEndDate instanceof Date ? safePatch.workEndDate : new Date();
            // Mirror dismissCandidate: taxonomy code first, free text second;
            // cancelled/blacklist close with the status as a machine marker.
            const reason =
              statusChange === 'dismissed'
                ? patch.workEndReason?.trim() || patch.reasonNote?.trim() || null
                : statusChange;
            await periodsRepo.closeOpen(id, closedAt, reason, tx);
            if (statusChange === 'dismissed') {
              // Bulk PATCH carries no dates — the card mirrors the episode end.
              if (safePatch.workEndDate === undefined) safePatch.workEndDate = closedAt;
              // Every recorded dismissal lands in the registry, same contract
              // as POST /:id/dismiss ('other' = reason-less fallback).
              await dismissalsRepo.insert(
                {
                  candidateId: id,
                  dismissedAt: closedAt,
                  reason: reason ?? 'other',
                  reasonCode: patch.workEndReason?.trim() || null,
                  notes: patch.reasonNote?.trim() || null,
                  recordedById: user.id,
                },
                tx,
              );
            }
          } else if (!(await periodsRepo.findOpen(id, tx))) {
            // A first hire may carry a legacy card date (imports / manual form
            // edits); a re-hire must not inherit the previous episode's start.
            const isFirstHire = !(await periodsRepo.hasAny(id, tx));
            const employedAt =
              (safePatch.workStartDate instanceof Date ? safePatch.workStartDate : null) ??
              (isFirstHire ? existing.workStartDate : null) ??
              new Date();
            await periodsRepo.insert(
              {
                candidateId: id,
                employedAt,
                housingType:
                  patch.housingType !== undefined ? patch.housingType : existing.housingType,
                projectId: patch.projectId !== undefined ? patch.projectId : existing.projectId,
                coordinatorId:
                  patch.coordinatorId !== undefined ? patch.coordinatorId : existing.coordinatorId,
                createdBy: user.id,
              },
              tx,
            );
            // Mirror hireCandidate: the card reflects the newly-opened episode,
            // and end-of-work fields belong to the previous one.
            if (safePatch.workStartDate === undefined) safePatch.workStartDate = employedAt;
            if (safePatch.workEndDate === undefined) safePatch.workEndDate = null;
            if (safePatch.workEndReason === undefined) safePatch.workEndReason = null;
          }
          return repo.update(id, safePatch as never, tx);
        });
  if (!row) throw new NotFoundError('candidate');

  // Diff what actually changed — log only fields present in patch (RODO trail).
  // Per FAZA 6 code review I-6: leads/vacancies will copy this pattern, so capture
  // the actual delta rather than just email+status.
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(safePatch) as Array<keyof typeof safePatch>) {
    oldValue[key] = (existing as Record<string, unknown>)[key as string];
    newValue[key] = (row as Record<string, unknown>)[key as string];
  }

  await audit.log({
    actorId: user.id,
    action: 'update_candidate',
    entityType: 'candidate',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  return row;
}

export async function deleteCandidate(id: string, user: Actor, ctx: ReqCtx): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing || !canSee(existing, user)) throw new NotFoundError('candidate');

  // Write audit FIRST so we never lose the trail if delete succeeds but the
  // audit insert later fails. The delete-then-audit pattern is a RODO risk.
  // If delete is rejected (FK violation), the audit row stays — but that's
  // fine: it records an attempt, not a state change.
  await audit.log({
    actorId: user.id,
    action: 'delete_candidate',
    entityType: 'candidate',
    entityId: id,
    oldValue: { email: existing.email, name: existing.name },
    ...ctx,
  });

  try {
    await repo.remove(id);
  } catch (err) {
    // PG error code 23503 = foreign_key_violation
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23503') {
      throw new AppError(ERROR_CODES.VALIDATION, { constraint: e.constraint }, 409);
    }
    throw err;
  }
}

// 2026-06-01 status-model rework: dedicated orchestrators for lifecycle
// transitions. Each one updates candidates.status + denormalized snapshot AND
// inserts/closes a row in employment_periods. Auditing wraps the write.

export async function hireCandidate(
  id: string,
  input: HireCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  try {
    return await hireCandidateUnsafe(id, input, user, ctx);
  } catch (err) {
    await auditFailedAttempt('hire_candidate_failed', id, user, ctx, err);
    throw err;
  }
}

async function hireCandidateUnsafe(
  id: string,
  input: HireCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  const existing = await repo.findById(id);
  if (!existing || !canSee(existing, user)) throw new NotFoundError('candidate');

  // Reject if there's already an open period — caller should use rehire instead.
  const open = await periodsRepo.findOpen(id);
  if (open) {
    throw new AppError(ERROR_CODES.VALIDATION, { reason: 'already_employed' }, 409);
  }

  const workStartDate = new Date(input.workStartDate);
  // 2026-07-10: first-hire = no employment episode on record. The previous
  // signal (!existing.workStartDate) misfired on imported/manually-dated rows —
  // their first real hire got labelled re_employed (client report 09.07).
  const isFirstHire = !(await periodsRepo.hasAny(id));

  // Both writes must be atomic: a successful status flip with no employment
  // period row (or vice versa) corrupts the retention report. The previous
  // sequential path leaked a half-applied hire on FK violation.
  const updated = await db.transaction(async (tx) => {
    const row = await repo.update(
      id,
      {
        status: isFirstHire ? 'employed' : 're_employed',
        kind: 'client',
        housingType: input.housingType ?? null,
        projectId: input.projectId ?? null,
        coordinatorId: input.coordinatorId ?? null,
        // 2026-07-10: the card always mirrors the LATEST episode — rehire used
        // to keep the first-hire date, so the list showed a stale start date
        // that the modal could never change (client report 09.07). Retention
        // now counts from the current episode; full history stays in
        // employment_periods.
        workStartDate,
        workEndDate: null,
        workEndReason: null,
      },
      tx,
    );
    if (!row) throw new NotFoundError('candidate');

    await periodsRepo.insert(
      {
        candidateId: id,
        employedAt: workStartDate,
        housingType: input.housingType ?? null,
        projectId: input.projectId ?? null,
        coordinatorId: input.coordinatorId ?? null,
        createdBy: user.id,
      },
      tx,
    );

    return row;
  });

  await audit.log({
    actorId: user.id,
    action: isFirstHire ? 'hire_candidate' : 'rehire_candidate',
    entityType: 'candidate',
    entityId: id,
    newValue: {
      workStartDate: workStartDate.toISOString(),
      housingType: input.housingType ?? null,
      projectId: input.projectId ?? null,
      coordinatorId: input.coordinatorId ?? null,
    },
    ...ctx,
  });

  return updated;
}

export async function rehireCandidate(
  id: string,
  input: RehireCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  return hireCandidate(id, input, user, ctx);
}

export async function dismissCandidate(
  id: string,
  input: DismissCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  try {
    return await dismissCandidateUnsafe(id, input, user, ctx);
  } catch (err) {
    await auditFailedAttempt('dismiss_candidate_failed', id, user, ctx, err);
    throw err;
  }
}

async function dismissCandidateUnsafe(
  id: string,
  input: DismissCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  const existing = await repo.findById(id);
  if (!existing || !canSee(existing, user)) throw new NotFoundError('candidate');
  if (existing.kind !== 'client') {
    throw new AppError(ERROR_CODES.VALIDATION, { reason: 'not_a_client' }, 409);
  }

  // 2026-07-02 — reason is optional now (client request: every field
  // independent). The dismissals table still needs a non-null reason, so a
  // reason-less dismiss falls back to 'other' below.
  const reasonCode = input.reasonCode?.trim() || null;
  const reasonNote = input.reasonNote?.trim() || null;

  const workEndDate = new Date(input.workEndDate);
  const reason = reasonCode ?? reasonNote;

  await periodsRepo.closeOpen(id, workEndDate, reason);

  const updated = await repo.update(id, {
    status: 'dismissed',
    workEndDate,
    workEndReason: reason,
    reasonNote,
    // 2026-06-02: client left our facilities — clear housing.
    housingType: null,
  });

  // 2026-06-02: mirror the dismissal into the `dismissals` table so the
  // retention report sees every dismissal (was the spec on
  // dismissCandidateSchema:23-24, never wired). `reason` is non-null in the
  // dismissals table — reason-less dismissals fall back to 'other'.
  const dismissalsRow = await dismissalsRepo.insert({
    candidateId: id,
    dismissedAt: workEndDate,
    reason: reason ?? 'other',
    reasonCode,
    notes: reasonNote,
    recordedById: user.id,
  });

  await audit.log({
    actorId: user.id,
    action: 'dismiss_candidate',
    entityType: 'candidate',
    entityId: id,
    newValue: {
      workEndDate: workEndDate.toISOString(),
      reasonCode,
      hasReasonNote: Boolean(reasonNote),
      dismissalRowId: dismissalsRow.id,
    },
    ...ctx,
  });

  if (!updated) throw new NotFoundError('candidate');
  return updated;
}

export async function cancelCandidate(
  id: string,
  input: CancelCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  try {
    return await cancelCandidateUnsafe(id, input, user, ctx);
  } catch (err) {
    await auditFailedAttempt('cancel_candidate_failed', id, user, ctx, err);
    throw err;
  }
}

async function cancelCandidateUnsafe(
  id: string,
  input: CancelCandidateInput,
  user: Actor,
  ctx: ReqCtx,
): Promise<CandidateRow> {
  const existing = await repo.findById(id);
  if (!existing || !canSee(existing, user)) throw new NotFoundError('candidate');

  // 2026-06-10: cancel_reason_code column was dropped — cancel always routes
  // to status='cancelled' and persists the free-text `reasonNote` (optional
  // since 2026-07-02). Blacklist transitions go through the regular
  // PATCH /candidates/:id flow.
  const targetStatus: CandidateStatus = 'cancelled';

  // 2026-08-12 (client report): an annulled candidate must stop counting as
  // "working" in retention analytics, which read employment_periods — so any
  // open episode is closed here, dated with the annulment moment. A cancel
  // before the start date yields dismissed_at < employed_at; the analytics
  // tenure guard (dis >= emp) already excludes such episodes from avg days
  // while still counting them as dismissed.
  const now = new Date();
  let closedPeriod = false;
  const updated = await db.transaction(async (tx) => {
    const closed = await periodsRepo.closeOpen(id, now, 'cancelled', tx);
    closedPeriod = Boolean(closed);
    return repo.update(
      id,
      {
        status: targetStatus,
        reasonNote: input.reasonNote?.trim() || null,
        // 2026-06-02: cancel also clears housing (they're not staying with us).
        housingType: null,
      },
      tx,
    );
  });

  await audit.log({
    actorId: user.id,
    action: 'cancel_candidate',
    entityType: 'candidate',
    entityId: id,
    newValue: {
      hasReasonNote: Boolean(input.reasonNote),
      closedEmploymentPeriod: closedPeriod,
    },
    ...ctx,
  });

  if (!updated) throw new NotFoundError('candidate');
  return updated;
}

export interface DuplicateCheckInput {
  email: string | null;
  phone: string | null;
  name: string;
}

function matchedFields(d: CandidateRow, input: DuplicateCheckInput): Array<'email' | 'phone' | 'name'> {
  const out: Array<'email' | 'phone' | 'name'> = [];
  const dEmail = normalizeEmail(d.email);
  const iEmail = normalizeEmail(input.email);
  if (dEmail && iEmail && dEmail === iEmail) out.push('email');
  if (input.phone && d.phone === input.phone) out.push('phone');
  const dName = normalizeName(d.name);
  const iName = normalizeName(input.name);
  if (dName && iName && dName === iName) out.push('name');
  return out;
}

// Single source of truth for dedup-or-throw. createCandidate calls this so the
// DUPLICATE error payload (including matchedBy tags) stays consistent across
// entry points.
export async function assertNoDuplicates(
  input: DuplicateCheckInput,
  force: boolean,
): Promise<void> {
  if (force) return;
  const dups = await repo.findDuplicates(input);
  if (dups.length === 0) return;
  throw new AppError(
    ERROR_CODES.DUPLICATE,
    {
      duplicates: dups.map((d) => ({
        id: d.id,
        name: d.name,
        email: d.email,
        matchedBy: matchedFields(d, input),
      })),
    },
    409,
  );
}
