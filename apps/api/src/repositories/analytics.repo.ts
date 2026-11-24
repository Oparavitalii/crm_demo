import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates } from '../db/tables/candidates';
import { users } from '../db/tables/users';
import { freelancers } from '../db/tables/freelancers';
import { dismissals } from '../db/tables/dismissals';
import { employmentPeriods } from '../db/tables/employment-periods';
import { statusLookups } from '../db/tables/status-lookups';
import { auditLog } from '../db/tables/audit-log';
import type { CandidateStatus } from '@opushr/shared';

// Statuses where the candidate is considered currently living somewhere.
// dismissed/blacklist/cancelled exclude the candidate from the housing count
// even if housing_type is still set (they've moved out as part of leaving).
const CURRENTLY_HOUSED_STATUSES = ['employed', 're_employed'] as const;

// Shared shape — every per-range query accepts these.
interface RangeOpts {
  scopeRecruiterId?: string;
  // 2026-06-12 — coordinator scope mirrors recruiter scope. Coordinator owns
  // clients (status='employed'/'re_employed'), so dashboard / housing /
  // bulk-send filtered by coordinatorId give them their personal slice.
  scopeCoordinatorId?: string;
  since?: Date;
  until?: Date;
  // 2026-06-12: leads entity retired. Optional status filter so the dashboard
  // can ask for "new" candidates as the funnel-entry equivalent of leads.
  status?: CandidateStatus;
}

// Adds candidate-table-specific filters (recruiter / coordinator scope +
// createdAt range). 2026-06-13 — both scopes are STRICT (recruiter_id /
// coordinator_id MUST equal the actor). Unassigned candidates are invisible
// to recruiters/coordinators by design — admin must triage them. This
// matches candidates.service.ts `canSee` semantics so dashboard / housing /
// bulk-send filter the same set as the candidates list.
function candidateRangeWhere(opts: RangeOpts) {
  const where = [isNull(candidates.anonymizedAt)];
  if (opts.scopeRecruiterId) {
    where.push(eq(candidates.recruiterId, opts.scopeRecruiterId));
  }
  if (opts.scopeCoordinatorId) {
    where.push(eq(candidates.coordinatorId, opts.scopeCoordinatorId));
  }
  if (opts.since) where.push(gte(candidates.createdAt, opts.since));
  if (opts.until) where.push(lt(candidates.createdAt, opts.until));
  if (opts.status) where.push(eq(candidates.status, opts.status));
  return where;
}

// ---------------------------------------------------------------------------
// countCandidates — active candidates, optionally scoped to recruiter and date.
// Status filter added 2026-06-12 to power the post-leads "new candidates" KPI.
// ---------------------------------------------------------------------------
export async function countCandidates(
  opts: { activeOnly: true } & RangeOpts,
): Promise<number> {
  const where = candidateRangeWhere(opts);
  const [row] = await db.select({ c: count() }).from(candidates).where(and(...where));
  return row?.c ?? 0;
}

// ---------------------------------------------------------------------------
// countCandidatesSince — candidates created on/after `since` (week-KPI helper).
// Kept as a focused helper since the "this week" KPI is locked to last 7 days
// regardless of dashboard range selection.
// ---------------------------------------------------------------------------
export async function countCandidatesSince(
  since: Date,
  scopeRecruiterId?: string,
  scopeCoordinatorId?: string,
): Promise<number> {
  return countCandidates({ activeOnly: true, scopeRecruiterId, scopeCoordinatorId, since });
}

// ---------------------------------------------------------------------------
// statusFunnel — candidates grouped by status, optionally date-filtered.
// ---------------------------------------------------------------------------
export async function statusFunnel(
  opts: RangeOpts = {},
): Promise<Array<{ status: CandidateStatus; count: number }>> {
  const where = candidateRangeWhere(opts);
  const rows = await db
    .select({ status: candidates.status, count: count() })
    .from(candidates)
    .where(and(...where))
    .groupBy(candidates.status);
  return rows.map((r) => ({ status: r.status as CandidateStatus, count: r.count }));
}

// ---------------------------------------------------------------------------
// sourceBreakdown — candidates grouped by source, optionally date-filtered.
// ---------------------------------------------------------------------------
export async function sourceBreakdown(
  opts: RangeOpts = {},
): Promise<Array<{ source: string | null; count: number }>> {
  const where = candidateRangeWhere(opts);
  const rows = await db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(and(...where))
    .groupBy(candidates.source);
  return rows.map((r) => ({ source: r.source as string | null, count: r.count }));
}

// ---------------------------------------------------------------------------
// recruiterKpi — admin-only view, semantics locked to "this month" for the
// activity counters (conversions/dismissals). Lifetime aggregates for the F13
// fields (arrivedCount, employedCount, avgTenureDays, sourceBreakdown) — these
// are KPI snapshots Yana asked for: total recruited, % who arrived, % who got
// employed, avg tenure of clients, and channel-of-acquisition mix.
// Not affected by dashboard range filter.
// ---------------------------------------------------------------------------
export async function recruiterKpi(
  opts: { since?: Date; until?: Date } = {},
): Promise<
  Array<{
    userId: string;
    fullName: string;
    isFreelancer: boolean;
    candidatesOwned: number;
    conversionsThisMonth: number;
    dismissalsThisMonth: number;
    arrivedCount: number;
    arrivedPercent: number;
    employedCount: number;
    employedPercent: number;
    avgTenureDays: number | null;
    totalTenureDays: number | null;
    sourceBreakdown: Record<string, number>;
    recruitedInPeriod: number;
    employedInPeriod: number;
    dismissedInPeriod: number;
  }>
> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const ownedQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), isNotNull(candidates.recruiterId)))
    .groupBy(candidates.recruiterId);

  // 2026-06-12: leads entity retired. "Conversions this month" was the count of
  // leads converted to candidates by this recruiter — now we count candidates
  // whose status was first set to a non-'new' value this month (proxy: any
  // candidate owned by this recruiter that was updated this month AND is no
  // longer in 'new' status). Same intent: "how many funnel-entries moved
  // forward".
  const conversionsQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        sql`${candidates.status} <> 'new'`,
        gte(candidates.updatedAt, monthStart),
      ),
    )
    .groupBy(candidates.recruiterId);

  const dismissedQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(dismissals)
    .innerJoin(candidates, eq(dismissals.candidateId, candidates.id))
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        gte(dismissals.dismissedAt, monthStart),
      ),
    )
    .groupBy(candidates.recruiterId);

  // F13: arrival = `arrivedAt` timestamp is set when the candidate reaches the
  // arrived gate (FAZA 26 backfilled past-arrived statuses), so this is a
  // lifetime count of "ever arrived" — what Yana cares about.
  // 2026-06-10: `arrival_status` column was dropped; we use `arrivedAt IS NOT NULL`
  // as the equivalent signal.
  const arrivedQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        isNotNull(candidates.arrivedAt),
      ),
    )
    .groupBy(candidates.recruiterId);

  // F13: kind='client' is set on first auto-promotion to employed (FAZA 19)
  // and is never flipped back, so a true lifetime "ever employed" count.
  const employedQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        eq(candidates.kind, 'client'),
      ),
    )
    .groupBy(candidates.recruiterId);

  // F13: avg + sum tenure in days. For active clients: now() - workStartDate.
  // For dismissed clients: workEndDate - workStartDate. NULL group = no clients.
  // 2026-06-10: candidate-level `employed_at` / `dismissed_at` were dropped —
  // `work_start_date` / `work_end_date` (form-driven) carry the same semantics.
  const tenureQ = db
    .select({
      recruiterId: candidates.recruiterId,
      avgDays: sql<string | null>`AVG(EXTRACT(EPOCH FROM (COALESCE(${candidates.workEndDate}, now()) - ${candidates.workStartDate})) / 86400)`,
      sumDays: sql<string | null>`SUM(EXTRACT(EPOCH FROM (COALESCE(${candidates.workEndDate}, now()) - ${candidates.workStartDate})) / 86400)`,
    })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        eq(candidates.kind, 'client'),
        isNotNull(candidates.workStartDate),
      ),
    )
    .groupBy(candidates.recruiterId);

  // F13: source breakdown per recruiter — "channel of acquisition" mix.
  const sourcesQ = db
    .select({
      recruiterId: candidates.recruiterId,
      source: candidates.source,
      cnt: count(),
    })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), isNotNull(candidates.recruiterId)))
    .groupBy(candidates.recruiterId, candidates.source);

  // Period-aware counters (client request 2026-07-08). Bounded by the selected
  // dashboard range; when a bound is undefined it falls back to epoch / now so
  // "all time" naturally counts everything.
  const sinceB = opts.since ?? new Date(0);
  const recruitedInPeriodQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        gte(candidates.createdAt, sinceB),
        ...(opts.until ? [lt(candidates.createdAt, opts.until)] : []),
      ),
    )
    .groupBy(candidates.recruiterId);

  const employedInPeriodQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(employmentPeriods)
    .innerJoin(candidates, eq(employmentPeriods.candidateId, candidates.id))
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        gte(employmentPeriods.employedAt, sinceB),
        ...(opts.until ? [lt(employmentPeriods.employedAt, opts.until)] : []),
      ),
    )
    .groupBy(candidates.recruiterId);

  const dismissedInPeriodQ = db
    .select({ recruiterId: candidates.recruiterId, cnt: count() })
    .from(employmentPeriods)
    .innerJoin(candidates, eq(employmentPeriods.candidateId, candidates.id))
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.recruiterId),
        isNotNull(employmentPeriods.dismissedAt),
        gte(employmentPeriods.dismissedAt, sinceB),
        ...(opts.until ? [lt(employmentPeriods.dismissedAt, opts.until)] : []),
      ),
    )
    .groupBy(candidates.recruiterId);

  const recruiterRowsQ = db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      isFreelancer: users.isFreelancer,
    })
    .from(users)
    .where(eq(users.role, 'recruiter'));

  const [
    owned,
    conversions,
    dismissed,
    arrived,
    employed,
    tenure,
    sources,
    recruitedPeriod,
    employedPeriod,
    dismissedPeriod,
    recruiterRows,
  ] = await Promise.all([
    ownedQ,
    conversionsQ,
    dismissedQ,
    arrivedQ,
    employedQ,
    tenureQ,
    sourcesQ,
    recruitedInPeriodQ,
    employedInPeriodQ,
    dismissedInPeriodQ,
    recruiterRowsQ,
  ]);

  const recruitedPeriodMap = new Map(recruitedPeriod.map((r) => [r.recruiterId, r.cnt]));
  const employedPeriodMap = new Map(employedPeriod.map((r) => [r.recruiterId, r.cnt]));
  const dismissedPeriodMap = new Map(dismissedPeriod.map((r) => [r.recruiterId, r.cnt]));

  const ownedMap = new Map(owned.map((r) => [r.recruiterId, r.cnt]));
  const convMap = new Map(conversions.map((r) => [r.recruiterId, r.cnt]));
  const dismissMap = new Map(dismissed.map((r) => [r.recruiterId, r.cnt]));
  const arrivedMap = new Map(arrived.map((r) => [r.recruiterId, r.cnt]));
  const employedMap = new Map(employed.map((r) => [r.recruiterId, r.cnt]));
  const tenureMap = new Map(
    tenure.map(
      (r) =>
        [
          r.recruiterId,
          {
            avg: r.avgDays === null ? null : Number(r.avgDays),
            sum: r.sumDays === null ? null : Number(r.sumDays),
          },
        ] as const,
    ),
  );
  const sourcesMap = new Map<string | null, Record<string, number>>();
  for (const r of sources) {
    const key = r.recruiterId;
    const entry = sourcesMap.get(key) ?? {};
    const srcLabel = r.source ?? 'unknown';
    entry[srcLabel] = (entry[srcLabel] ?? 0) + r.cnt;
    sourcesMap.set(key, entry);
  }

  return recruiterRows.map((u) => {
    const candidatesOwned = ownedMap.get(u.id) ?? 0;
    const arrivedCount = arrivedMap.get(u.id) ?? 0;
    const employedCount = employedMap.get(u.id) ?? 0;
    const rawTenure = tenureMap.get(u.id);
    const avgTenureDays =
      !rawTenure || rawTenure.avg === null || Number.isNaN(rawTenure.avg)
        ? null
        : Math.round(rawTenure.avg * 10) / 10;
    const totalTenureDays =
      !rawTenure || rawTenure.sum === null || Number.isNaN(rawTenure.sum)
        ? null
        : Math.round(rawTenure.sum * 10) / 10;
    return {
      userId: u.id,
      fullName: `${u.firstName} ${u.lastName}`,
      isFreelancer: u.isFreelancer,
      candidatesOwned,
      conversionsThisMonth: convMap.get(u.id) ?? 0,
      dismissalsThisMonth: dismissMap.get(u.id) ?? 0,
      arrivedCount,
      arrivedPercent: candidatesOwned === 0 ? 0 : arrivedCount / candidatesOwned,
      employedCount,
      employedPercent: candidatesOwned === 0 ? 0 : employedCount / candidatesOwned,
      avgTenureDays,
      totalTenureDays,
      sourceBreakdown: sourcesMap.get(u.id) ?? {},
      recruitedInPeriod: recruitedPeriodMap.get(u.id) ?? 0,
      employedInPeriod: employedPeriodMap.get(u.id) ?? 0,
      dismissedInPeriod: dismissedPeriodMap.get(u.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// coordinatorKpi — admin-only view of coordinator performance. Mirrors the
// `recruiterKpi` shape so the frontend can render a parallel table, but the
// metrics are housing-oriented because coordinators do not bring candidates
// in (recruiters do); they manage active employment / housing.
//
//   candidatesCoordinated — lifetime: any candidate where coordinatorId=user
//   currentlyHoused        — same coordinator AND open employment_period
//   housingUtilizationPercent — currentlyHoused / candidatesCoordinated
//   avgTenureDays          — avg across THEIR employment_periods
//   dismissalsThisMonth    — month-bound, joins through candidates
//
// isFreelancer is held at `false` for shape parity with recruiterKpi.
// ---------------------------------------------------------------------------
export async function coordinatorKpi(): Promise<
  Array<{
    userId: string;
    fullName: string;
    isFreelancer: boolean;
    candidatesCoordinated: number;
    currentlyHoused: number;
    housingUtilizationPercent: number;
    avgTenureDays: number | null;
    totalTenureDays: number | null;
    dismissalsThisMonth: number;
  }>
> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Lifetime "ever coordinated" — every candidate that has this coordinator
  // assigned, regardless of current status.
  const coordinatedQ = db
    .select({ coordinatorId: candidates.coordinatorId, cnt: count() })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), isNotNull(candidates.coordinatorId)))
    .groupBy(candidates.coordinatorId);

  // Currently housed = candidate has an OPEN employment_period (dismissedAt
  // IS NULL) and the candidate is still attached to this coordinator.
  const housedQ = db
    .select({ coordinatorId: candidates.coordinatorId, cnt: count() })
    .from(candidates)
    .innerJoin(
      employmentPeriods,
      eq(employmentPeriods.candidateId, candidates.id),
    )
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.coordinatorId),
        isNull(employmentPeriods.dismissedAt),
      ),
    )
    .groupBy(candidates.coordinatorId);

  // Avg tenure across THIS coordinator's employment_periods (active period:
  // now() - employedAt; dismissed period: dismissedAt - employedAt). We
  // attribute the period to whichever coordinator currently owns the
  // candidate row — mirrors how recruiterKpi attributes tenure.
  const tenureQ = db
    .select({
      coordinatorId: candidates.coordinatorId,
      avgDays: sql<string | null>`AVG(EXTRACT(EPOCH FROM (COALESCE(${employmentPeriods.dismissedAt}, now()) - ${employmentPeriods.employedAt})) / 86400)`,
      sumDays: sql<string | null>`SUM(EXTRACT(EPOCH FROM (COALESCE(${employmentPeriods.dismissedAt}, now()) - ${employmentPeriods.employedAt})) / 86400)`,
    })
    .from(candidates)
    .innerJoin(
      employmentPeriods,
      eq(employmentPeriods.candidateId, candidates.id),
    )
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.coordinatorId),
      ),
    )
    .groupBy(candidates.coordinatorId);

  const dismissedQ = db
    .select({ coordinatorId: candidates.coordinatorId, cnt: count() })
    .from(dismissals)
    .innerJoin(candidates, eq(dismissals.candidateId, candidates.id))
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.coordinatorId),
        gte(dismissals.dismissedAt, monthStart),
      ),
    )
    .groupBy(candidates.coordinatorId);

  const coordinatorRowsQ = db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(and(eq(users.role, 'coordinator'), eq(users.isActive, true)));

  const [coordinated, housed, tenure, dismissed, coordinatorRows] =
    await Promise.all([coordinatedQ, housedQ, tenureQ, dismissedQ, coordinatorRowsQ]);

  const coordinatedMap = new Map(coordinated.map((r) => [r.coordinatorId, r.cnt]));
  const housedMap = new Map(housed.map((r) => [r.coordinatorId, r.cnt]));
  const tenureMap = new Map(
    tenure.map(
      (r) =>
        [
          r.coordinatorId,
          {
            avg: r.avgDays === null ? null : Number(r.avgDays),
            sum: r.sumDays === null ? null : Number(r.sumDays),
          },
        ] as const,
    ),
  );
  const dismissMap = new Map(dismissed.map((r) => [r.coordinatorId, r.cnt]));

  return coordinatorRows.map((u) => {
    const candidatesCoordinated = coordinatedMap.get(u.id) ?? 0;
    const currentlyHoused = housedMap.get(u.id) ?? 0;
    const rawTenure = tenureMap.get(u.id);
    const avgTenureDays =
      !rawTenure || rawTenure.avg === null || Number.isNaN(rawTenure.avg)
        ? null
        : Math.round(rawTenure.avg * 10) / 10;
    const totalTenureDays =
      !rawTenure || rawTenure.sum === null || Number.isNaN(rawTenure.sum)
        ? null
        : Math.round(rawTenure.sum * 10) / 10;
    return {
      userId: u.id,
      fullName: `${u.firstName} ${u.lastName}`,
      isFreelancer: false,
      candidatesCoordinated,
      currentlyHoused,
      // div-zero guard — matches the convention used in recruiterKpi /
      // freelancerKpi (return 0, not NaN).
      housingUtilizationPercent:
        candidatesCoordinated === 0 ? 0 : currentlyHoused / candidatesCoordinated,
      avgTenureDays,
      totalTenureDays,
      dismissalsThisMonth: dismissMap.get(u.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// freelancerKpi — admin-only view of freelancer performance.
// Mirrors recruiterKpi shape with one addition: working count (candidates that
// reached the `working` status — the moment commission becomes earnable).
// "This month" semantics for activity counters (placements + dismissals).
// F13-mirror additions: arrived/employed counts+percents, avgTenureDays,
// sourceBreakdown — same lifetime semantics as recruiterKpi.
// ---------------------------------------------------------------------------
export async function freelancerKpi(): Promise<
  Array<{
    freelancerId: string;
    fullName: string;
    commissionRate: number | null;
    candidatesOwned: number;
    workingNow: number;
    dismissalsThisMonth: number;
    arrivedCount: number;
    arrivedPercent: number;
    employedCount: number;
    employedPercent: number;
    avgTenureDays: number | null;
    totalTenureDays: number | null;
    sourceBreakdown: Record<string, number>;
  }>
> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const ownedQ = db
    .select({ freelancerId: candidates.freelancerId, cnt: count() })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), isNotNull(candidates.freelancerId)))
    .groupBy(candidates.freelancerId);

  const workingQ = db
    .select({ freelancerId: candidates.freelancerId, cnt: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.freelancerId),
        eq(candidates.status, 'employed'),
      ),
    )
    .groupBy(candidates.freelancerId);

  const dismissedQ = db
    .select({ freelancerId: candidates.freelancerId, cnt: count() })
    .from(dismissals)
    .innerJoin(candidates, eq(dismissals.candidateId, candidates.id))
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.freelancerId),
        gte(dismissals.dismissedAt, monthStart),
      ),
    )
    .groupBy(candidates.freelancerId);

  // F13-mirror: `arrivedAt IS NOT NULL` is a lifetime "ever arrived" marker.
  // 2026-06-10: `arrival_status` column was dropped — `arrivedAt` is the
  // canonical signal now.
  const arrivedQ = db
    .select({ freelancerId: candidates.freelancerId, cnt: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.freelancerId),
        isNotNull(candidates.arrivedAt),
      ),
    )
    .groupBy(candidates.freelancerId);

  // F13-mirror: kind='client' = lifetime "ever employed" count.
  const employedQ = db
    .select({ freelancerId: candidates.freelancerId, cnt: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.freelancerId),
        eq(candidates.kind, 'client'),
      ),
    )
    .groupBy(candidates.freelancerId);

  // F13-mirror: avg + sum tenure in days for clients (active uses now(), dismissed
  // uses workEndDate). 2026-06-10: switched from dropped employed_at/dismissed_at.
  const tenureQ = db
    .select({
      freelancerId: candidates.freelancerId,
      avgDays: sql<string | null>`AVG(EXTRACT(EPOCH FROM (COALESCE(${candidates.workEndDate}, now()) - ${candidates.workStartDate})) / 86400)`,
      sumDays: sql<string | null>`SUM(EXTRACT(EPOCH FROM (COALESCE(${candidates.workEndDate}, now()) - ${candidates.workStartDate})) / 86400)`,
    })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        isNotNull(candidates.freelancerId),
        eq(candidates.kind, 'client'),
        isNotNull(candidates.workStartDate),
      ),
    )
    .groupBy(candidates.freelancerId);

  // F13-mirror: source breakdown per freelancer.
  const sourcesQ = db
    .select({
      freelancerId: candidates.freelancerId,
      source: candidates.source,
      cnt: count(),
    })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), isNotNull(candidates.freelancerId)))
    .groupBy(candidates.freelancerId, candidates.source);

  const freelancerRowsQ = db
    .select({
      id: freelancers.id,
      firstName: freelancers.firstName,
      lastName: freelancers.lastName,
      commissionRate: freelancers.commissionRate,
      isActive: freelancers.isActive,
    })
    .from(freelancers)
    .where(eq(freelancers.isActive, true));

  const [owned, working, dismissedThisMonth, arrived, employed, tenure, sources, freelancerRows] =
    await Promise.all([
      ownedQ,
      workingQ,
      dismissedQ,
      arrivedQ,
      employedQ,
      tenureQ,
      sourcesQ,
      freelancerRowsQ,
    ]);

  const ownedMap = new Map(owned.map((r) => [r.freelancerId, r.cnt]));
  const workingMap = new Map(working.map((r) => [r.freelancerId, r.cnt]));
  const dismissMap = new Map(dismissedThisMonth.map((r) => [r.freelancerId, r.cnt]));
  const arrivedMap = new Map(arrived.map((r) => [r.freelancerId, r.cnt]));
  const employedMap = new Map(employed.map((r) => [r.freelancerId, r.cnt]));
  const tenureMap = new Map(
    tenure.map(
      (r) =>
        [
          r.freelancerId,
          {
            avg: r.avgDays === null ? null : Number(r.avgDays),
            sum: r.sumDays === null ? null : Number(r.sumDays),
          },
        ] as const,
    ),
  );
  const sourcesMap = new Map<string | null, Record<string, number>>();
  for (const r of sources) {
    const key = r.freelancerId;
    const entry = sourcesMap.get(key) ?? {};
    const srcLabel = r.source ?? 'unknown';
    entry[srcLabel] = (entry[srcLabel] ?? 0) + r.cnt;
    sourcesMap.set(key, entry);
  }

  return freelancerRows.map((f) => {
    const candidatesOwned = ownedMap.get(f.id) ?? 0;
    const arrivedCount = arrivedMap.get(f.id) ?? 0;
    const employedCount = employedMap.get(f.id) ?? 0;
    const rawTenure = tenureMap.get(f.id);
    const avgTenureDays =
      !rawTenure || rawTenure.avg === null || Number.isNaN(rawTenure.avg)
        ? null
        : Math.round(rawTenure.avg * 10) / 10;
    const totalTenureDays =
      !rawTenure || rawTenure.sum === null || Number.isNaN(rawTenure.sum)
        ? null
        : Math.round(rawTenure.sum * 10) / 10;
    return {
      freelancerId: f.id,
      fullName: `${f.firstName} ${f.lastName}`.trim(),
      commissionRate: f.commissionRate !== null ? Number(f.commissionRate) : null,
      candidatesOwned,
      workingNow: workingMap.get(f.id) ?? 0,
      dismissalsThisMonth: dismissMap.get(f.id) ?? 0,
      arrivedCount,
      arrivedPercent: candidatesOwned === 0 ? 0 : arrivedCount / candidatesOwned,
      employedCount,
      employedPercent: candidatesOwned === 0 ? 0 : employedCount / candidatesOwned,
      avgTenureDays,
      totalTenureDays,
      sourceBreakdown: sourcesMap.get(f.id) ?? {},
    };
  });
}

// ---------------------------------------------------------------------------
// dailyTrend — per-day candidate counts for last N days.
// 2026-06-12: leads entity retired. The `leads` field on each row is held at 0
// so the frontend chart shape stays back-compatible.
// ---------------------------------------------------------------------------
export async function dailyTrend(
  days: number,
  scopeRecruiterId?: string,
  scopeCoordinatorId?: string,
): Promise<Array<{ date: string; candidates: number; leads: number }>> {
  const since = new Date(Date.now() - days * 86_400_000);

  const candidateWhere = candidateRangeWhere({ scopeRecruiterId, scopeCoordinatorId, since });
  const candidateRows = await db
    .select({
      day: sql<string>`date_trunc('day', ${candidates.createdAt})::date::text`,
      cnt: count(),
    })
    .from(candidates)
    .where(and(...candidateWhere))
    .groupBy(sql`date_trunc('day', ${candidates.createdAt})`);

  const dayMap = new Map<string, { candidates: number; leads: number }>();
  for (const r of candidateRows) {
    if (!r.day) continue;
    const entry = dayMap.get(r.day) ?? { candidates: 0, leads: 0 };
    entry.candidates = r.cnt;
    dayMap.set(r.day, entry);
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }));
}

// ---------------------------------------------------------------------------
// retentionBySource — working vs dismissed by source.
// Date filter applied to candidate creation (when candidate entered the funnel).
// ---------------------------------------------------------------------------
export async function retentionBySource(opts: RangeOpts = {}): Promise<
  Array<{
    source: string | null;
    workingCount: number;
    dismissedCount: number;
    retentionRate: number;
  }>
> {
  const where = candidateRangeWhere(opts);
  const rows = await db
    .select({ source: candidates.source, status: candidates.status, cnt: count() })
    .from(candidates)
    .where(and(...where))
    .groupBy(candidates.source, candidates.status);

  const map = new Map<string | null, { workingCount: number; dismissedCount: number }>();
  for (const r of rows) {
    // FAZA 19: `employed` replaces `working`. The output shape keeps
    // `workingCount` for back-compat with frontend RetentionBySource panel.
    if (r.status !== 'employed' && r.status !== 'dismissed') continue;
    const key = (r.source as string | null) ?? null;
    const entry = map.get(key) ?? { workingCount: 0, dismissedCount: 0 };
    if (r.status === 'employed') entry.workingCount = r.cnt;
    else if (r.status === 'dismissed') entry.dismissedCount = r.cnt;
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .map(([source, v]) => {
      const total = v.workingCount + v.dismissedCount;
      const retentionRate = total === 0 ? 0 : v.workingCount / total;
      return { source, ...v, retentionRate };
    })
    .sort((a, b) => b.workingCount + b.dismissedCount - (a.workingCount + a.dismissedCount));
}

// ---------------------------------------------------------------------------
// periodEmploymentStats — client request 2026-07-08. Workforce counters that
// respect the selected dashboard range, sourced from employment_periods so
// re-hires count as separate episodes. See periodStatsSchema for field meaning.
// `avgDaysWorking` is deliberately "as of today" (client wording: станом на
// поточну дату); the other window bounds use until (exclusive) / since.
// ---------------------------------------------------------------------------
export async function periodEmploymentStats(opts: RangeOpts = {}): Promise<{
  employedInPeriod: number;
  finishedInPeriod: number;
  workingAsOf: number;
  avgDaysFinished: number | null;
  avgDaysWorking: number | null;
  totalDaysInPeriod: number;
}> {
  const lower = sql`${opts.since ?? new Date(0)}`;
  const upper = opts.until ? sql`${opts.until}` : sql`now()`;

  const scope = [isNull(candidates.anonymizedAt)];
  if (opts.scopeRecruiterId) scope.push(eq(candidates.recruiterId, opts.scopeRecruiterId));
  if (opts.scopeCoordinatorId) scope.push(eq(candidates.coordinatorId, opts.scopeCoordinatorId));

  const emp = employmentPeriods.employedAt;
  const dis = employmentPeriods.dismissedAt;
  const [row] = await db
    .select({
      employedInPeriod: sql<string>`count(*) filter (where ${emp} >= ${lower} and ${emp} < ${upper})`,
      finishedInPeriod: sql<string>`count(*) filter (where ${dis} >= ${lower} and ${dis} < ${upper})`,
      workingAsOf: sql<string>`count(*) filter (where ${emp} < ${upper} and (${dis} is null or ${dis} >= ${upper}))`,
      // `${dis} >= ${emp}` guards against data-entry errors (dismissal dated
      // before hire) that would otherwise contribute negative tenure and drag
      // the average below zero.
      avgDaysFinished: sql<
        string | null
      >`avg(extract(epoch from (${dis} - ${emp})) / 86400) filter (where ${dis} >= ${lower} and ${dis} < ${upper} and ${dis} >= ${emp})`,
      // Only episodes that have actually started (employed_at <= now) count as
      // "currently working"; a future-dated hire would yield negative days.
      avgDaysWorking: sql<
        string | null
      >`avg(extract(epoch from (now() - ${emp})) / 86400) filter (where ${dis} is null and ${emp} <= now())`,
      totalDaysInPeriod: sql<
        string | null
      >`coalesce(sum(greatest(0, extract(epoch from (least(coalesce(${dis}, now()), ${upper}) - greatest(${emp}, ${lower}))) / 86400)), 0)`,
    })
    .from(employmentPeriods)
    .innerJoin(candidates, eq(employmentPeriods.candidateId, candidates.id))
    .where(and(...scope));

  const num = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : Math.round(n * 10) / 10;
  };
  return {
    employedInPeriod: Number(row?.employedInPeriod ?? 0),
    finishedInPeriod: Number(row?.finishedInPeriod ?? 0),
    workingAsOf: Number(row?.workingAsOf ?? 0),
    avgDaysFinished: num(row?.avgDaysFinished ?? null),
    avgDaysWorking: num(row?.avgDaysWorking ?? null),
    totalDaysInPeriod: num(row?.totalDaysInPeriod ?? '0') ?? 0,
  };
}

// ---------------------------------------------------------------------------
// retentionSplits — client request 2026-07-10. Two ORTHOGONAL retention views,
// both counting working/dismissed from employment_periods (so they reconcile
// with periodEmploymentStats — the old single table used candidate.status and
// disagreed with the "Працює" tile):
//   • byRecruiterType — Штат / Фриланс / Без рекрутера (owner-based, children
//     per recruiter). Grouping by owner reclaims the ~89% unknown-source
//     clients the old source-only grouping dumped into "Невідомо".
//   • byChannel — Соцмережі / Job-сайти / Наш сайт / Форма / Невідомо
//     (source-based), fixed sub-source children shown even at 0 so the client
//     sees the full structure.
// working   = episode open as of `until` (matches workingAsOf)
// dismissed = episode closed within [since, until) (matches finishedInPeriod)
// ---------------------------------------------------------------------------
// Retention channels a source can belong to. Assigned per-source by admins in
// /admin/settings/statuses (status_lookups.group_key); 'unknown' is reserved
// for null/unknown/none sources and is never admin-assignable.
const CHANNEL_KEYS = ['social', 'jobBoards', 'website', 'formRecruiter', 'other'] as const;
const VALID_CHANNELS = new Set<string>(CHANNEL_KEYS);
const NULL_SOURCES = new Set(['unknown', 'none']);

// 2026-07-10 — every bucket/child accumulates the six period metrics of the
// PeriodStats tiles. Averages are carried as (sum, cnt) pairs so re-grouping
// SQL rows into buckets stays a weighted average, not an average of averages.
interface RetentionMetrics {
  workingCount: number;
  dismissedCount: number;
  employedInPeriod: number;
  finishedDaysSum: number;
  finishedDaysCnt: number;
  workingDaysSum: number;
  workingDaysCnt: number;
  totalDays: number;
}
interface RetentionChild extends RetentionMetrics {
  label: string;
  code: string | null;
}
interface RetentionBucket extends RetentionMetrics {
  key: string;
  children: Map<string, RetentionChild>;
}
export interface RetentionPeriodMetrics {
  employedInPeriod: number;
  avgDaysFinished: number | null;
  avgDaysWorking: number | null;
  totalDaysInPeriod: number;
  // Sample sizes behind the averages — the UI shows them as a small colored
  // count next to the value (client request 2026-07-10).
  avgDaysFinishedCnt: number;
  avgDaysWorkingCnt: number;
  // Overall average tenure across BOTH populations (working + finished),
  // weighted by episodes — not an average of the two averages.
  avgDaysAll: number | null;
  avgDaysAllCnt: number;
}
export interface RetentionCategory extends RetentionPeriodMetrics {
  key: string;
  workingCount: number;
  dismissedCount: number;
  retentionRate: number;
  children: Array<
    Pick<RetentionChild, 'label' | 'code' | 'workingCount' | 'dismissedCount'> &
      RetentionPeriodMetrics & { retentionRate: number }
  >;
}

const zeroMetrics = (): RetentionMetrics => ({
  workingCount: 0,
  dismissedCount: 0,
  employedInPeriod: 0,
  finishedDaysSum: 0,
  finishedDaysCnt: 0,
  workingDaysSum: 0,
  workingDaysCnt: 0,
  totalDays: 0,
});

const addMetrics = (into: RetentionMetrics, m: RetentionMetrics): void => {
  into.workingCount += m.workingCount;
  into.dismissedCount += m.dismissedCount;
  into.employedInPeriod += m.employedInPeriod;
  into.finishedDaysSum += m.finishedDaysSum;
  into.finishedDaysCnt += m.finishedDaysCnt;
  into.workingDaysSum += m.workingDaysSum;
  into.workingDaysCnt += m.workingDaysCnt;
  into.totalDays += m.totalDays;
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

// Collapse the (sum, cnt) pairs into the response shape shared with tiles.
const finishMetrics = (m: RetentionMetrics): RetentionPeriodMetrics => {
  const allCnt = m.finishedDaysCnt + m.workingDaysCnt;
  return {
    employedInPeriod: m.employedInPeriod,
    avgDaysFinished: m.finishedDaysCnt > 0 ? round1(m.finishedDaysSum / m.finishedDaysCnt) : null,
    avgDaysWorking: m.workingDaysCnt > 0 ? round1(m.workingDaysSum / m.workingDaysCnt) : null,
    totalDaysInPeriod: round1(m.totalDays),
    avgDaysFinishedCnt: m.finishedDaysCnt,
    avgDaysWorkingCnt: m.workingDaysCnt,
    avgDaysAll: allCnt > 0 ? round1((m.finishedDaysSum + m.workingDaysSum) / allCnt) : null,
    avgDaysAllCnt: allCnt,
  };
};

const rateOf = (w: number, d: number): number => (w + d === 0 ? 0 : w / (w + d));

// ---------------------------------------------------------------------------
// Shared SQL fragments for the six-metric workforce block — single source of
// truth so retentionSplits and workforceByUser can never drift apart. Same
// window definitions as periodEmploymentStats, so everything reconciles with
// the tiles. Averages travel as (sum, cnt) pairs — callers re-aggregate them
// as weighted averages via finishMetrics.
// ---------------------------------------------------------------------------
function workforceSql(opts: RangeOpts) {
  const lower = sql`${opts.since ?? new Date(0)}`;
  const upper = opts.until ? sql`${opts.until}` : sql`now()`;
  const emp = employmentPeriods.employedAt;
  const dis = employmentPeriods.dismissedAt;
  const isWorking = sql`${emp} < ${upper} and (${dis} is null or ${dis} >= ${upper})`;
  const isDismissed = sql`${dis} >= ${lower} and ${dis} < ${upper}`;
  const selects = {
    working: sql<string>`count(*) filter (where ${isWorking})`,
    dismissed: sql<string>`count(*) filter (where ${isDismissed})`,
    employedIn: sql<string>`count(*) filter (where ${emp} >= ${lower} and ${emp} < ${upper})`,
    finishedDaysSum: sql<
      string | null
    >`sum(extract(epoch from (${dis} - ${emp})) / 86400) filter (where ${isDismissed} and ${dis} >= ${emp})`,
    finishedDaysCnt: sql<string>`count(*) filter (where ${isDismissed} and ${dis} >= ${emp})`,
    workingDaysSum: sql<
      string | null
    >`sum(extract(epoch from (now() - ${emp})) / 86400) filter (where ${dis} is null and ${emp} <= now())`,
    workingDaysCnt: sql<string>`count(*) filter (where ${dis} is null and ${emp} <= now())`,
    totalDays: sql<
      string | null
    >`sum(greatest(0, extract(epoch from (least(coalesce(${dis}, now()), ${upper}) - greatest(${emp}, ${lower}))) / 86400))`,
  };
  // Episodes contributing to ANY of the six metrics. The `dis is null` arm
  // keeps avgDaysWorking consistent with the tile (which counts ALL open
  // episodes, window-independent) even when the selected range ends in the
  // past; the `emp` window arm keeps employedInPeriod reconciling with the
  // tile even for corrupt episodes dated dismissed-before-hired.
  const rowCondition = sql`((${isWorking}) or (${isDismissed}) or (${dis} is null and ${emp} <= now()) or (${emp} >= ${lower} and ${emp} < ${upper}))`;
  return { emp, dis, isWorking, isDismissed, selects, rowCondition };
}

interface WorkforceRow {
  working: string;
  dismissed: string;
  employedIn: string;
  finishedDaysSum: string | null;
  finishedDaysCnt: string;
  workingDaysSum: string | null;
  workingDaysCnt: string;
  totalDays: string | null;
}

const rowToMetrics = (r: WorkforceRow): RetentionMetrics => ({
  workingCount: Number(r.working),
  dismissedCount: Number(r.dismissed),
  employedInPeriod: Number(r.employedIn),
  finishedDaysSum: Number(r.finishedDaysSum ?? 0),
  finishedDaysCnt: Number(r.finishedDaysCnt),
  workingDaysSum: Number(r.workingDaysSum ?? 0),
  workingDaysCnt: Number(r.workingDaysCnt),
  totalDays: Number(r.totalDays ?? 0),
});

// ---------------------------------------------------------------------------
// workforceByUser — 2026-07-10 client request: the «Рекрутери»/«Координатори»
// tabs show the same six-metric block as the retention tables. Recruiters
// group by the candidate's owner (matches the byRecruiterType children);
// coordinators group by the EPISODE coordinator (employment_periods
// .coordinator_id) so history stays attributed to whoever coordinated it.
// ---------------------------------------------------------------------------
export interface UserWorkforceMetrics extends RetentionPeriodMetrics {
  workingCount: number;
  dismissedCount: number;
  retentionRate: number;
}

export async function workforceByUser(opts: RangeOpts = {}): Promise<{
  byRecruiter: Map<string, UserWorkforceMetrics>;
  byCoordinator: Map<string, UserWorkforceMetrics>;
}> {
  const { selects, rowCondition } = workforceSql(opts);

  const [recruiterRows, coordinatorRows] = await Promise.all([
    db
      .select({ id: candidates.recruiterId, ...selects })
      .from(employmentPeriods)
      .innerJoin(candidates, eq(employmentPeriods.candidateId, candidates.id))
      .where(and(isNull(candidates.anonymizedAt), isNotNull(candidates.recruiterId), rowCondition))
      .groupBy(candidates.recruiterId),
    db
      .select({ id: employmentPeriods.coordinatorId, ...selects })
      .from(employmentPeriods)
      .innerJoin(candidates, eq(employmentPeriods.candidateId, candidates.id))
      .where(
        and(isNull(candidates.anonymizedAt), isNotNull(employmentPeriods.coordinatorId), rowCondition),
      )
      .groupBy(employmentPeriods.coordinatorId),
  ]);

  const finish = (
    rows: Array<WorkforceRow & { id: string | null }>,
  ): Map<string, UserWorkforceMetrics> => {
    const m = new Map<string, UserWorkforceMetrics>();
    for (const r of rows) {
      if (!r.id) continue;
      const metrics = rowToMetrics(r);
      m.set(r.id, {
        workingCount: metrics.workingCount,
        dismissedCount: metrics.dismissedCount,
        retentionRate: rateOf(metrics.workingCount, metrics.dismissedCount),
        ...finishMetrics(metrics),
      });
    }
    return m;
  };

  return { byRecruiter: finish(recruiterRows), byCoordinator: finish(coordinatorRows) };
}

export async function retentionSplits(opts: RangeOpts = {}): Promise<{
  byRecruiterType: RetentionCategory[];
  byChannel: RetentionCategory[];
}> {
  const scope = [isNull(candidates.anonymizedAt)];
  if (opts.scopeRecruiterId) scope.push(eq(candidates.recruiterId, opts.scopeRecruiterId));
  if (opts.scopeCoordinatorId) scope.push(eq(candidates.coordinatorId, opts.scopeCoordinatorId));

  const { selects, rowCondition } = workforceSql(opts);

  const rows = await db
    .select({
      ownerType: sql<string>`case when ${candidates.recruiterId} is null then 'no_recruiter' when ${users.isFreelancer} then 'freelance' else 'staff' end`,
      recruiterId: candidates.recruiterId,
      firstName: users.firstName,
      lastName: users.lastName,
      source: candidates.source,
      ...selects,
    })
    .from(employmentPeriods)
    .innerJoin(candidates, eq(employmentPeriods.candidateId, candidates.id))
    .leftJoin(users, eq(candidates.recruiterId, users.id))
    .where(and(...scope, rowCondition))
    .groupBy(
      candidates.recruiterId,
      users.isFreelancer,
      users.firstName,
      users.lastName,
      candidates.source,
    );

  // Source → channel classification is admin-editable (status_lookups.group_key),
  // so a newly-added source lands in the right channel without a code change.
  // Its children skeleton (shown even at 0) is also derived from the lookup.
  const sourceRows = await db
    .select({ code: statusLookups.code, groupKey: statusLookups.groupKey })
    .from(statusLookups)
    .where(and(eq(statusLookups.type, 'sources'), isNull(statusLookups.deletedAt)));
  const channelByCode = new Map<string, string>();
  const childrenByChannel: Record<string, string[]> = {};
  for (const s of sourceRows) {
    if (NULL_SOURCES.has(s.code)) continue; // unknown/none form the 'unknown' bucket
    const chKey = s.groupKey && VALID_CHANNELS.has(s.groupKey) ? s.groupKey : 'other';
    channelByCode.set(s.code, chKey);
    (childrenByChannel[chKey] ??= []).push(s.code);
  }
  const channelOf = (source: string | null): string => {
    if (!source || NULL_SOURCES.has(source)) return 'unknown';
    return channelByCode.get(source) ?? 'other';
  };

  const rt = new Map<string, RetentionBucket>();
  const ch = new Map<string, RetentionBucket>();
  const getBucket = (m: Map<string, RetentionBucket>, key: string): RetentionBucket => {
    let b = m.get(key);
    if (!b) {
      b = { key, ...zeroMetrics(), children: new Map() };
      m.set(key, b);
    }
    return b;
  };
  const addChild = (
    b: RetentionBucket,
    id: string,
    label: string,
    code: string | null,
    m: RetentionMetrics,
  ) => {
    let c = b.children.get(id);
    if (!c) {
      c = { label, code, ...zeroMetrics() };
      b.children.set(id, c);
    }
    addMetrics(c, m);
  };

  for (const r of rows) {
    const m = rowToMetrics(r);
    // Skip rows that contribute nothing to any of the six metrics.
    if (
      m.workingCount === 0 &&
      m.dismissedCount === 0 &&
      m.employedInPeriod === 0 &&
      m.workingDaysCnt === 0 &&
      m.totalDays <= 0
    ) {
      continue;
    }

    // recruiter-type view
    const rtb = getBucket(rt, r.ownerType);
    addMetrics(rtb, m);
    if (r.ownerType !== 'no_recruiter' && r.recruiterId) {
      const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || '—';
      addChild(rtb, r.recruiterId, name, null, m);
    }

    // channel view
    const source = r.source as string | null;
    const chKey = channelOf(source);
    const chb = getBucket(ch, chKey);
    addMetrics(chb, m);
    if (chKey !== 'unknown' && source) {
      addChild(chb, source, source, source, m);
    }
  }

  const rate = (w: number, d: number): number => (w + d === 0 ? 0 : w / (w + d));
  const byTotalDesc = (
    a: { workingCount: number; dismissedCount: number },
    b: { workingCount: number; dismissedCount: number },
  ) => b.workingCount + b.dismissedCount - (a.workingCount + a.dismissedCount);

  // Emit a fixed category list (shown even at 0) with resolved children.
  const emit = (
    m: Map<string, RetentionBucket>,
    order: string[],
    fixedChildren: Record<string, readonly string[]>,
  ): RetentionCategory[] =>
    order.map((key) => {
      const b = m.get(key);
      const childMap = new Map<string, RetentionChild>(b ? b.children : []);
      const fixed = fixedChildren[key] ?? [];
      for (const code of fixed) {
        if (!childMap.has(code)) {
          childMap.set(code, { label: code, code, ...zeroMetrics() });
        }
      }
      const children = [...childMap.values()]
        .map((c) => ({
          label: c.label,
          code: c.code,
          workingCount: c.workingCount,
          dismissedCount: c.dismissedCount,
          retentionRate: rate(c.workingCount, c.dismissedCount),
          ...finishMetrics(c),
        }))
        .sort((a, cc) => {
          // Fixed sub-sources keep their defined order; the rest by total desc.
          const ia = a.code ? fixed.indexOf(a.code) : -1;
          const ib = cc.code ? fixed.indexOf(cc.code) : -1;
          if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          return byTotalDesc(a, cc);
        });
      const bm = b ?? { key, ...zeroMetrics(), children: new Map<string, RetentionChild>() };
      return {
        key,
        workingCount: bm.workingCount,
        dismissedCount: bm.dismissedCount,
        retentionRate: rate(bm.workingCount, bm.dismissedCount),
        ...finishMetrics(bm),
        children,
      };
    });

  return {
    byRecruiterType: emit(rt, ['staff', 'freelance', 'no_recruiter'], {}),
    byChannel: emit(
      ch,
      ['social', 'jobBoards', 'website', 'formRecruiter', 'other', 'unknown'],
      childrenByChannel,
    ),
  };
}

// ---------------------------------------------------------------------------
// housingStats — current state (not time-bound). Counts candidates who are
// currently considered housed (status indicates active engagement) grouped by
// housing_type. Dismissed/blacklist candidates are excluded — they've left.
// ---------------------------------------------------------------------------
export async function housingStats(opts: {
  scopeRecruiterId?: string;
  scopeCoordinatorId?: string;
} = {}): Promise<{
  ourHousingCount: number;
  ownHousingCount: number;
}> {
  const where = [
    isNull(candidates.anonymizedAt),
    isNotNull(candidates.housingType),
    inArray(candidates.status, CURRENTLY_HOUSED_STATUSES),
  ];
  if (opts.scopeRecruiterId) {
    where.push(eq(candidates.recruiterId, opts.scopeRecruiterId));
  }
  if (opts.scopeCoordinatorId) {
    where.push(eq(candidates.coordinatorId, opts.scopeCoordinatorId));
  }
  const rows = await db
    .select({ housingType: candidates.housingType, cnt: count() })
    .from(candidates)
    .where(and(...where))
    .groupBy(candidates.housingType);

  let ourHousingCount = 0;
  let ownHousingCount = 0;
  for (const r of rows) {
    if (r.housingType === 'our') ourHousingCount = Number(r.cnt);
    else if (r.housingType === 'own') ownHousingCount = Number(r.cnt);
  }
  return { ourHousingCount, ownHousingCount };
}

// Detailed housing rows for the /accommodations summary page — same
// status+housing_type filter as housingStats, plus name/status/updatedAt
// so the UI can render two candidate tables.
export async function housingCandidates(opts: {
  scopeRecruiterId?: string;
  scopeCoordinatorId?: string;
} = {}): Promise<
  Array<{
    id: string;
    name: string;
    status: CandidateStatus;
    housingType: string;
    updatedAt: Date;
  }>
> {
  const where = [
    isNull(candidates.anonymizedAt),
    isNotNull(candidates.housingType),
    inArray(candidates.status, CURRENTLY_HOUSED_STATUSES),
  ];
  if (opts.scopeRecruiterId) {
    where.push(eq(candidates.recruiterId, opts.scopeRecruiterId));
  }
  if (opts.scopeCoordinatorId) {
    where.push(eq(candidates.coordinatorId, opts.scopeCoordinatorId));
  }
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      status: candidates.status,
      housingType: candidates.housingType,
      updatedAt: candidates.updatedAt,
    })
    .from(candidates)
    .where(and(...where))
    .orderBy(sql`${candidates.updatedAt} DESC`);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status as CandidateStatus,
    housingType: r.housingType ?? '',
    updatedAt: r.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// userProfileStatsRaw — single-user analytics drill-down (recruiter or
// coordinator). Scope column is whichever FK the role uses. Returns the
// raw aggregates; the service shapes them into the response.
// ---------------------------------------------------------------------------

// Statuses considered "currently employed" for the retention metric (active
// engagement with the agency).
const CURRENTLY_EMPLOYED_STATUSES = ['employed', 're_employed'] as const;

export type UserStatsScope = 'recruiter' | 'coordinator' | 'freelancer';

function scopeColumn(scope: UserStatsScope) {
  if (scope === 'recruiter') return candidates.recruiterId;
  if (scope === 'coordinator') return candidates.coordinatorId;
  // 2026-06-16: 'freelancer' scope added so external freelancers (no user
  // account) get the same per-user analytics drill-down. Same WHERE shape —
  // just a different FK column. All existing userStats* helpers Just Work.
  return candidates.freelancerId;
}

export async function userStatsFunnel(
  userId: string,
  scope: UserStatsScope,
): Promise<Array<{ status: CandidateStatus; count: number }>> {
  const col = scopeColumn(scope);
  const rows = await db
    .select({ status: candidates.status, count: count() })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), eq(col, userId)))
    .groupBy(candidates.status);
  return rows.map((r) => ({ status: r.status as CandidateStatus, count: r.count }));
}

export async function userStatsSourceBreakdown(
  userId: string,
  scope: UserStatsScope,
): Promise<Array<{ source: string | null; count: number }>> {
  const col = scopeColumn(scope);
  const rows = await db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), eq(col, userId)))
    .groupBy(candidates.source);
  return rows.map((r) => ({ source: r.source as string | null, count: r.count }));
}

// "Ever employed" = at least one employment_periods row OR kind='client'.
// Using kind='client' alone (cheap) — it's set on first promotion and never
// flips back, mirroring recruiterKpi semantics.
export async function userStatsRetention(
  userId: string,
  scope: UserStatsScope,
): Promise<{ totalEverEmployed: number; currentlyEmployed: number }> {
  const col = scopeColumn(scope);
  const everQ = db
    .select({ c: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        eq(col, userId),
        eq(candidates.kind, 'client'),
      ),
    );
  const nowQ = db
    .select({ c: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        eq(col, userId),
        inArray(candidates.status, CURRENTLY_EMPLOYED_STATUSES),
      ),
    );
  const [everRow, nowRow] = await Promise.all([everQ, nowQ]);
  return {
    totalEverEmployed: everRow[0]?.c ?? 0,
    currentlyEmployed: nowRow[0]?.c ?? 0,
  };
}

// Avg days between candidate.createdAt and the FIRST employment_periods.employedAt.
// Returns null if no candidates have ever been employed (no joined rows).
export async function userStatsAvgTimeToHireDays(
  userId: string,
  scope: UserStatsScope,
): Promise<number | null> {
  const col = scopeColumn(scope);
  const rows = await db
    .select({
      avgDays: sql<string | null>`AVG(EXTRACT(EPOCH FROM (${employmentPeriods.employedAt} - ${candidates.createdAt})) / 86400)`,
    })
    .from(candidates)
    .innerJoin(
      employmentPeriods,
      eq(employmentPeriods.candidateId, candidates.id),
    )
    .where(and(isNull(candidates.anonymizedAt), eq(col, userId)));
  const raw = rows[0]?.avgDays;
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  if (Number.isNaN(num)) return null;
  return Math.round(num * 10) / 10;
}

export async function userStatsRecentCandidates(
  userId: string,
  scope: UserStatsScope,
  limit = 10,
): Promise<Array<{ id: string; name: string; status: string; createdAt: Date }>> {
  const col = scopeColumn(scope);
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      status: candidates.status,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .where(and(isNull(candidates.anonymizedAt), eq(col, userId)))
    .orderBy(desc(candidates.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status as string,
    createdAt: r.createdAt,
  }));
}

// Dismissal reasons attributed to this user's candidates. Joins via
// candidates.recruiterId / coordinatorId so the dismissal is counted against
// whoever currently owns the row. Uses reason_code (canonical enum) when set,
// else the free-text reason. RODO: counts only.
export async function userStatsDismissalReasons(
  userId: string,
  scope: UserStatsScope,
): Promise<Array<{ reason: string; count: number }>> {
  const col = scopeColumn(scope);
  const rows = await db
    .select({
      reasonCode: dismissals.reasonCode,
      reason: dismissals.reason,
      count: count(),
    })
    .from(dismissals)
    .innerJoin(candidates, eq(dismissals.candidateId, candidates.id))
    .where(and(isNull(candidates.anonymizedAt), eq(col, userId)))
    .groupBy(dismissals.reasonCode, dismissals.reason);
  return rows.map((r) => ({
    reason: r.reasonCode ?? r.reason ?? 'unknown',
    count: r.count,
  }));
}

// "Housed" pool for the coordinator housing-utilization metric. Every
// candidate this coordinator has ever managed (coordinatorId=userId) counts —
// then `currentlyEmployed` (status in employed/re_employed) is divided into it.
export async function userStatsHousingUtilization(
  userId: string,
): Promise<{ totalHoused: number; currentlyEmployed: number }> {
  const totalQ = db
    .select({ c: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        eq(candidates.coordinatorId, userId),
      ),
    );
  const nowQ = db
    .select({ c: count() })
    .from(candidates)
    .where(
      and(
        isNull(candidates.anonymizedAt),
        eq(candidates.coordinatorId, userId),
        inArray(candidates.status, CURRENTLY_EMPLOYED_STATUSES),
      ),
    );
  const [totalRow, nowRow] = await Promise.all([totalQ, nowQ]);
  return {
    totalHoused: totalRow[0]?.c ?? 0,
    currentlyEmployed: nowRow[0]?.c ?? 0,
  };
}

// ---------------------------------------------------------------------------
// adminStats — users by role + audit volume this month (locked semantics).
// ---------------------------------------------------------------------------
export async function adminStats(): Promise<{
  byRole: Array<{
    role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
    active: number;
    inactive: number;
  }>;
  totalActive: number;
  totalInactive: number;
  auditEventsThisMonth: number;
}> {
  const userRows = await db
    .select({
      role: users.role,
      active: sql<number>`COUNT(*) FILTER (WHERE ${users.isActive})`,
      inactive: sql<number>`COUNT(*) FILTER (WHERE NOT ${users.isActive})`,
    })
    .from(users)
    .groupBy(users.role);

  let totalActive = 0;
  let totalInactive = 0;
  const byRole = userRows.map((r) => {
    const a = Number(r.active);
    const i = Number(r.inactive);
    totalActive += a;
    totalInactive += i;
    return {
      role: r.role as 'admin' | 'recruiter' | 'coordinator' | 'readonly',
      active: a,
      inactive: i,
    };
  });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [auditRow] = await db
    .select({ c: count() })
    .from(auditLog)
    .where(gte(auditLog.createdAt, monthStart));

  return {
    byRole,
    totalActive,
    totalInactive,
    auditEventsThisMonth: Number(auditRow?.c ?? 0),
  };
}
