import { z } from 'zod';

// Per-user analytics detail. Powers /analytics/users/:id (recruiter/coordinator)
// and /analytics/freelancers/:id (external freelancers — separate `freelancers`
// table, no user account). Role 'freelancer' was added 2026-06-16 so the same
// shape can carry both: stats survive even when a person has no login.
export const userProfileStatsSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    role: z.enum(['recruiter', 'coordinator', 'freelancer']),
    // Nullable because freelancers.email is optional (external entities may
    // not have one captured); recruiter/coordinator users always have email.
    email: z.string().email().nullable(),
    isActive: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
  }),
  // Lifecycle funnel — counts per status, scoped to this user (recruiterId
  // for recruiter, coordinatorId for coordinator). Every status appears
  // exactly once (zero-filled).
  funnel: z.object({
    new: z.number().int().nonnegative(),
    in_progress: z.number().int().nonnegative(),
    documents_submitted: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    employed: z.number().int().nonnegative(),
    re_employed: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
    blacklist: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  // Retention — of all candidates who ever reached `employed` (kind='client'
  // or an employment_periods row exists), what fraction is currently in
  // status='employed' / 're_employed'. RODO-safe: counts only.
  retention: z.object({
    totalEverEmployed: z.number().int().nonnegative(),
    currentlyEmployed: z.number().int().nonnegative(),
    rate: z.number().min(0).max(1),
  }),
  // Recruiter only — channel-of-acquisition mix. Same shape as
  // dashboard.recruiterKpi.sourceBreakdown ("unknown" bucketed).
  sourceBreakdown: z.record(z.string(), z.number().int().nonnegative()).optional(),
  // Coordinator only — housing utilization: of all candidates the
  // coordinator has ever managed (coordinatorId set), how many are
  // currently in active employment (status employed/re_employed).
  housingUtilization: z
    .object({
      totalHoused: z.number().int().nonnegative(),
      currentlyEmployed: z.number().int().nonnegative(),
      rate: z.number().min(0).max(1),
    })
    .optional(),
  // Avg days from candidate.createdAt to first employment_periods.employedAt.
  // Null when the user has zero candidates that ever reached `employed`.
  avgTimeToHireDays: z.number().nullable(),
  // 10 most recent candidates this user owns/coordinates (createdAt DESC).
  recentCandidates: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      status: z.string(),
      createdAt: z.string().datetime({ offset: true }),
    }),
  ),
  // Dismissal reasons breakdown — count of dismissals attributed to this
  // user's candidates (recruiter: recruiterId; coordinator: coordinatorId).
  // RODO: counts only, no candidate names or PII.
  dismissalReasons: z.record(z.string(), z.number().int().nonnegative()),
});

export type UserProfileStats = z.infer<typeof userProfileStatsSchema>;
