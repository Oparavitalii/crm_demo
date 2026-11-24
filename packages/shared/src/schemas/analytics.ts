import { z } from 'zod';

export const dashboardRangeSchema = z.enum([
  'today',
  '7d',
  '30d',
  'thisMonth',
  'lastMonth',
  'quarter',
  'all',
  'custom',
]);
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

// Dashboard filters: preset + optional custom range.
// When preset='custom', from/to are required (ISO 8601 datetime strings).
export const dashboardFiltersSchema = z
  .object({
    preset: dashboardRangeSchema.default('30d'),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .refine((v) => v.preset !== 'custom' || (v.from && v.to), {
    message: 'from/to required when preset=custom',
    path: ['from'],
  })
  .refine(
    (v) => {
      if (v.preset !== 'custom') return true;
      if (!v.from || !v.to) return false;
      return new Date(v.from) <= new Date(v.to);
    },
    { message: 'from must be <= to', path: ['from'] },
  );
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export const kpiSchema = z.object({
  totalCandidates: z.number().int().nonnegative(),
  // 2026-06-12: leads entity retired. `totalLeads` now reports candidates with
  // status='new' (the equivalent funnel-entry counter) so the dashboard widget
  // doesn't crash. Kept the field name for response back-compat.
  totalLeads: z.number().int().nonnegative(),
  candidatesThisWeek: z.number().int().nonnegative(),
  // Retained for the same back-compat reason — always 0 now since leads are gone.
  conversionRate: z.number().min(0).max(1),
});
export type Kpi = z.infer<typeof kpiSchema>;

export const statusFunnelItemSchema = z.object({
  status: z.enum([
    'new',
    'in_progress',
    'documents_submitted',
    'cancelled',
    'employed',
    're_employed',
    'dismissed',
    'blacklist',
  ]),
  count: z.number().int().nonnegative(),
});
export type StatusFunnelItem = z.infer<typeof statusFunnelItemSchema>;

export const sourceBreakdownItemSchema = z.object({
  source: z.string().nullable(),
  count: z.number().int().nonnegative(),
});
export type SourceBreakdownItem = z.infer<typeof sourceBreakdownItemSchema>;

// 2026-07-10 (client request) — the unified six-metric workforce block shown
// in the retention tables, repeated per recruiter/coordinator row so the
// «Рекрутери»/«Координатори» tabs read the same as «Утримання». Same SQL
// window definitions as periodStats/retentionSplits, so the numbers match
// the retention children exactly. Null on rows that have no metrics source
// (external freelancer-table rows without a user account).
export const workforceMetricsSchema = z.object({
  employedInPeriod: z.number().int().nonnegative(),
  workingCount: z.number().int().nonnegative(),
  dismissedCount: z.number().int().nonnegative(),
  avgDaysFinished: z.number().nullable(),
  avgDaysWorking: z.number().nullable(),
  totalDaysInPeriod: z.number().nonnegative(),
  retentionRate: z.number().min(0).max(1),
  // Sample sizes behind the averages (see retentionPeriodMetricsShape).
  avgDaysFinishedCnt: z.number().int().nonnegative().optional().default(0),
  avgDaysWorkingCnt: z.number().int().nonnegative().optional().default(0),
  avgDaysAll: z.number().nullable().optional().default(null),
  avgDaysAllCnt: z.number().int().nonnegative().optional().default(0),
});
export type WorkforceMetrics = z.infer<typeof workforceMetricsSchema>;

export const recruiterKpiItemSchema = z.object({
  userId: z.string(),
  fullName: z.string(),
  // Sourced from users.isFreelancer — editable by admins in /admin/users.
  // Drives the "Тип" badge in the recruiter KPI table.
  isFreelancer: z.boolean(),
  candidatesOwned: z.number().int().nonnegative(),
  conversionsThisMonth: z.number().int().nonnegative(),
  dismissalsThisMonth: z.number().int().nonnegative(),
  // F13 additions — Yana's KPI requests:
  // channel of acquisition + arrival/employment rates + tenure.
  arrivedCount: z.number().int().nonnegative(),
  arrivedPercent: z.number().min(0).max(1),
  employedCount: z.number().int().nonnegative(),
  employedPercent: z.number().min(0).max(1),
  avgTenureDays: z.number().nullable(),
  // Sum of tenure days across this recruiter's clients (active uses now() - workStartDate,
  // dismissed uses workEndDate - workStartDate). Null when no clients have tenure data.
  totalTenureDays: z.number().nullable(),
  sourceBreakdown: z.record(z.number().int().nonnegative()),
  // Period-aware counters (client request 2026-07-08) — driven by the selected
  // dashboard range instead of the hardcoded "this month". Optional + default 0
  // for deploy-window back-compat (frontend may ship before the backend).
  recruitedInPeriod: z.number().int().nonnegative().optional().default(0),
  employedInPeriod: z.number().int().nonnegative().optional().default(0),
  dismissedInPeriod: z.number().int().nonnegative().optional().default(0),
  // 2026-07-10 — unified workforce block (see workforceMetricsSchema).
  // Optional + null default for the deploy window.
  workforce: workforceMetricsSchema.nullable().optional().default(null),
});
export type RecruiterKpiItem = z.infer<typeof recruiterKpiItemSchema>;

// Coordinator KPI — mirrors recruiterKpi shape (so the frontend table layout
// is symmetrical) but the metrics are housing-oriented. Coordinators don't
// bring candidates in — they manage active employment & housing.
export const coordinatorKpiItemSchema = z.object({
  userId: z.string(),
  fullName: z.string(),
  // Always false for coordinators — kept for shape parity with recruiterKpi.
  isFreelancer: z.boolean(),
  candidatesCoordinated: z.number().int().nonnegative(),
  currentlyHoused: z.number().int().nonnegative(),
  // currentlyHoused / candidatesCoordinated, clamped to [0..1]. 0 when no
  // candidates have ever been coordinated (div-zero guard).
  housingUtilizationPercent: z.number().min(0).max(1),
  avgTenureDays: z.number().nullable(),
  // Sum of tenure days across this coordinator's employment_periods
  // (now() - employedAt for active, dismissedAt - employedAt for closed).
  totalTenureDays: z.number().nullable(),
  dismissalsThisMonth: z.number().int().nonnegative(),
  // 2026-07-10 — unified workforce block, grouped by the EPISODE coordinator
  // (employment_periods.coordinator_id), not the card's current coordinator.
  workforce: workforceMetricsSchema.nullable().optional().default(null),
});
export type CoordinatorKpiItem = z.infer<typeof coordinatorKpiItemSchema>;

export const freelancerKpiItemSchema = z.object({
  freelancerId: z.string(),
  fullName: z.string(),
  // commissionRate as raw percent (e.g. 8.5 means 8.5%). Null = not configured.
  commissionRate: z.number().nullable(),
  candidatesOwned: z.number().int().nonnegative(),
  workingNow: z.number().int().nonnegative(),
  dismissalsThisMonth: z.number().int().nonnegative(),
  // F13-mirror additions: channel of acquisition + arrival/employment rates + tenure.
  arrivedCount: z.number().int().nonnegative(),
  arrivedPercent: z.number().min(0).max(1),
  employedCount: z.number().int().nonnegative(),
  employedPercent: z.number().min(0).max(1),
  avgTenureDays: z.number().nullable(),
  totalTenureDays: z.number().nullable(),
  sourceBreakdown: z.record(z.number().int().nonnegative()),
});
export type FreelancerKpiItem = z.infer<typeof freelancerKpiItemSchema>;

export const weeklyTrendItemSchema = z.object({
  date: z.string(),
  candidates: z.number().int().nonnegative(),
  // 2026-06-12: leads retired — always 0. Field kept for response back-compat.
  leads: z.number().int().nonnegative(),
});
export type WeeklyTrendItem = z.infer<typeof weeklyTrendItemSchema>;

export const retentionBySourceItemSchema = z.object({
  source: z.string().nullable(),
  workingCount: z.number().int().nonnegative(),
  dismissedCount: z.number().int().nonnegative(),
  retentionRate: z.number().min(0).max(1),
});
export type RetentionBySourceItem = z.infer<typeof retentionBySourceItemSchema>;

// Period-aware workforce stats (client request 2026-07-08). Sourced from
// employment_periods so re-hires count as distinct episodes and the selected
// dashboard range actually drives the numbers.
//   - employedInPeriod  — episodes that STARTED inside [since, until)
//   - finishedInPeriod  — episodes that ENDED inside [since, until)
//   - workingAsOf       — episodes open as of the END of the range (until, or now)
//   - avgDaysFinished   — avg worked days of episodes finished in the range
//   - avgDaysWorking    — avg worked days of still-open episodes, as of today
//   - totalDaysInPeriod — sum of worked days clipped to the [since, until) window
export const periodStatsSchema = z.object({
  employedInPeriod: z.number().int().nonnegative(),
  finishedInPeriod: z.number().int().nonnegative(),
  workingAsOf: z.number().int().nonnegative(),
  avgDaysFinished: z.number().nullable(),
  avgDaysWorking: z.number().nullable(),
  totalDaysInPeriod: z.number().nonnegative(),
});
export type PeriodStats = z.infer<typeof periodStatsSchema>;

// Retention grouped into business categories (client request 2026-07-08):
// Штат / Фриланс / Соцмережі / Job-сайти та інше / Невідомо. Each category is
// expandable in the UI into its individual "positions" (children) — for Штат/
// Фриланс that's each recruiter/freelancer, for source-based groups it's each
// raw source code (localized on the frontend via status_lookups).
// 2026-07-10 (client request) — every category row carries the same six
// period metrics as the PeriodStats tiles, computed within the category:
// employedInPeriod / dismissedCount (= finished) / workingCount (= as of end)
// / avgDaysFinished / avgDaysWorking / totalDaysInPeriod. Window semantics
// match periodEmploymentStats exactly so category sums reconcile with tiles.
const retentionPeriodMetricsShape = {
  employedInPeriod: z.number().int().nonnegative(),
  avgDaysFinished: z.number().nullable(),
  avgDaysWorking: z.number().nullable(),
  totalDaysInPeriod: z.number().nonnegative(),
  // 2026-07-10 — sample sizes behind the averages, shown as a small colored
  // count next to the value (client request). Optional + default for the
  // deploy window.
  avgDaysFinishedCnt: z.number().int().nonnegative().optional().default(0),
  avgDaysWorkingCnt: z.number().int().nonnegative().optional().default(0),
  // Overall average tenure across BOTH populations (working + finished) —
  // weighted by episodes, not an average of the two averages.
  avgDaysAll: z.number().nullable().optional().default(null),
  avgDaysAllCnt: z.number().int().nonnegative().optional().default(0),
};

export const retentionCategoryChildSchema = z.object({
  // Person full-name (staff/freelance children) or fallback label.
  label: z.string(),
  // Source code for source-based children — frontend localizes via lookup.
  // null for person-based children (label is authoritative).
  code: z.string().nullable(),
  workingCount: z.number().int().nonnegative(),
  dismissedCount: z.number().int().nonnegative(),
  retentionRate: z.number().min(0).max(1),
  ...retentionPeriodMetricsShape,
});
export type RetentionCategoryChild = z.infer<typeof retentionCategoryChildSchema>;

export const retentionCategoryItemSchema = z.object({
  // 2026-07-10 — split into two orthogonal tables. Keys are:
  //   recruiter-type table: 'staff' | 'freelance' | 'no_recruiter'
  //   channel table:        'social' | 'jobBoards' | 'website' | 'formRecruiter' | 'unknown'
  key: z.string(),
  workingCount: z.number().int().nonnegative(),
  dismissedCount: z.number().int().nonnegative(),
  retentionRate: z.number().min(0).max(1),
  ...retentionPeriodMetricsShape,
  children: z.array(retentionCategoryChildSchema),
});
export type RetentionCategoryItem = z.infer<typeof retentionCategoryItemSchema>;

export const leadStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  converted: z.number().int().nonnegative(),
  unconverted: z.number().int().nonnegative(),
  conversionRate: z.number().min(0).max(1),
  bySource: z.array(sourceBreakdownItemSchema),
});
export type LeadStats = z.infer<typeof leadStatsSchema>;

// Housing counts — derived from candidates.status + candidates.housing_type.
// "Currently housed" = status in {our_housing, own_housing, employed, re_employed}
// AND housing_type is set. dismissed/blacklist are excluded (treated as vacated).
export const housingStatsSchema = z.object({
  ourHousingCount: z.number().int().nonnegative(),
  ownHousingCount: z.number().int().nonnegative(),
});
export type HousingStats = z.infer<typeof housingStatsSchema>;

export const userByRoleItemSchema = z.object({
  role: z.enum(['admin', 'recruiter', 'coordinator', 'readonly']),
  active: z.number().int().nonnegative(),
  inactive: z.number().int().nonnegative(),
});
export type UserByRoleItem = z.infer<typeof userByRoleItemSchema>;

export const adminStatsSchema = z.object({
  byRole: z.array(userByRoleItemSchema),
  totalActive: z.number().int().nonnegative(),
  totalInactive: z.number().int().nonnegative(),
  auditEventsThisMonth: z.number().int().nonnegative(),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

export const employerStatsByStatusItemSchema = z.object({
  status: z.string(),
  count: z.number().int().nonnegative(),
});
export type EmployerStatsByStatusItem = z.infer<typeof employerStatsByStatusItemSchema>;

export const employerStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  newThisMonth: z.number().int().nonnegative(),
  byStatus: z.array(employerStatsByStatusItemSchema),
  acceptanceRate: z.number().min(0).max(1),
});
export type EmployerStats = z.infer<typeof employerStatsSchema>;

export const dashboardResponseSchema = z.object({
  kpi: kpiSchema,
  statusFunnel: z.array(statusFunnelItemSchema),
  sourceBreakdown: z.array(sourceBreakdownItemSchema),
  recruiterKpi: z.array(recruiterKpiItemSchema),
  // Optional + default to keep the schema backward-compat during the deploy
  // window where the frontend ships first (or the backend hasn't been redeployed
  // yet). When the new backend lands, the field is always populated and the
  // default is never used. Safe to tighten to a required array after the next
  // full deploy when both sides are guaranteed to be on the new version.
  coordinatorKpi: z.array(coordinatorKpiItemSchema).optional().default([]),
  freelancerKpi: z.array(freelancerKpiItemSchema),
  weeklyTrend: z.array(weeklyTrendItemSchema),
  retentionBySource: z.array(retentionBySourceItemSchema),
  // New 2026-07-08 panels. Optional + default for the same deploy-window
  // back-compat reason as coordinatorKpi above.
  periodStats: periodStatsSchema
    .optional()
    .default({
      employedInPeriod: 0,
      finishedInPeriod: 0,
      workingAsOf: 0,
      avgDaysFinished: null,
      avgDaysWorking: null,
      totalDaysInPeriod: 0,
    }),
  // Deprecated single-table grouping — kept (empty) for deploy-window back-compat
  // with the previous frontend, replaced by the two orthogonal tables below.
  retentionByCategory: z.array(retentionCategoryItemSchema).optional().default([]),
  // 2026-07-10 — retention split into two orthogonal views (client request):
  //   byRecruiterType — Штат / Фриланс / Без рекрутера (owner-based)
  //   byChannel       — Соцмережі / Job-сайти / Наш сайт / Форма / Невідомо (source-based)
  // Both count working/dismissed from employment_periods (consistent with periodStats).
  retentionByRecruiterType: z.array(retentionCategoryItemSchema).optional().default([]),
  retentionByChannel: z.array(retentionCategoryItemSchema).optional().default([]),
  leadStats: leadStatsSchema,
  housingStats: housingStatsSchema,
  adminStats: adminStatsSchema.nullable(),
  employerStats: employerStatsSchema,
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
