import { alias } from 'drizzle-orm/pg-core';
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '../db/client';
import { candidates, type Candidate, type NewCandidate } from '../db/tables/candidates';
import { users } from '../db/tables/users';
import { freelancers } from '../db/tables/freelancers';
import { projects } from '../db/tables/projects';
import { candidateComments } from '../db/tables/candidate-comments';
import { consents } from '../db/tables/consents';
import type { ListCandidatesQuery } from '@crm/shared';
import { resolveDateRange } from '../lib/date-range';
import { normalizeEmail, normalizeName, normalizePhone } from '../lib/normalize';
import { listIgnored, pairKey } from './duplicate-ignores.repo';

export interface ListFilter {
  query: ListCandidatesQuery;
  // 2026-06-11: strict own-only for recruiters (no OR isNull) — unassigned
  // candidates are no longer visible to recruiters. Admin assigns owner.
  scopeRecruiterId?: string; // when set, restrict to this recruiterId
  scopeCoordinatorId?: string; // when set, restrict to this coordinatorId
}

// Per-row active-consent predicates. Matching mirrors the send-time filters in
// bulk-send.service (email: exact email; sms: trim(phone) OR email) so a badge
// in the list always agrees with who would actually be reached.
// RODO (application_form) = the obligatory processing basis. Matched by email
// OR phone so phone-only candidates count too.
const rodoConsentExpr = sql<boolean>`EXISTS (
  SELECT 1 FROM ${consents}
  WHERE ${consents.consentType} = 'application_form'
    AND ${consents.withdrawnAt} IS NULL
    AND (
      ${consents.candidateEmail} = ${candidates.email}
      OR ${consents.candidatePhone} = trim(${candidates.phone})
    )
)`;
const emailConsentExpr = sql<boolean>`EXISTS (
  SELECT 1 FROM ${consents}
  WHERE ${consents.consentType} = 'email_marketing'
    AND ${consents.withdrawnAt} IS NULL
    AND ${consents.candidateEmail} = ${candidates.email}
)`;
const smsConsentExpr = sql<boolean>`EXISTS (
  SELECT 1 FROM ${consents}
  WHERE ${consents.consentType} = 'sms_marketing'
    AND ${consents.withdrawnAt} IS NULL
    AND (
      ${consents.candidatePhone} = trim(${candidates.phone})
      OR ${consents.candidateEmail} = ${candidates.email}
    )
)`;

export async function list(f: ListFilter): Promise<{ items: Candidate[]; total: number }> {
  const where: SQL[] = [];

  if (!f.query.includeAnonymized) where.push(isNull(candidates.anonymizedAt));
  if (f.query.status) where.push(eq(candidates.status, f.query.status));
  if (f.query.kind) where.push(eq(candidates.kind, f.query.kind));
  // 2026-06-12 — status-bucket filter. `/candidates` passes 'candidate' →
  // status IN (new, in_progress, documents_submitted, cancelled); `/clients`
  // passes 'client' → status IN (employed, re_employed, dismissed, blacklist).
  // Replaces the kind-driven split — a row hops between views by changing
  // status alone, no extra column to keep in sync.
  if (f.query.statusBucket) {
    const codes = f.query.statusBucket === 'candidate'
      ? ['new', 'in_progress', 'documents_submitted', 'cancelled'] as const
      : ['employed', 're_employed', 'dismissed', 'blacklist'] as const;
    where.push(inArray(candidates.status, [...codes]));
  }
  if (f.query.recruiterId) where.push(eq(candidates.recruiterId, f.query.recruiterId));
  if (f.query.coordinatorId) where.push(eq(candidates.coordinatorId, f.query.coordinatorId));
  if (f.query.freelancerId) where.push(eq(candidates.freelancerId, f.query.freelancerId));
  if (f.query.projectId) where.push(eq(candidates.projectId, f.query.projectId));
  if (f.query.source) where.push(eq(candidates.source, f.query.source));
  if (f.query.housingType) where.push(eq(candidates.housingType, f.query.housingType));
  // 2026-06-10 Excel-import filters. position/legalStatus map to lookup codes
  // (exact match); reconciliationPeriod is free text (ilike).
  if (f.query.position) where.push(eq(candidates.position, f.query.position));
  if (f.query.legalStatus) where.push(eq(candidates.legalStatus, f.query.legalStatus));
  // Escape LIKE wildcards (`%` and `_`) in user input so a search for the
  // literal underscore doesn't degenerate into "match everything single-char".
  // Drizzle binds the pattern as a parameter, so this only protects against
  // semantic over-matching, not SQL injection.
  const escLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');
  if (f.query.reconciliationPeriod) {
    where.push(ilike(candidates.reconciliationPeriod, `%${escLike(f.query.reconciliationPeriod)}%`));
  }
  // 2026-06-10 Block 7 filters — exact-code matches (lookup-backed).
  if (f.query.workOutcome) where.push(eq(candidates.workOutcome, f.query.workOutcome));
  if (f.query.payoutStatus) where.push(eq(candidates.payoutStatus, f.query.payoutStatus));
  if (f.query.paymentStatus) where.push(eq(candidates.paymentStatus, f.query.paymentStatus));
  if (f.query.retention) where.push(eq(candidates.retention, f.query.retention));
  if (f.scopeRecruiterId) {
    // 2026-06-11: strict own-only — no OR isNull. Unassigned candidates are
    // invisible to recruiters; admin assigns owner.
    where.push(eq(candidates.recruiterId, f.scopeRecruiterId));
  }
  if (f.scopeCoordinatorId) {
    // FAZA 28: strict own-only — no OR isNull. See canSee in candidates.service.
    where.push(eq(candidates.coordinatorId, f.scopeCoordinatorId));
  }
  if (f.query.q) {
    const term = `%${f.query.q}%`;
    where.push(
      or(
        ilike(candidates.name, term),
        ilike(candidates.email, term),
        ilike(candidates.phone, term),
      )!,
    );
  }

  if (f.query.hasEmail === true) where.push(isNotNull(candidates.email));
  else if (f.query.hasEmail === false) where.push(isNull(candidates.email));

  if (f.query.hasPhone === true) where.push(isNotNull(candidates.phone));
  else if (f.query.hasPhone === false) where.push(isNull(candidates.phone));

  // Consent filter — see rodo/email/sms consent predicates above.
  if (f.query.consentStatus === 'rodo') where.push(rodoConsentExpr);
  else if (f.query.consentStatus === 'email') where.push(emailConsentExpr);
  else if (f.query.consentStatus === 'sms') where.push(smsConsentExpr);
  else if (f.query.consentStatus === 'any') where.push(or(emailConsentExpr, smsConsentExpr)!);
  else if (f.query.consentStatus === 'none') {
    where.push(sql`NOT (${emailConsentExpr})`);
    where.push(sql`NOT (${smsConsentExpr})`);
  }

  const { since, until } = resolveDateRange({
    preset: f.query.preset,
    from: f.query.from,
    to: f.query.to,
  });
  if (since) where.push(gte(candidates.createdAt, since));
  if (until) where.push(lt(candidates.createdAt, until));

  if (f.query.duplicatesOnly) {
    const dupeIds = await findDuplicateIds(f.scopeRecruiterId);
    if (dupeIds.size === 0) {
      return { items: [], total: 0 };
    }
    where.push(inArray(candidates.id, [...dupeIds]));
  }

  const condition = where.length ? and(...where) : undefined;
  const offset = (f.query.page - 1) * f.query.pageSize;

  // Enrich with recruiter + coordinator + freelancer + project names via
  // LEFT JOIN so /clients can surface those columns without an N+1 lookup.
  // Four joins on a ~30-row team are negligible — the previous "skip
  // enrichment" optimization was over-conservative for this dataset.
  const recruiter = alias(users, 'recruiter');
  const coordinator = alias(users, 'coordinator');

  // Scalar subquery for comments badge — small N + indexed FK = cheap.
  const commentsCountExpr = sql<number>`(
    SELECT COUNT(*)::int
    FROM ${candidateComments}
    WHERE ${candidateComments.candidateId} = ${candidates.id}
  )`;

  // Latest comment body for in-list preview. Sister subquery to the count above.
  const lastCommentBodyExpr = sql<string | null>`(
    SELECT body
    FROM ${candidateComments}
    WHERE ${candidateComments.candidateId} = ${candidates.id}
    ORDER BY ${candidateComments.createdAt} DESC
    LIMIT 1
  )`;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        candidate: candidates,
        recruiterFirstName: recruiter.firstName,
        recruiterLastName: recruiter.lastName,
        recruiterIsFreelancer: recruiter.isFreelancer,
        coordinatorFirstName: coordinator.firstName,
        coordinatorLastName: coordinator.lastName,
        freelancerFirstName: freelancers.firstName,
        freelancerLastName: freelancers.lastName,
        projectName: projects.name,
        projectStartDate: projects.startDate,
        commentsCount: commentsCountExpr,
        lastCommentBody: lastCommentBodyExpr,
        rodoConsent: rodoConsentExpr,
        emailConsent: emailConsentExpr,
        smsConsent: smsConsentExpr,
      })
      .from(candidates)
      .leftJoin(recruiter, eq(candidates.recruiterId, recruiter.id))
      .leftJoin(coordinator, eq(candidates.coordinatorId, coordinator.id))
      .leftJoin(freelancers, eq(candidates.freelancerId, freelancers.id))
      .leftJoin(projects, eq(candidates.projectId, projects.id))
      .where(condition)
      .orderBy(desc(candidates.createdAt))
      .limit(f.query.pageSize)
      .offset(offset),
    db.select({ c: count() }).from(candidates).where(condition).then((r) => r[0]),
  ]);

  const items = rows.map((r) => ({
    ...r.candidate,
    recruiterFirstName: r.recruiterFirstName,
    recruiterLastName: r.recruiterLastName,
    recruiterIsFreelancer: r.recruiterIsFreelancer,
    coordinatorFirstName: r.coordinatorFirstName,
    coordinatorLastName: r.coordinatorLastName,
    freelancerFirstName: r.freelancerFirstName,
    freelancerLastName: r.freelancerLastName,
    projectName: r.projectName,
    projectStartDate: r.projectStartDate,
    commentsCount: Number(r.commentsCount ?? 0),
    lastCommentBody: r.lastCommentBody ?? null,
    rodoConsent: r.rodoConsent ?? false,
    emailConsent: r.emailConsent ?? false,
    smsConsent: r.smsConsent ?? false,
  })) as Candidate[];

  return { items, total: totalRow?.c ?? 0 };
}

export async function findById(id: string): Promise<Candidate | undefined> {
  return db.query.candidates.findFirst({ where: eq(candidates.id, id) });
}

// Used by the public withdraw-consent flow to map a consent's candidateEmail
// back to a CRM row that needs anonymization. Case-insensitive because emails
// arrive from external forms with arbitrary capitalization.
export async function findActiveByEmailCi(email: string): Promise<Candidate | undefined> {
  return db.query.candidates.findFirst({
    where: and(ilike(candidates.email, email), isNull(candidates.anonymizedAt)),
  });
}

// Retention sweep input: candidates with no activity since `cutoff` and not
// already anonymized. "Activity" = last DB write (`updatedAt`) — captures both
// status changes and free-text edits without needing a separate signal column.
// Ordered + capped so each cron tick has a bounded blast radius.
export async function findInactiveCandidateIds(
  cutoff: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(lt(candidates.updatedAt, cutoff), isNull(candidates.anonymizedAt)))
    .orderBy(candidates.updatedAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

// Single-record fetch enriched with recruiter (users) + freelancer names.
// Used by GET /candidates/:id so the detail page renders names not UUIDs.
// Two cheap PK lookups in parallel, skipped when the FK is null.
export async function findByIdEnriched(id: string): Promise<
  | (Candidate & {
      recruiterFirstName: string | null;
      recruiterLastName: string | null;
      recruiterIsFreelancer: boolean | null;
      coordinatorFirstName: string | null;
      coordinatorLastName: string | null;
      freelancerFirstName: string | null;
      freelancerLastName: string | null;
      projectName: string | null;
      rodoConsent: boolean;
      emailConsent: boolean;
      smsConsent: boolean;
    })
  | undefined
> {
  const row = await db.query.candidates.findFirst({ where: eq(candidates.id, id) });
  if (!row) return undefined;

  const [
    recruiterRow,
    coordinatorRow,
    freelancerRow,
    projectRow,
    rodoConsentRow,
    emailConsentRow,
    smsConsentRow,
  ] = await Promise.all([
    row.recruiterId
      ? db
          .select({
            firstName: users.firstName,
            lastName: users.lastName,
            isFreelancer: users.isFreelancer,
          })
          .from(users)
          .where(eq(users.id, row.recruiterId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    row.coordinatorId
      ? db
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, row.coordinatorId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    row.freelancerId
      ? db
          .select({ firstName: freelancers.firstName, lastName: freelancers.lastName })
          .from(freelancers)
          .where(eq(freelancers.id, row.freelancerId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    row.projectId
      ? db
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, row.projectId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    // Active consents — matched the same way as the list badges.
    row.email || row.phone
      ? db.query.consents.findFirst({
          where: and(
            eq(consents.consentType, 'application_form'),
            isNull(consents.withdrawnAt),
            or(
              row.email ? eq(consents.candidateEmail, row.email) : undefined,
              row.phone ? eq(consents.candidatePhone, row.phone.trim()) : undefined,
            ),
          ),
        })
      : Promise.resolve(undefined),
    row.email
      ? db.query.consents.findFirst({
          where: and(
            eq(consents.consentType, 'email_marketing'),
            isNull(consents.withdrawnAt),
            eq(consents.candidateEmail, row.email),
          ),
        })
      : Promise.resolve(undefined),
    row.phone || row.email
      ? db.query.consents.findFirst({
          where: and(
            eq(consents.consentType, 'sms_marketing'),
            isNull(consents.withdrawnAt),
            or(
              row.phone ? eq(consents.candidatePhone, row.phone.trim()) : undefined,
              row.email ? eq(consents.candidateEmail, row.email) : undefined,
            ),
          ),
        })
      : Promise.resolve(undefined),
  ]);

  return {
    ...row,
    recruiterFirstName: recruiterRow?.firstName ?? null,
    recruiterLastName: recruiterRow?.lastName ?? null,
    recruiterIsFreelancer: recruiterRow?.isFreelancer ?? null,
    coordinatorFirstName: coordinatorRow?.firstName ?? null,
    coordinatorLastName: coordinatorRow?.lastName ?? null,
    freelancerFirstName: freelancerRow?.firstName ?? null,
    freelancerLastName: freelancerRow?.lastName ?? null,
    projectName: projectRow?.name ?? null,
    rodoConsent: Boolean(rodoConsentRow),
    emailConsent: Boolean(emailConsentRow),
    smsConsent: Boolean(smsConsentRow),
  };
}

// Returns IDs of candidates that have at least one duplicate by email, phone,
// or name (case-insensitive). Pairs explicitly marked "not a duplicate" by an
// admin (via duplicate_ignores) are excluded. Used to flag rows in the list UI.
// Single self-join across the whole table — for ~1k candidates this is sub-second
// thanks to indexes on email/phone (name scan in memory).
export async function findDuplicateIds(scopeRecruiterId?: string): Promise<Set<string>> {
  // 2026-06-11: strict own-only — no OR isNull. Recruiters can only see
  // duplicates among the candidates they own.
  const scope = scopeRecruiterId
    ? sql`AND c.recruiter_id = ${scopeRecruiterId}`
    : sql``;

  const result = await db.execute(sql`
    SELECT DISTINCT c.id::text AS id, c2.id::text AS other_id
    FROM candidates c
    JOIN candidates c2 ON c2.id <> c.id
      AND c2.anonymized_at IS NULL
      AND (
        (c2.email IS NOT NULL AND c.email IS NOT NULL AND lower(c2.email) = lower(c.email))
        OR (c2.phone IS NOT NULL AND c.phone IS NOT NULL AND c2.phone = c.phone)
        OR (lower(c2.name) = lower(c.name))
      )
    WHERE c.anonymized_at IS NULL
      ${scope}
  `);

  const ignored = await listIgnored('candidate');
  const ids = new Set<string>();
  for (const row of result.rows as { id: string; other_id: string }[]) {
    if (!ignored.has(pairKey(row.id, row.other_id))) {
      ids.add(row.id);
    }
  }
  return ids;
}

// Returns full Candidate records matching the given candidate by email, phone,
// or name (case-insensitive), excluding the input itself and pairs marked
// "not a duplicate". Used by the duplicate-manager modal.
export async function findDuplicatesOf(id: string): Promise<Candidate[]> {
  const target = await findById(id);
  if (!target || target.anonymizedAt) return [];

  const candidateMatches = await db.query.candidates.findMany({
    where: and(
      sql`${candidates.id} != ${id}`,
      isNull(candidates.anonymizedAt),
      or(
        target.email
          ? sql`lower(${candidates.email}) = lower(${target.email})`
          : undefined,
        target.phone ? eq(candidates.phone, target.phone) : undefined,
        sql`lower(${candidates.name}) = lower(${target.name})`,
      )!,
    )!,
  });

  const ignored = await listIgnored('candidate');
  return candidateMatches.filter((m) => !ignored.has(pairKey(id, m.id)));
}

export async function findDuplicates(input: {
  email?: string | null;
  phone?: string | null;
  name: string;
  excludeId?: string;
}): Promise<Candidate[]> {
  const conditions: SQL[] = [];
  const normEmail = normalizeEmail(input.email);
  const normPhone = normalizePhone(input.phone);
  const normName = normalizeName(input.name);
  if (normEmail) {
    conditions.push(eq(sql`lower(${candidates.email})`, normEmail));
  }
  if (normPhone) conditions.push(eq(candidates.phone, normPhone));
  if (normName) conditions.push(eq(sql`lower(${candidates.name})`, normName));

  const where = input.excludeId
    ? and(or(...conditions)!, sql`${candidates.id} != ${input.excludeId}`, isNull(candidates.anonymizedAt))!
    : and(or(...conditions)!, isNull(candidates.anonymizedAt))!;

  return db.query.candidates.findMany({ where });
}

// Best-effort dedup for public-form submissions. Matches by email OR phone OR
// name (case-insensitive). Returns the most recent non-anonymized match or null.
// Public submit NEVER blocks — this just tags the new row in notes.
export async function findFirstMatchingCandidate(input: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<{ id: string } | null> {
  const clauses: SQL[] = [];
  if (input.email) clauses.push(sql`lower(${candidates.email}) = lower(${input.email})`);
  if (input.phone) clauses.push(eq(candidates.phone, input.phone));
  if (input.name) clauses.push(sql`lower(${candidates.name}) = lower(${input.name})`);
  if (clauses.length === 0) return null;

  const row = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), or(...clauses)))
    .orderBy(desc(candidates.createdAt))
    .limit(1);

  return row[0] ?? null;
}

export async function insert(input: NewCandidate): Promise<Candidate> {
  const normalized = { ...input, email: normalizeEmail(input.email) };
  const [row] = await db.insert(candidates).values(normalized).returning();
  if (!row) throw new Error('Failed to insert candidate');
  return row;
}

export async function update(
  id: string,
  patch: Partial<NewCandidate>,
  exec: Executor = db,
): Promise<Candidate | undefined> {
  const normalized = patch.email !== undefined
    ? { ...patch, email: normalizeEmail(patch.email) }
    : patch;
  const [row] = await exec
    .update(candidates)
    .set({ ...normalized, updatedAt: new Date() })
    .where(eq(candidates.id, id))
    .returning();
  return row;
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(candidates).where(eq(candidates.id, id));
  return (result.rowCount ?? 0) > 0;
}

// Enriched row shape used by report-style queries that LEFT JOIN recruiter
// + coordinator names + project name in one round trip (avoids N+1).
export type EnrichedCandidateRow = Candidate & {
  recruiterFirstName: string | null;
  recruiterLastName: string | null;
  coordinatorFirstName: string | null;
  coordinatorLastName: string | null;
  freelancerFirstName: string | null;
  freelancerLastName: string | null;
  projectName: string | null;
};

// Failed Candidates Report (Yana, 2026-05-29).
//
// 2026-06-12: predicate rewritten to status IN ('cancelled', 'blacklist').
// The previous "status='cancelled' OR workEndReason IS NOT NULL" double-
// counted every dismissed client (workEndReason gets set on dismiss) so this
// report and the /dismissals registry shared the same rows. The split is now
// clean:
//   • /failed-candidates → status ∈ {cancelled, blacklist}  (didn't make it)
//   • /dismissals        → dismissals table  (worked, then was let go)
//
// Returns the same EnrichedCandidateRow shape as the main list so the
// frontend can render names directly without an N+1 lookup. Mirrors RBAC
// from `list`: recruiters see own + unassigned (OR-NULL); coordinators see
// strict own-only (FAZA 28). Anonymized rows are always excluded.
//
// Date range is applied to `updatedAt` — the canonical proxy for "when the
// status flipped" since there's no dedicated event timestamp.
export async function findFailedCandidates(
  query: ListCandidatesQuery,
  scopeRecruiterId?: string,
  scopeCoordinatorId?: string,
): Promise<{ items: EnrichedCandidateRow[]; total: number }> {
  const recruiter = alias(users, 'recruiter');
  const coordinator = alias(users, 'coordinator');

  const where: SQL[] = [
    isNull(candidates.anonymizedAt),
    // Core "failed" predicate — status ∈ {cancelled, blacklist}.
    inArray(candidates.status, ['cancelled', 'blacklist']),
  ];

  if (query.workEndReason) {
    where.push(eq(candidates.workEndReason, query.workEndReason));
  }
  if (query.projectId) where.push(eq(candidates.projectId, query.projectId));
  if (query.recruiterId) where.push(eq(candidates.recruiterId, query.recruiterId));
  if (query.coordinatorId) where.push(eq(candidates.coordinatorId, query.coordinatorId));

  if (scopeRecruiterId) {
    // 2026-06-11: strict own-only — no OR isNull.
    where.push(eq(candidates.recruiterId, scopeRecruiterId));
  }
  if (scopeCoordinatorId) {
    // FAZA 28: strict own-only — no OR isNull.
    where.push(eq(candidates.coordinatorId, scopeCoordinatorId));
  }

  if (query.q) {
    const term = `%${query.q}%`;
    where.push(ilike(candidates.name, term));
  }

  // Date range applies to updatedAt (when the row most recently changed —
  // best available proxy for the no-show event timestamp).
  const { since, until } = resolveDateRange({
    preset: query.preset,
    from: query.from,
    to: query.to,
  });
  if (since) where.push(gte(candidates.updatedAt, since));
  if (until) where.push(lt(candidates.updatedAt, until));

  const condition = and(...where);
  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        candidate: candidates,
        recruiterFirstName: recruiter.firstName,
        recruiterLastName: recruiter.lastName,
        coordinatorFirstName: coordinator.firstName,
        coordinatorLastName: coordinator.lastName,
        projectName: projects.name,
      })
      .from(candidates)
      .leftJoin(recruiter, eq(candidates.recruiterId, recruiter.id))
      .leftJoin(coordinator, eq(candidates.coordinatorId, coordinator.id))
      .leftJoin(projects, eq(candidates.projectId, projects.id))
      .where(condition)
      .orderBy(desc(candidates.updatedAt))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ c: count() }).from(candidates).where(condition).then((r) => r[0]),
  ]);

  const items: EnrichedCandidateRow[] = rows.map((r) => ({
    ...r.candidate,
    recruiterFirstName: r.recruiterFirstName,
    recruiterLastName: r.recruiterLastName,
    coordinatorFirstName: r.coordinatorFirstName,
    coordinatorLastName: r.coordinatorLastName,
    freelancerFirstName: null,
    freelancerLastName: null,
    projectName: r.projectName,
  }));

  return { items, total: totalRow?.c ?? 0 };
}
