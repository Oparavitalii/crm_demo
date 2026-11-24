import * as repo from '../repositories/analytics.repo';
import * as employerRepo from '../repositories/employer-inquiries.repo';
import * as usersRepo from '../repositories/users.repo';
import * as freelancersRepo from '../repositories/freelancers.repo';
import { AppError, NotFoundError } from '../lib/errors';
import { allLimited } from '../lib/concurrency';
import type {
  DashboardFilters,
  DashboardResponse,
  UserProfileStats,
} from '@opushr/shared';

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}

// Ceiling on dashboard repo queries in flight at once. Must stay well under
// the pg pool `max` in db/client.ts: several of these repos fan out further
// internally, and every authenticated request additionally holds two
// connections in requireAuth. An unbounded fan-out here starved the pool in
// production on 2026-07-25 (dashboard 500 after 54.7s) — see the regression
// test in __tests__/analytics.service.test.ts.
export const DASHBOARD_QUERY_CONCURRENCY = 4;

// Zero six-metric block for user accounts with no employment episodes —
// renders as 0/— in the KPI tabs, same as an empty retention category.
const ZERO_WORKFORCE: repo.UserWorkforceMetrics = {
  employedInPeriod: 0,
  workingCount: 0,
  dismissedCount: 0,
  avgDaysFinished: null,
  avgDaysWorking: null,
  totalDaysInPeriod: 0,
  avgDaysFinishedCnt: 0,
  avgDaysWorkingCnt: 0,
  avgDaysAll: null,
  avgDaysAllCnt: 0,
  retentionRate: 0,
};

// Resolves a DashboardFilters object into absolute since/until Date bounds.
// `until` is exclusive (e.g. lastMonth returns [first-of-last-month, first-of-this-month)).
// `since` is inclusive. Both undefined = no time filter (all-time).
export function resolveRange(filters: DashboardFilters): { since?: Date; until?: Date } {
  const now = new Date();
  switch (filters.preset) {
    case 'today': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { since: start };
    }
    case '7d':
      return { since: new Date(Date.now() - 7 * 86_400_000) };
    case '30d':
      return { since: new Date(Date.now() - 30 * 86_400_000) };
    case 'thisMonth': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { since: start };
    }
    case 'lastMonth': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { since: start, until: end };
    }
    case 'quarter': {
      const q = Math.floor(now.getUTCMonth() / 3);
      const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
      return { since: start };
    }
    case 'custom':
      return {
        since: filters.from ? new Date(filters.from) : undefined,
        until: filters.to ? new Date(filters.to) : undefined,
      };
    case 'all':
    default:
      return {};
  }
}

export async function getDashboard(
  filters: DashboardFilters,
  user: Actor,
): Promise<DashboardResponse> {
  const scopeRecruiterId = user.role === 'recruiter' ? user.id : undefined;
  // 2026-06-12 — coordinators only see their assigned clients. Symmetric with
  // the recruiter scope, mutually exclusive in practice (one role at a time).
  const scopeCoordinatorId = user.role === 'coordinator' ? user.id : undefined;
  const isAdmin = user.role === 'admin';
  const { since, until } = resolveRange(filters);

  // "This week" KPI is locked to last 7 days regardless of selected range
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  // Trend chart width follows the selected range; default 30 days for all/custom
  const trendDays =
    filters.preset === '7d' || filters.preset === 'today' ? 7 : 30;

  const [
    totalCandidates,
    totalLeadsEquivalent,
    candidatesThisWeek,
    funnel,
    sources,
    kpiRows,
    coordinatorKpiRows,
    freelancerKpiRows,
    workforce,
    trend,
    retention,
    retentionSplit,
    periodStats,
    leadSrc,
    houseStats,
    admStats,
    // Thunks, not promises: `allLimited` must control when each query starts,
    // so it can keep at most DASHBOARD_QUERY_CONCURRENCY connections in use.
  ] = await allLimited(
    [
      () => repo.countCandidates({ activeOnly: true, scopeRecruiterId, scopeCoordinatorId, since, until }),
      // 2026-06-12: leads entity retired. "totalLeads" was the count of new,
      // unconverted leads — now redefined as candidates with status='new'
      // (same funnel-entry semantic). Keeps the dashboard widget from crashing.
      () => repo.countCandidates({ activeOnly: true, scopeRecruiterId, scopeCoordinatorId, since, until, status: 'new' }),
      () => repo.countCandidatesSince(weekAgo, scopeRecruiterId, scopeCoordinatorId),
      () => repo.statusFunnel({ scopeRecruiterId, scopeCoordinatorId, since, until }),
      () => repo.sourceBreakdown({ scopeRecruiterId, scopeCoordinatorId, since, until }),
      () => (isAdmin ? repo.recruiterKpi({ since, until }) : Promise.resolve([])),
      () => (isAdmin ? repo.coordinatorKpi() : Promise.resolve([])),
      () => (isAdmin ? repo.freelancerKpi() : Promise.resolve([])),
      // 2026-07-10 — unified six-metric workforce block per recruiter/coordinator
      // (client request: the KPI tabs read the same as the retention tables).
      () =>
        isAdmin
          ? repo.workforceByUser({ since, until })
          : Promise.resolve({
              byRecruiter: new Map<string, repo.UserWorkforceMetrics>(),
              byCoordinator: new Map<string, repo.UserWorkforceMetrics>(),
            }),
      () => repo.dailyTrend(trendDays, scopeRecruiterId, scopeCoordinatorId),
      () => repo.retentionBySource({ scopeRecruiterId, scopeCoordinatorId, since, until }),
      () => repo.retentionSplits({ scopeRecruiterId, scopeCoordinatorId, since, until }),
      () => repo.periodEmploymentStats({ scopeRecruiterId, scopeCoordinatorId, since, until }),
      // Same redefinition for the bySource panel — group new-status candidates
      // by their source field. Replaces the legacy leadsBySource query.
      () => repo.sourceBreakdown({ scopeRecruiterId, scopeCoordinatorId, since, until, status: 'new' }),
      () => repo.housingStats({ scopeRecruiterId, scopeCoordinatorId }),
      () => (isAdmin ? repo.adminStats() : Promise.resolve(null)),
    ],
    DASHBOARD_QUERY_CONCURRENCY,
  );

  // Employer inquiries — `newThisMonth` always = current month (independent of range)
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [employerByStatus, employerNewThisMonth] = await Promise.all([
    employerRepo.statsByStatus(),
    employerRepo.countSince(monthStart),
  ]);
  const employerTotal = employerByStatus.reduce((s, r) => s + r.count, 0);
  const acceptedCount = employerByStatus.find((r) => r.status === 'accepted')?.count ?? 0;
  const closedCount = ['accepted', 'rejected', 'archived'].reduce(
    (s, st) => s + (employerByStatus.find((r) => r.status === st)?.count ?? 0),
    0,
  );
  const acceptanceRate = closedCount === 0 ? 0 : acceptedCount / closedCount;

  // 2026-06-12: leads entity retired. totalLeads now reports candidates with
  // status='new' (funnel-entry counter) and conversionRate is fixed at 0 — no
  // separate "converted" funnel exists anymore. leadStats shape is preserved for
  // back-compat with the dashboard panel; bySource mirrors the same source mix.
  const totalLeads = totalLeadsEquivalent;
  const conversionRate = 0;

  return {
    kpi: {
      totalCandidates,
      totalLeads,
      candidatesThisWeek,
      conversionRate,
    },
    statusFunnel: funnel.map((f) => ({ status: f.status, count: f.count })),
    sourceBreakdown: sources.map((s) => ({ source: s.source, count: s.count })),
    // Real user accounts get a zero block (not null) when they have no
    // episodes — the tab renders 0/—, matching the retention tables. Null is
    // reserved for rows with no metrics source (external freelancer-table).
    recruiterKpi: kpiRows.map((r) => ({
      ...r,
      workforce: workforce.byRecruiter.get(r.userId) ?? ZERO_WORKFORCE,
    })),
    coordinatorKpi: coordinatorKpiRows.map((c) => ({
      ...c,
      workforce: workforce.byCoordinator.get(c.userId) ?? ZERO_WORKFORCE,
    })),
    freelancerKpi: freelancerKpiRows,
    weeklyTrend: trend,
    retentionBySource: retention,
    // Deprecated single table — empty, kept only so the previous frontend build
    // doesn't read `undefined` during the backend-first deploy window.
    retentionByCategory: [],
    retentionByRecruiterType: retentionSplit.byRecruiterType,
    retentionByChannel: retentionSplit.byChannel,
    periodStats,
    leadStats: {
      total: totalLeads,
      converted: 0,
      unconverted: totalLeads,
      conversionRate,
      bySource: leadSrc,
    },
    housingStats: {
      ourHousingCount: houseStats.ourHousingCount,
      ownHousingCount: houseStats.ownHousingCount,
    },
    adminStats: admStats,
    employerStats: {
      total: employerTotal,
      newThisMonth: employerNewThisMonth,
      byStatus: employerByStatus,
      acceptanceRate,
    },
  };
}

// ---------------------------------------------------------------------------
// getUserProfileStats — single-user analytics drill-down for /admin/users/:id/stats.
// Authorization: admin can view anyone; recruiter/coordinator can view themselves.
// The viewed user MUST be a recruiter or coordinator — admin/readonly have no
// pipeline to summarize. Returns role-shaped optional fields (sourceBreakdown
// for recruiter, housingUtilization for coordinator).
// ---------------------------------------------------------------------------
export async function getUserProfileStats(
  userId: string,
  actor: Actor,
): Promise<UserProfileStats> {
  // Auth: only admin OR self can view. Reject before any DB work.
  if (actor.role !== 'admin' && actor.id !== userId) {
    throw new AppError('FORBIDDEN', { reason: 'user_stats_other' }, 403);
  }

  const target = await usersRepo.findById(userId);
  if (!target) throw new NotFoundError('user');

  if (target.role !== 'recruiter' && target.role !== 'coordinator') {
    throw new AppError(
      'VALIDATION',
      { reason: 'unsupported_role', field: 'role' },
      400,
    );
  }
  const scope = target.role;

  const [
    funnelRows,
    sourceRows,
    retentionRaw,
    avgTimeToHireDays,
    recentRows,
    dismissalRows,
    housingRaw,
  ] = await Promise.all([
    repo.userStatsFunnel(userId, scope),
    scope === 'recruiter'
      ? repo.userStatsSourceBreakdown(userId, scope)
      : Promise.resolve([]),
    repo.userStatsRetention(userId, scope),
    repo.userStatsAvgTimeToHireDays(userId, scope),
    repo.userStatsRecentCandidates(userId, scope, 10),
    repo.userStatsDismissalReasons(userId, scope),
    scope === 'coordinator'
      ? repo.userStatsHousingUtilization(userId)
      : Promise.resolve(null),
  ]);

  // Zero-fill all eight statuses so the frontend can index without guards.
  const funnelMap = new Map(funnelRows.map((r) => [r.status, r.count]));
  const funnel = {
    new: funnelMap.get('new') ?? 0,
    in_progress: funnelMap.get('in_progress') ?? 0,
    documents_submitted: funnelMap.get('documents_submitted') ?? 0,
    cancelled: funnelMap.get('cancelled') ?? 0,
    employed: funnelMap.get('employed') ?? 0,
    re_employed: funnelMap.get('re_employed') ?? 0,
    dismissed: funnelMap.get('dismissed') ?? 0,
    blacklist: funnelMap.get('blacklist') ?? 0,
    total: 0,
  };
  funnel.total =
    funnel.new +
    funnel.in_progress +
    funnel.documents_submitted +
    funnel.cancelled +
    funnel.employed +
    funnel.re_employed +
    funnel.dismissed +
    funnel.blacklist;

  const retention = {
    totalEverEmployed: retentionRaw.totalEverEmployed,
    currentlyEmployed: retentionRaw.currentlyEmployed,
    rate:
      retentionRaw.totalEverEmployed === 0
        ? 0
        : retentionRaw.currentlyEmployed / retentionRaw.totalEverEmployed,
  };

  // Source breakdown — recruiter only. Same null→'unknown' bucketing as
  // recruiterKpi for UI consistency.
  let sourceBreakdown: Record<string, number> | undefined;
  if (scope === 'recruiter') {
    const sb: Record<string, number> = {};
    for (const r of sourceRows) {
      const key = r.source ?? 'unknown';
      sb[key] = (sb[key] ?? 0) + r.count;
    }
    sourceBreakdown = sb;
  }

  // Housing utilization — coordinator only.
  let housingUtilization: UserProfileStats['housingUtilization'];
  if (scope === 'coordinator' && housingRaw) {
    housingUtilization = {
      totalHoused: housingRaw.totalHoused,
      currentlyEmployed: housingRaw.currentlyEmployed,
      rate:
        housingRaw.totalHoused === 0
          ? 0
          : housingRaw.currentlyEmployed / housingRaw.totalHoused,
    };
  }

  const dismissalReasons: Record<string, number> = {};
  for (const r of dismissalRows) {
    dismissalReasons[r.reason] = (dismissalReasons[r.reason] ?? 0) + r.count;
  }

  return {
    user: {
      id: target.id,
      firstName: target.firstName,
      lastName: target.lastName,
      role: scope,
      email: target.email,
      isActive: target.isActive,
      createdAt: target.createdAt.toISOString(),
    },
    funnel,
    retention,
    ...(sourceBreakdown ? { sourceBreakdown } : {}),
    ...(housingUtilization ? { housingUtilization } : {}),
    avgTimeToHireDays,
    recentCandidates: recentRows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    dismissalReasons,
  };
}

// ---------------------------------------------------------------------------
// getFreelancerProfileStats — same drill-down as getUserProfileStats but for
// external freelancers (the `freelancers` table — separate from `users`).
// Authorization: admin only. Freelancers have no login, so there's no "self"
// concept; non-admin actors are rejected before any DB work.
//
// Returns the SAME UserProfileStats shape with role='freelancer'. Housing
// utilization is intentionally omitted (freelancers don't coordinate housing).
// sourceBreakdown IS included (mirrors the recruiter branch — freelancers do
// bring candidates in via various channels).
// ---------------------------------------------------------------------------
export async function getFreelancerProfileStats(
  freelancerId: string,
  actor: Actor,
): Promise<UserProfileStats> {
  if (actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', { reason: 'freelancer_stats_non_admin' }, 403);
  }

  const target = await freelancersRepo.findById(freelancerId);
  if (!target) throw new NotFoundError('freelancer');

  const scope = 'freelancer' as const;

  const [
    funnelRows,
    sourceRows,
    retentionRaw,
    avgTimeToHireDays,
    recentRows,
    dismissalRows,
  ] = await Promise.all([
    repo.userStatsFunnel(freelancerId, scope),
    repo.userStatsSourceBreakdown(freelancerId, scope),
    repo.userStatsRetention(freelancerId, scope),
    repo.userStatsAvgTimeToHireDays(freelancerId, scope),
    repo.userStatsRecentCandidates(freelancerId, scope, 10),
    repo.userStatsDismissalReasons(freelancerId, scope),
  ]);

  const funnelMap = new Map(funnelRows.map((r) => [r.status, r.count]));
  const funnel = {
    new: funnelMap.get('new') ?? 0,
    in_progress: funnelMap.get('in_progress') ?? 0,
    documents_submitted: funnelMap.get('documents_submitted') ?? 0,
    cancelled: funnelMap.get('cancelled') ?? 0,
    employed: funnelMap.get('employed') ?? 0,
    re_employed: funnelMap.get('re_employed') ?? 0,
    dismissed: funnelMap.get('dismissed') ?? 0,
    blacklist: funnelMap.get('blacklist') ?? 0,
    total: 0,
  };
  funnel.total =
    funnel.new +
    funnel.in_progress +
    funnel.documents_submitted +
    funnel.cancelled +
    funnel.employed +
    funnel.re_employed +
    funnel.dismissed +
    funnel.blacklist;

  const retention = {
    totalEverEmployed: retentionRaw.totalEverEmployed,
    currentlyEmployed: retentionRaw.currentlyEmployed,
    rate:
      retentionRaw.totalEverEmployed === 0
        ? 0
        : retentionRaw.currentlyEmployed / retentionRaw.totalEverEmployed,
  };

  const sourceBreakdown: Record<string, number> = {};
  for (const r of sourceRows) {
    const key = r.source ?? 'unknown';
    sourceBreakdown[key] = (sourceBreakdown[key] ?? 0) + r.count;
  }

  const dismissalReasons: Record<string, number> = {};
  for (const r of dismissalRows) {
    dismissalReasons[r.reason] = (dismissalReasons[r.reason] ?? 0) + r.count;
  }

  return {
    user: {
      id: target.id,
      firstName: target.firstName,
      lastName: target.lastName,
      role: 'freelancer',
      email: target.email,
      isActive: target.isActive,
      createdAt: target.createdAt.toISOString(),
    },
    funnel,
    retention,
    sourceBreakdown,
    avgTimeToHireDays,
    recentCandidates: recentRows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    dismissalReasons,
  };
}
