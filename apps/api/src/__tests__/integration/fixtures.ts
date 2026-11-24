import { db } from '../../db/client';
import { users, type NewUser } from '../../db/tables/users';
import { candidates, type NewCandidate } from '../../db/tables/candidates';
import { projects, type NewProject } from '../../db/tables/projects';
import { dismissals, type NewDismissal } from '../../db/tables/dismissals';
import { tasks, type NewTask } from '../../db/tables/tasks';

// Test fixture factories. They return the created rows so tests can chain
// assertions without round-tripping IDs through repos. Designed for use after
// the per-test TRUNCATE in setup.ts — every call inserts a fresh row.

let userSeq = 0;
let candSeq = 0;
let projSeq = 0;
let dismSeq = 0;
let taskSeq = 0;

export async function makeUser(overrides: Partial<NewUser> = {}) {
  userSeq += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `user-${userSeq}@test.local`,
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQR',
      firstName: `Test${userSeq}`,
      lastName: 'User',
      role: 'recruiter',
      isActive: true,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('makeUser: insert returned no row');
  return row;
}

export async function makeCandidate(overrides: Partial<NewCandidate> = {}) {
  candSeq += 1;
  const [row] = await db
    .insert(candidates)
    .values({
      name: `Cand${candSeq} Test`,
      email: `cand-${candSeq}@test.local`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('makeCandidate: insert returned no row');
  return row;
}

export async function makeProject(overrides: Partial<NewProject> = {}) {
  projSeq += 1;
  const [row] = await db
    .insert(projects)
    .values({
      name: `Project ${projSeq}`,
      isActive: true,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('makeProject: insert returned no row');
  return row;
}

// Tasks fixture. `type` defaults to 'other' (free-text on the table, but the
// service writes 'other' when callers omit it). `title` is required; pass
// `assigneeId` / `createdById` explicitly when testing horizontal-access.
export async function makeTask(overrides: Partial<NewTask> = {}) {
  taskSeq += 1;
  const [row] = await db
    .insert(tasks)
    .values({
      title: `Task ${taskSeq}`,
      type: 'other',
      ...overrides,
    } as NewTask)
    .returning();
  if (!row) throw new Error('makeTask: insert returned no row');
  return row;
}

// Dismissals fixture. NOT NULL columns: candidateId, dismissedAt, reason.
// Tests must supply `candidateId` (the dismissed candidate) and optionally
// `recordedById` (who logged the dismissal). The `createdBy` parameter the
// plan suggested does not exist in this table — see plan vs reality note in
// horizontal_access.test.ts.
export async function makeDismissal(overrides: Partial<NewDismissal> = {}) {
  dismSeq += 1;
  const [row] = await db
    .insert(dismissals)
    .values({
      dismissedAt: new Date(),
      reason: `test-reason-${dismSeq}`,
      ...overrides,
    } as NewDismissal)
    .returning();
  if (!row) throw new Error('makeDismissal: insert returned no row');
  return row;
}

export const noCtx = { ip: null, userAgent: null };

export function asActor(user: { id: string; role: 'admin' | 'recruiter' | 'coordinator' | 'readonly' }) {
  return { id: user.id, role: user.role };
}
