import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, type Executor } from '../db/client';
import {
  employmentPeriods,
  type EmploymentPeriod,
  type NewEmploymentPeriod,
} from '../db/tables/employment-periods';
import { users } from '../db/tables/users';
import { projects } from '../db/tables/projects';

export type EnrichedEmploymentPeriod = EmploymentPeriod & {
  projectName: string | null;
  coordinatorFirstName: string | null;
  coordinatorLastName: string | null;
};

// Newest-first history for a candidate. Used by EmploymentHistoryTab.
export async function listByCandidate(
  candidateId: string,
): Promise<EnrichedEmploymentPeriod[]> {
  const rows = await db
    .select({
      id: employmentPeriods.id,
      candidateId: employmentPeriods.candidateId,
      employedAt: employmentPeriods.employedAt,
      dismissedAt: employmentPeriods.dismissedAt,
      dismissedReason: employmentPeriods.dismissedReason,
      housingType: employmentPeriods.housingType,
      projectId: employmentPeriods.projectId,
      coordinatorId: employmentPeriods.coordinatorId,
      createdAt: employmentPeriods.createdAt,
      createdBy: employmentPeriods.createdBy,
      projectName: projects.name,
      coordinatorFirstName: users.firstName,
      coordinatorLastName: users.lastName,
    })
    .from(employmentPeriods)
    .leftJoin(projects, eq(employmentPeriods.projectId, projects.id))
    .leftJoin(users, eq(employmentPeriods.coordinatorId, users.id))
    .where(eq(employmentPeriods.candidateId, candidateId))
    .orderBy(desc(employmentPeriods.employedAt));
  return rows as EnrichedEmploymentPeriod[];
}

// Returns the currently-open period for a candidate (dismissedAt IS NULL), or
// null if they have none. The `employment_periods_open_per_candidate_idx` unique
// partial index guarantees at most one such row.
export async function findOpen(
  candidateId: string,
  exec: Executor = db,
): Promise<EmploymentPeriod | null> {
  const rows = await exec
    .select()
    .from(employmentPeriods)
    .where(
      and(
        eq(employmentPeriods.candidateId, candidateId),
        isNull(employmentPeriods.dismissedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// True when the candidate has at least one employment episode (open OR
// closed). Drives the first-hire vs re-hire decision in hireCandidate —
// candidates.workStartDate is NOT a reliable signal for that: legacy imports
// and manual form edits set it without ever creating a period.
export async function hasAny(candidateId: string, exec: Executor = db): Promise<boolean> {
  const rows = await exec
    .select({ id: employmentPeriods.id })
    .from(employmentPeriods)
    .where(eq(employmentPeriods.candidateId, candidateId))
    .limit(1);
  return rows.length > 0;
}

export async function insert(
  input: NewEmploymentPeriod,
  exec: Executor = db,
): Promise<EmploymentPeriod> {
  const [row] = await exec.insert(employmentPeriods).values(input).returning();
  if (!row) throw new Error('Failed to insert employment_period');
  return row;
}

// Corrects an already-closed period whose dismissed_at matches `oldDismissedAt`.
// Used when an admin edits a dismissal's date/reason after the fact — keeps the
// employment history (and retention analytics) in sync with the correction.
// Matching on (candidateId, oldDismissedAt) targets the exact period that the
// original dismissal closed, without touching other re-hire cycles.
export async function adjustClosedDismissal(
  candidateId: string,
  oldDismissedAt: Date,
  newDismissedAt: Date,
  newReason: string | null,
): Promise<EmploymentPeriod | null> {
  const [row] = await db
    .update(employmentPeriods)
    .set({ dismissedAt: newDismissedAt, dismissedReason: newReason })
    .where(
      and(
        eq(employmentPeriods.candidateId, candidateId),
        eq(employmentPeriods.dismissedAt, oldDismissedAt),
      ),
    )
    .returning();
  return row ?? null;
}

// Closes an open period — sets dismissed_at + dismissed_reason. The unique
// partial index ensures only the open period gets updated.
export async function closeOpen(
  candidateId: string,
  dismissedAt: Date,
  dismissedReason: string | null,
  exec: Executor = db,
): Promise<EmploymentPeriod | null> {
  const [row] = await exec
    .update(employmentPeriods)
    .set({ dismissedAt, dismissedReason })
    .where(
      and(
        eq(employmentPeriods.candidateId, candidateId),
        isNull(employmentPeriods.dismissedAt),
      ),
    )
    .returning();
  return row ?? null;
}
