import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- env stubs (required before any app imports) ---
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// --- repo mock ---
vi.mock('../repositories/analytics.repo', () => ({
  countCandidates: vi.fn(),
  countCandidatesSince: vi.fn(),
  statusFunnel: vi.fn(),
  sourceBreakdown: vi.fn(),
  recruiterKpi: vi.fn(),
  coordinatorKpi: vi.fn(),
  freelancerKpi: vi.fn(),
  dailyTrend: vi.fn(),
  retentionBySource: vi.fn(),
  retentionSplits: vi.fn(),
  workforceByUser: vi.fn(),
  periodEmploymentStats: vi.fn(),
  housingStats: vi.fn(),
  adminStats: vi.fn(),
  // userProfileStats helpers
  userStatsFunnel: vi.fn(),
  userStatsSourceBreakdown: vi.fn(),
  userStatsRetention: vi.fn(),
  userStatsAvgTimeToHireDays: vi.fn(),
  userStatsRecentCandidates: vi.fn(),
  userStatsDismissalReasons: vi.fn(),
  userStatsHousingUtilization: vi.fn(),
}));
vi.mock('../repositories/employer-inquiries.repo', () => ({
  statsByStatus: vi.fn(),
  countSince: vi.fn(),
}));
vi.mock('../repositories/users.repo', () => ({
  findById: vi.fn(),
}));
vi.mock('../repositories/freelancers.repo', () => ({
  findById: vi.fn(),
  listDirectory: vi.fn(),
}));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/analytics.repo';
import * as employerRepo from '../repositories/employer-inquiries.repo';
import * as usersRepo from '../repositories/users.repo';
import * as freelancersRepo from '../repositories/freelancers.repo';
import {
  DASHBOARD_QUERY_CONCURRENCY,
  getDashboard,
  getFreelancerProfileStats,
  getUserProfileStats,
  resolveRange,
} from '../services/analytics.service';
import type { DashboardFilters } from '@opushr/shared';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const coordinatorUser = { id: 'coord-1', role: 'coordinator' as const };

const range30d: DashboardFilters = { preset: '30d' };
const range7d: DashboardFilters = { preset: '7d' };
const rangeAll: DashboardFilters = { preset: 'all' };
const rangeToday: DashboardFilters = { preset: 'today' };
const rangeThisMonth: DashboardFilters = { preset: 'thisMonth' };

const emptyFunnel = [
  { status: 'new' as const, count: 0 },
  { status: 'in_progress' as const, count: 0 },
];
const emptySources = [{ source: 'facebook', count: 0 }];
const emptyTrend = [{ date: '2026-05-01', candidates: 0, leads: 0 }];
const kpiRows = [
  {
    userId: 'rec-1',
    fullName: 'Anna K.',
    isFreelancer: false,
    candidatesOwned: 7,
    conversionsThisMonth: 2,
    dismissalsThisMonth: 1,
    arrivedCount: 5,
    arrivedPercent: 5 / 7,
    employedCount: 3,
    employedPercent: 3 / 7,
    avgTenureDays: 42.5,
    totalTenureDays: 297.5,
    sourceBreakdown: { facebook: 4, instagram: 2, unknown: 1 },
    recruitedInPeriod: 6,
    employedInPeriod: 2,
    dismissedInPeriod: 1,
  },
];

function setupDefaultMocks() {
  // countCandidates is called twice — once for totalCandidates (no status filter)
  // and once for "totalLeads equivalent" (status='new' filter). Default to 42 for
  // both; specific tests override.
  vi.mocked(repo.countCandidates).mockResolvedValue(42);
  vi.mocked(repo.countCandidatesSince).mockResolvedValue(5);
  vi.mocked(repo.statusFunnel).mockResolvedValue(emptyFunnel);
  // sourceBreakdown is called twice — once for the global breakdown and once
  // for the leadStats.bySource equivalent (status='new'). Single mock covers both.
  vi.mocked(repo.sourceBreakdown).mockResolvedValue(emptySources);
  vi.mocked(repo.recruiterKpi).mockResolvedValue(kpiRows);
  vi.mocked(repo.coordinatorKpi).mockResolvedValue([]);
  vi.mocked(repo.freelancerKpi).mockResolvedValue([]);
  vi.mocked(repo.dailyTrend).mockResolvedValue(emptyTrend);
  vi.mocked(repo.retentionBySource).mockResolvedValue([]);
  vi.mocked(repo.retentionSplits).mockResolvedValue({ byRecruiterType: [], byChannel: [] });
  vi.mocked(repo.workforceByUser).mockResolvedValue({
    byRecruiter: new Map(),
    byCoordinator: new Map(),
  });
  vi.mocked(repo.periodEmploymentStats).mockResolvedValue({
    employedInPeriod: 0,
    finishedInPeriod: 0,
    workingAsOf: 0,
    avgDaysFinished: null,
    avgDaysWorking: null,
    totalDaysInPeriod: 0,
  });
  vi.mocked(repo.housingStats).mockResolvedValue({
    ourHousingCount: 0, ownHousingCount: 0,
  });
  vi.mocked(repo.adminStats).mockResolvedValue({
    byRole: [], totalActive: 0, totalInactive: 0, auditEventsThisMonth: 0,
  });
  vi.mocked(employerRepo.statsByStatus).mockResolvedValue([]);
  vi.mocked(employerRepo.countSince).mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

describe('analytics.service.getDashboard — admin sees all data', () => {
  // 2026-06-12: leads entity retired. totalLeads now reports candidates with
  // status='new' (mocked countCandidates returns 42 for both calls).
  // conversionRate is fixed at 0 — no separate converted-leads funnel exists.
  it('returns correct kpi totals for admin with preset=30d', async () => {
    const result = await getDashboard(range30d, adminUser);
    expect(result.kpi.totalCandidates).toBe(42);
    expect(result.kpi.totalLeads).toBe(42);
    expect(result.kpi.candidatesThisWeek).toBe(5);
    expect(result.kpi.conversionRate).toBe(0);
  });

  it('admin sees recruiterKpi (non-empty array)', async () => {
    const result = await getDashboard(range30d, adminUser);
    expect(result.recruiterKpi).toHaveLength(1);
    expect(result.recruiterKpi[0]?.fullName).toBe('Anna K.');
  });

  it('admin queries repo without scopeRecruiterId', async () => {
    await getDashboard(range30d, adminUser);
    expect(repo.countCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ scopeRecruiterId: undefined, scopeCoordinatorId: undefined }),
    );
    expect(repo.statusFunnel).toHaveBeenCalledWith(
      expect.objectContaining({ scopeRecruiterId: undefined, scopeCoordinatorId: undefined }),
    );
    expect(repo.dailyTrend).toHaveBeenCalledWith(expect.any(Number), undefined, undefined);
  });
});

describe('analytics.service.getDashboard — recruiter scoped', () => {
  it('passes scopeRecruiterId to all repo calls', async () => {
    await getDashboard(range30d, recruiterUser);
    expect(repo.countCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ scopeRecruiterId: 'rec-1', scopeCoordinatorId: undefined }),
    );
    expect(repo.statusFunnel).toHaveBeenCalledWith(
      expect.objectContaining({ scopeRecruiterId: 'rec-1', scopeCoordinatorId: undefined }),
    );
    expect(repo.dailyTrend).toHaveBeenCalledWith(expect.any(Number), 'rec-1', undefined);
  });

  it('recruiter does NOT see recruiterKpi (returns empty array)', async () => {
    const result = await getDashboard(range30d, recruiterUser);
    expect(result.recruiterKpi).toEqual([]);
    expect(result.freelancerKpi).toEqual([]);
    expect(repo.recruiterKpi).not.toHaveBeenCalled();
    expect(repo.freelancerKpi).not.toHaveBeenCalled();
  });
});

describe('analytics.service.getDashboard — preset and trend width', () => {
  it('uses 7 trend days for preset=7d', async () => {
    await getDashboard(range7d, adminUser);
    const call = vi.mocked(repo.dailyTrend).mock.calls[0];
    expect(call?.[0]).toBe(7);
  });

  it('uses 30 trend days for preset=30d', async () => {
    await getDashboard(range30d, adminUser);
    const call = vi.mocked(repo.dailyTrend).mock.calls[0];
    expect(call?.[0]).toBe(30);
  });

  it('uses 30 trend days for preset=all', async () => {
    await getDashboard(rangeAll, adminUser);
    const call = vi.mocked(repo.dailyTrend).mock.calls[0];
    expect(call?.[0]).toBe(30);
  });

  it('uses 7 trend days for preset=today (short range)', async () => {
    await getDashboard(rangeToday, adminUser);
    const call = vi.mocked(repo.dailyTrend).mock.calls[0];
    expect(call?.[0]).toBe(7);
  });
});

describe('analytics.service.getDashboard — date range propagation', () => {
  it('passes since/until to statusFunnel for preset=thisMonth', async () => {
    await getDashboard(rangeThisMonth, adminUser);
    expect(repo.statusFunnel).toHaveBeenCalledWith(
      expect.objectContaining({ since: expect.any(Date) }),
    );
  });

  it('passes both since and until for preset=lastMonth', async () => {
    await getDashboard({ preset: 'lastMonth' }, adminUser);
    expect(repo.countCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        since: expect.any(Date),
        until: expect.any(Date),
      }),
    );
  });

  it('passes custom from/to as since/until', async () => {
    const from = '2026-01-01T00:00:00.000Z';
    const to = '2026-03-31T23:59:59.000Z';
    await getDashboard({ preset: 'custom', from, to }, adminUser);
    const call = vi.mocked(repo.statusFunnel).mock.calls[0]?.[0];
    expect(call?.since?.toISOString()).toBe(from);
    expect(call?.until?.toISOString()).toBe(to);
  });

  it('no since/until for preset=all', async () => {
    await getDashboard(rangeAll, adminUser);
    expect(repo.statusFunnel).toHaveBeenCalledWith(
      expect.objectContaining({ since: undefined, until: undefined }),
    );
  });
});

describe('analytics.service.resolveRange', () => {
  it('returns no bounds for preset=all', () => {
    expect(resolveRange({ preset: 'all' })).toEqual({});
  });

  it('returns since-only for preset=7d', () => {
    const r = resolveRange({ preset: '7d' });
    expect(r.since).toBeInstanceOf(Date);
    expect(r.until).toBeUndefined();
  });

  it('returns since AND until for preset=lastMonth', () => {
    const r = resolveRange({ preset: 'lastMonth' });
    expect(r.since).toBeInstanceOf(Date);
    expect(r.until).toBeInstanceOf(Date);
    expect(r.since!.getTime()).toBeLessThan(r.until!.getTime());
  });

  it('returns since=start-of-day for preset=today', () => {
    const r = resolveRange({ preset: 'today' });
    expect(r.since).toBeInstanceOf(Date);
    expect(r.since!.getUTCHours()).toBe(0);
    expect(r.since!.getUTCMinutes()).toBe(0);
  });

  it('returns parsed from/to for preset=custom', () => {
    const from = '2026-01-01T00:00:00.000Z';
    const to = '2026-12-31T23:59:59.000Z';
    const r = resolveRange({ preset: 'custom', from, to });
    expect(r.since?.toISOString()).toBe(from);
    expect(r.until?.toISOString()).toBe(to);
  });
});

describe('analytics.service.getDashboard — empty data', () => {
  it('returns conversionRate=0 when there are no new-status candidates', async () => {
    vi.mocked(repo.countCandidates).mockResolvedValue(0);
    const result = await getDashboard(range30d, adminUser);
    expect(result.kpi.conversionRate).toBe(0);
    expect(result.kpi.totalLeads).toBe(0);
  });

  it('returns empty statusFunnel and sourceBreakdown when no candidates', async () => {
    vi.mocked(repo.countCandidates).mockResolvedValue(0);
    vi.mocked(repo.statusFunnel).mockResolvedValue([]);
    vi.mocked(repo.sourceBreakdown).mockResolvedValue([]);
    const result = await getDashboard(range30d, adminUser);
    expect(result.statusFunnel).toEqual([]);
    expect(result.sourceBreakdown).toEqual([]);
  });
});

describe('analytics.service.getDashboard — coordinator/readonly', () => {
  it('coordinator sees all data (no scope restriction, no recruiterKpi)', async () => {
    const result = await getDashboard(range30d, coordinatorUser);
    expect(repo.countCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ scopeRecruiterId: undefined }),
    );
    expect(result.recruiterKpi).toEqual([]);
  });
});

describe('analytics.service.getDashboard — F13 recruiterKpi extensions', () => {
  it('passes F13 fields through to dashboard response (admin)', async () => {
    const result = await getDashboard(range30d, adminUser);
    const row = result.recruiterKpi[0]!;
    expect(row.arrivedCount).toBe(5);
    expect(row.arrivedPercent).toBeCloseTo(5 / 7, 5);
    expect(row.employedCount).toBe(3);
    expect(row.employedPercent).toBeCloseTo(3 / 7, 5);
    expect(row.avgTenureDays).toBe(42.5);
    expect(row.sourceBreakdown).toEqual({ facebook: 4, instagram: 2, unknown: 1 });
  });

  it('tolerates null avgTenureDays (no employed clients case)', async () => {
    vi.mocked(repo.recruiterKpi).mockResolvedValue([
      {
        userId: 'rec-2',
        fullName: 'Bob X.',
        isFreelancer: false,
        candidatesOwned: 3,
        conversionsThisMonth: 0,
        dismissalsThisMonth: 0,
        arrivedCount: 0,
        arrivedPercent: 0,
        employedCount: 0,
        employedPercent: 0,
        avgTenureDays: null,
        totalTenureDays: null,
        sourceBreakdown: {},
        recruitedInPeriod: 0,
        employedInPeriod: 0,
        dismissedInPeriod: 0,
      },
    ]);
    const result = await getDashboard(range30d, adminUser);
    expect(result.recruiterKpi[0]?.avgTenureDays).toBeNull();
    expect(result.recruiterKpi[0]?.sourceBreakdown).toEqual({});
  });

  it('zero candidatesOwned yields 0 percent (no NaN)', async () => {
    vi.mocked(repo.recruiterKpi).mockResolvedValue([
      {
        userId: 'rec-3',
        fullName: 'Carla Y.',
        isFreelancer: false,
        candidatesOwned: 0,
        conversionsThisMonth: 0,
        dismissalsThisMonth: 0,
        arrivedCount: 0,
        arrivedPercent: 0,
        employedCount: 0,
        employedPercent: 0,
        avgTenureDays: null,
        totalTenureDays: null,
        sourceBreakdown: {},
        recruitedInPeriod: 0,
        employedInPeriod: 0,
        dismissedInPeriod: 0,
      },
    ]);
    const result = await getDashboard(range30d, adminUser);
    const row = result.recruiterKpi[0]!;
    expect(Number.isNaN(row.arrivedPercent)).toBe(false);
    expect(Number.isNaN(row.employedPercent)).toBe(false);
    expect(row.arrivedPercent).toBe(0);
    expect(row.employedPercent).toBe(0);
  });
});

describe('analytics.service.getDashboard — coordinatorKpi', () => {
  const coordKpiRows = [
    {
      userId: 'coord-1',
      fullName: 'Bartek N.',
      isFreelancer: false,
      candidatesCoordinated: 8,
      currentlyHoused: 5,
      housingUtilizationPercent: 5 / 8,
      avgTenureDays: 30.2,
      totalTenureDays: 241.6,
      dismissalsThisMonth: 1,
    },
  ];

  it('admin sees coordinatorKpi populated', async () => {
    vi.mocked(repo.coordinatorKpi).mockResolvedValue(coordKpiRows);
    const result = await getDashboard(range30d, adminUser);
    expect(result.coordinatorKpi).toHaveLength(1);
    expect(result.coordinatorKpi[0]?.fullName).toBe('Bartek N.');
    expect(result.coordinatorKpi[0]?.housingUtilizationPercent).toBeCloseTo(5 / 8, 5);
  });

  it('recruiter does NOT see coordinatorKpi (empty array, repo not called)', async () => {
    vi.mocked(repo.coordinatorKpi).mockResolvedValue(coordKpiRows);
    const result = await getDashboard(range30d, recruiterUser);
    expect(result.coordinatorKpi).toEqual([]);
    expect(repo.coordinatorKpi).not.toHaveBeenCalled();
  });

  it('coordinator does NOT see coordinatorKpi (admin-gated)', async () => {
    vi.mocked(repo.coordinatorKpi).mockResolvedValue(coordKpiRows);
    const result = await getDashboard(range30d, coordinatorUser);
    expect(result.coordinatorKpi).toEqual([]);
    expect(repo.coordinatorKpi).not.toHaveBeenCalled();
  });

  it('zero candidatesCoordinated yields 0 utilization (no NaN)', async () => {
    vi.mocked(repo.coordinatorKpi).mockResolvedValue([
      {
        userId: 'coord-2',
        fullName: 'Carla N.',
        isFreelancer: false,
        candidatesCoordinated: 0,
        currentlyHoused: 0,
        housingUtilizationPercent: 0,
        avgTenureDays: null,
        totalTenureDays: null,
        dismissalsThisMonth: 0,
      },
    ]);
    const result = await getDashboard(range30d, adminUser);
    const row = result.coordinatorKpi[0]!;
    expect(Number.isNaN(row.housingUtilizationPercent)).toBe(false);
    expect(row.housingUtilizationPercent).toBe(0);
    expect(row.avgTenureDays).toBeNull();
  });
});

describe('analytics.service.getDashboard — response shape', () => {
  it('response includes all required top-level keys', async () => {
    const result = await getDashboard(range30d, adminUser);
    expect(result).toHaveProperty('kpi');
    expect(result).toHaveProperty('statusFunnel');
    expect(result).toHaveProperty('sourceBreakdown');
    expect(result).toHaveProperty('recruiterKpi');
    expect(result).toHaveProperty('coordinatorKpi');
    expect(result).toHaveProperty('freelancerKpi');
    expect(result).toHaveProperty('weeklyTrend');
  });

  it('all parallel repo queries are called exactly once', async () => {
    await getDashboard(range30d, adminUser);
    // 2026-06-12 leads retired — countCandidates is called twice now
    // (totalCandidates + status='new' for the legacy "totalLeads" KPI alias).
    expect(repo.countCandidates).toHaveBeenCalledTimes(2);
    expect(repo.countCandidatesSince).toHaveBeenCalledOnce();
    expect(repo.statusFunnel).toHaveBeenCalledOnce();
    // sourceBreakdown also called twice — once globally, once filtered to status='new'.
    expect(repo.sourceBreakdown).toHaveBeenCalledTimes(2);
    expect(repo.recruiterKpi).toHaveBeenCalledOnce();
    expect(repo.coordinatorKpi).toHaveBeenCalledOnce();
    expect(repo.freelancerKpi).toHaveBeenCalledOnce();
    expect(repo.dailyTrend).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// getUserProfileStats — per-user analytics drill-down
// ---------------------------------------------------------------------------
describe('analytics.service.getUserProfileStats', () => {
  const targetRecruiter = {
    id: 'rec-target',
    email: 'anna@opushr.test',
    firstName: 'Anna',
    lastName: 'Kowalska',
    role: 'recruiter' as const,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const targetCoordinator = {
    ...targetRecruiter,
    id: 'coord-target',
    role: 'coordinator' as const,
    firstName: 'Bartek',
    lastName: 'Nowak',
  };
  const targetAdmin = { ...targetRecruiter, role: 'admin' as const };

  function setupUserStatsMocks() {
    vi.mocked(repo.userStatsFunnel).mockResolvedValue([
      { status: 'new', count: 3 },
      { status: 'employed', count: 2 },
      { status: 'dismissed', count: 1 },
    ]);
    vi.mocked(repo.userStatsSourceBreakdown).mockResolvedValue([
      { source: 'facebook', count: 4 },
      { source: null, count: 2 },
    ]);
    vi.mocked(repo.userStatsRetention).mockResolvedValue({
      totalEverEmployed: 4,
      currentlyEmployed: 2,
    });
    vi.mocked(repo.userStatsAvgTimeToHireDays).mockResolvedValue(12.5);
    vi.mocked(repo.userStatsRecentCandidates).mockResolvedValue([
      {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Jan Kowalski',
        status: 'employed',
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
    ]);
    vi.mocked(repo.userStatsDismissalReasons).mockResolvedValue([
      { reason: 'employee_resigned', count: 1 },
    ]);
    vi.mocked(repo.userStatsHousingUtilization).mockResolvedValue({
      totalHoused: 5,
      currentlyEmployed: 3,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupUserStatsMocks();
  });

  it('admin can fetch stats for any recruiter', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetRecruiter as never);
    const result = await getUserProfileStats(targetRecruiter.id, adminUser);
    expect(result.user.role).toBe('recruiter');
    expect(result.funnel.new).toBe(3);
    expect(result.funnel.employed).toBe(2);
    expect(result.funnel.total).toBe(6);
    expect(result.retention.rate).toBeCloseTo(0.5, 5);
    expect(result.sourceBreakdown).toEqual({ facebook: 4, unknown: 2 });
    expect(result.housingUtilization).toBeUndefined();
    expect(result.avgTimeToHireDays).toBe(12.5);
    expect(result.recentCandidates).toHaveLength(1);
    expect(result.dismissalReasons).toEqual({ employee_resigned: 1 });
  });

  it('recruiter can fetch their OWN stats', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({
      ...targetRecruiter,
      id: recruiterUser.id,
    } as never);
    const result = await getUserProfileStats(recruiterUser.id, recruiterUser);
    expect(result.user.id).toBe(recruiterUser.id);
  });

  it('recruiter A cannot fetch recruiter B stats → FORBIDDEN', async () => {
    await expect(
      getUserProfileStats('rec-other', recruiterUser),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Auth rejection happens before any DB lookup.
    expect(usersRepo.findById).not.toHaveBeenCalled();
  });

  it('coordinator cannot fetch a recruiter stats → FORBIDDEN', async () => {
    await expect(
      getUserProfileStats('rec-target', coordinatorUser),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('coordinator gets housingUtilization, not sourceBreakdown', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetCoordinator as never);
    const result = await getUserProfileStats(targetCoordinator.id, adminUser);
    expect(result.user.role).toBe('coordinator');
    expect(result.housingUtilization).toEqual({
      totalHoused: 5,
      currentlyEmployed: 3,
      rate: 0.6,
    });
    expect(result.sourceBreakdown).toBeUndefined();
    // Source breakdown repo skipped for coordinator.
    expect(repo.userStatsSourceBreakdown).not.toHaveBeenCalled();
  });

  it('recruiter scope skips housingUtilization repo call', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetRecruiter as never);
    await getUserProfileStats(targetRecruiter.id, adminUser);
    expect(repo.userStatsHousingUtilization).not.toHaveBeenCalled();
  });

  it('unknown user → NOT_FOUND', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(undefined);
    await expect(
      getUserProfileStats('missing-id', adminUser),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('admin role user → VALIDATION error', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetAdmin as never);
    await expect(
      getUserProfileStats(targetAdmin.id, adminUser),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('zero candidates → retention rate 0 (no NaN)', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetRecruiter as never);
    vi.mocked(repo.userStatsRetention).mockResolvedValue({
      totalEverEmployed: 0,
      currentlyEmployed: 0,
    });
    const result = await getUserProfileStats(targetRecruiter.id, adminUser);
    expect(result.retention.rate).toBe(0);
    expect(Number.isNaN(result.retention.rate)).toBe(false);
  });

  it('zero housed coordinator → housingUtilization rate 0 (no NaN)', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetCoordinator as never);
    vi.mocked(repo.userStatsHousingUtilization).mockResolvedValue({
      totalHoused: 0,
      currentlyEmployed: 0,
    });
    const result = await getUserProfileStats(targetCoordinator.id, adminUser);
    expect(result.housingUtilization?.rate).toBe(0);
  });

  it('null avgTimeToHireDays is preserved', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetRecruiter as never);
    vi.mocked(repo.userStatsAvgTimeToHireDays).mockResolvedValue(null);
    const result = await getUserProfileStats(targetRecruiter.id, adminUser);
    expect(result.avgTimeToHireDays).toBeNull();
  });

  it('funnel zero-fills missing statuses', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(targetRecruiter as never);
    vi.mocked(repo.userStatsFunnel).mockResolvedValue([]);
    const result = await getUserProfileStats(targetRecruiter.id, adminUser);
    expect(result.funnel.new).toBe(0);
    expect(result.funnel.in_progress).toBe(0);
    expect(result.funnel.documents_submitted).toBe(0);
    expect(result.funnel.cancelled).toBe(0);
    expect(result.funnel.employed).toBe(0);
    expect(result.funnel.re_employed).toBe(0);
    expect(result.funnel.dismissed).toBe(0);
    expect(result.funnel.blacklist).toBe(0);
    expect(result.funnel.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getFreelancerProfileStats — external-freelancer analytics drill-down
// ---------------------------------------------------------------------------
describe('analytics.service.getFreelancerProfileStats', () => {
  const targetFreelancer = {
    id: '22222222-2222-2222-2222-222222222222',
    firstName: 'Olena',
    lastName: 'Stanova',
    email: null,
    phone: null,
    commissionRate: null,
    isActive: true,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.userStatsFunnel).mockResolvedValue([
      { status: 'new', count: 2 },
      { status: 'employed', count: 1 },
    ]);
    vi.mocked(repo.userStatsSourceBreakdown).mockResolvedValue([
      { source: 'telegram', count: 3 },
    ]);
    vi.mocked(repo.userStatsRetention).mockResolvedValue({
      totalEverEmployed: 2,
      currentlyEmployed: 1,
    });
    vi.mocked(repo.userStatsAvgTimeToHireDays).mockResolvedValue(8.4);
    vi.mocked(repo.userStatsRecentCandidates).mockResolvedValue([]);
    vi.mocked(repo.userStatsDismissalReasons).mockResolvedValue([]);
  });

  it('admin can fetch stats — returns role=freelancer, no housing', async () => {
    vi.mocked(freelancersRepo.findById).mockResolvedValue(targetFreelancer as never);
    const result = await getFreelancerProfileStats(targetFreelancer.id, adminUser);
    expect(result.user.role).toBe('freelancer');
    expect(result.user.email).toBeNull();
    expect(result.funnel.new).toBe(2);
    expect(result.funnel.employed).toBe(1);
    expect(result.funnel.total).toBe(3);
    expect(result.retention.rate).toBeCloseTo(0.5, 5);
    expect(result.sourceBreakdown).toEqual({ telegram: 3 });
    // Freelancers don't coordinate housing — field omitted from response.
    expect(result.housingUtilization).toBeUndefined();
    expect(result.avgTimeToHireDays).toBe(8.4);
  });

  it('non-admin (recruiter) is forbidden — no DB lookup', async () => {
    await expect(
      getFreelancerProfileStats(targetFreelancer.id, recruiterUser),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(freelancersRepo.findById).not.toHaveBeenCalled();
  });

  it('non-admin (coordinator) is forbidden', async () => {
    await expect(
      getFreelancerProfileStats(targetFreelancer.id, coordinatorUser),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('missing freelancer → NotFoundError', async () => {
    vi.mocked(freelancersRepo.findById).mockResolvedValue(undefined);
    await expect(
      getFreelancerProfileStats('00000000-0000-0000-0000-000000000000', adminUser),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('queries candidates by freelancerId scope', async () => {
    vi.mocked(freelancersRepo.findById).mockResolvedValue(targetFreelancer as never);
    await getFreelancerProfileStats(targetFreelancer.id, adminUser);
    expect(repo.userStatsFunnel).toHaveBeenCalledWith(targetFreelancer.id, 'freelancer');
    expect(repo.userStatsSourceBreakdown).toHaveBeenCalledWith(targetFreelancer.id, 'freelancer');
  });
});

// --- connection-pool safety (prod regression, 2026-07-25) ---
// getDashboard used to fire all 16 repo calls in a single Promise.all, and
// several of those repos fan out further internally. The pg pool in
// db/client.ts holds `max: 10` connections, so ONE dashboard request could
// demand more connections than the entire pool — starving every other
// in-flight request until connectionTimeoutMillis (25s) expired. Those
// timeouts escaped as unhandled errors and surfaced to the browser as 500s.
//
// Observed in production on 2026-07-25:
//   /analytics/dashboard  -> 500 after 54.73s
//   /tasks?...pageSize=1  -> 500 after 42.08s
//   /pending-acceptances  -> 200 but after 13.24s
// while the identical retries all returned 200 in ~590ms once the pool drained.
describe('analytics.service.getDashboard — connection-pool safety', () => {
  it('runs a bounded number of repo queries concurrently', async () => {
    let inFlight = 0;
    let peak = 0;

    // Wrap every mocked repo fn: count entry/exit around a real event-loop
    // tick so genuinely-parallel calls overlap and push `peak` up. The value
    // configured by setupDefaultMocks is preserved and still returned.
    const mocks = [
      ...Object.values(repo),
      ...Object.values(employerRepo),
    ].filter((f) => typeof f === 'function' && 'mockImplementation' in f) as unknown as Array<
      ReturnType<typeof vi.fn>
    >;

    for (const fn of mocks) {
      const inner = fn.getMockImplementation();
      fn.mockImplementation(async (...args: unknown[]) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return inner?.(...args);
      });
    }

    await getDashboard(range30d, adminUser);

    expect(peak).toBeLessThanOrEqual(DASHBOARD_QUERY_CONCURRENCY);
    // Guard the guard: a limit at or above the old fan-out would pass
    // vacuously while still being able to exhaust the pool.
    expect(DASHBOARD_QUERY_CONCURRENCY).toBeLessThan(10);
  });
});
