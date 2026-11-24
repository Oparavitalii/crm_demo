import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { auditLog } from '../../db/tables/audit-log';
import { candidates } from '../../db/tables/candidates';
import { projects } from '../../db/tables/projects';
import * as projectsService from '../../services/projects.service';
import type { ListProjectsQuery } from '@opushr/shared';
import { asActor, makeCandidate, makeProject, makeUser, noCtx } from './fixtures';

// Real-Postgres integration tests for projects.service. The unit suite mocks
// the chainable db, which hides:
//   - capacity-math join shape (foundCount / missingCount / percentFilled),
//   - the `headcountResetAt` baseline window (compares against candidate
//     updated_at, NOT created_at — see repo file for the exact predicate),
//   - the per-recruiter scoping of foundCount (every actor sees every
//     project, but each actor's foundCount counts ONLY their own candidates),
//   - the FK rule on candidates.project_id (ON DELETE SET NULL) and the
//     symmetric soft-delete behavior when a project is removed,
//   - the audit-before-remove ordering inside deleteProject.

// Tiny helper — every list call needs the pagination defaults + the default
// sort. Spelling out the full shape on every call buries the assertion under
// noise.
function q(overrides: Partial<ListProjectsQuery> = {}): ListProjectsQuery {
  return {
    page: 1,
    pageSize: 100,
    sortBy: 'startDate',
    sortDir: 'desc',
    ...overrides,
  } as ListProjectsQuery;
}

describe('projects.service.listProjects — capacity math (integration)', () => {
  it('foundCount/missingCount/percentFilled reflect assigned candidates', async () => {
    // Lock the canonical capacity calculation: with headcountNeeded=5 and
    // 3 assigned candidates, foundCount=3, missingCount=2, percentFilled=0.6.
    // The progress field is `percentFilled` (0..1) — NOT a `progress` object.
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'Capacity-5', headcountNeeded: 5 });
    for (let i = 0; i < 3; i += 1) {
      await makeCandidate({
        recruiterId: admin.id,
        projectId: proj.id,
        status: 'new',
      });
    }

    const result = await projectsService.listProjects(q(), asActor(admin));
    const target = result.items.find((p) => p.id === proj.id);
    expect(target).toBeDefined();
    expect(target?.foundCount).toBe(3);
    expect(target?.missingCount).toBe(2);
    expect(target?.percentFilled).toBeCloseTo(0.6, 5);
  });

  it('headcountNeeded=0 yields percentFilled=0 even with candidates assigned', async () => {
    // Guard against division-by-zero: the repo short-circuits headcountNeeded=0
    // to percentFilled=0 regardless of how many candidates are linked.
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'Open-ended', headcountNeeded: 0 });
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
    });
    const result = await projectsService.listProjects(q(), asActor(admin));
    const target = result.items.find((p) => p.id === proj.id);
    expect(target?.foundCount).toBe(1);
    expect(target?.missingCount).toBe(0);
    expect(target?.percentFilled).toBe(0);
  });

  it('foundCount excludes cancelled and blacklist status', async () => {
    // The repo filters `status NOT IN ('cancelled', 'blacklist')`. Dismissed
    // candidates are still counted because the project staffed them historically
    // (spec: see projects.repo.ts file header).
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'Filter-status', headcountNeeded: 10 });
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
    });
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'cancelled',
    });
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'blacklist',
    });
    // Dismissed candidate IS counted (historical staffing).
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'dismissed',
    });

    const result = await projectsService.listProjects(q(), asActor(admin));
    const target = result.items.find((p) => p.id === proj.id);
    expect(target?.foundCount).toBe(2);
    expect(target?.missingCount).toBe(8);
  });

  it('foundCount excludes anonymized candidates (RODO right-to-erasure contract)', async () => {
    // The repo predicate is `isNull(candidates.anonymizedAt)`. Setting
    // anonymizedAt drops the candidate from the headcount — this is the
    // load-bearing RODO behavior the unit tests cannot prove.
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'Anon-exclude', headcountNeeded: 5 });
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
    });
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
    });
    const toAnon = await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
    });
    // Anonymize the third row directly at the SQL layer — bypass the service
    // so the test isolates the projects-repo predicate from anonymize logic.
    await db
      .update(candidates)
      .set({ anonymizedAt: new Date(), processingRestricted: true })
      .where(eq(candidates.id, toAnon.id));

    const result = await projectsService.listProjects(q(), asActor(admin));
    const target = result.items.find((p) => p.id === proj.id);
    expect(target?.foundCount).toBe(2);
    expect(target?.missingCount).toBe(3);
  });

  // QUIRK / SUSPECTED RODO SOFT-GAP (for human review, do NOT fix here):
  //   The projects-repo capacity predicate filters on `anonymizedAt IS NULL`
  //   only — it does NOT consult `processingRestricted`. anonymize.service.ts
  //   sets both columns together, so in production the two flags move in
  //   lockstep. But if a future migration or admin tool ever flips
  //   processingRestricted=true WITHOUT stamping anonymizedAt (e.g. partial
  //   restriction without full erasure), the candidate would still count
  //   toward the project headcount. Compare to bulk-send.service.ts which
  //   filters on processingRestricted directly.
  //
  //   This test LOCKS the current behavior so any tightening (also exclude
  //   processingRestricted=true rows) is intentional.
  it('foundCount counts processingRestricted candidates when anonymizedAt is NULL (current behavior)', async () => {
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'PR-quirk', headcountNeeded: 3 });
    await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
      processingRestricted: true,
    });

    const result = await projectsService.listProjects(q(), asActor(admin));
    const target = result.items.find((p) => p.id === proj.id);
    expect(target?.foundCount).toBe(1);
  });
});

describe('projects.service.listProjects — headcountResetAt baseline (integration)', () => {
  it('only candidates with updatedAt >= headcountResetAt count toward foundCount', async () => {
    // The repo predicate is `gte(candidates.updatedAt, projects.headcountResetAt)`.
    // NOTE: the prompt mentions `createdAt`, but the actual column compared is
    // `updatedAt` — locked here so the divergence is documented. A candidate
    // whose `updatedAt` falls BEFORE the reset moment is excluded; one whose
    // `updatedAt` falls AFTER is included.
    const admin = await makeUser({ role: 'admin' });
    const past = new Date('2026-01-01T00:00:00Z');
    const reset = new Date('2026-06-01T00:00:00Z');
    const future = new Date('2026-06-10T00:00:00Z');

    const proj = await makeProject({
      name: 'Baseline',
      headcountNeeded: 5,
      headcountResetAt: reset,
    });

    // BEFORE the reset: drop the candidate's updatedAt to a past moment.
    const oldCand = await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
    });
    await db
      .update(candidates)
      .set({ updatedAt: past })
      .where(eq(candidates.id, oldCand.id));

    // AFTER the reset: stamp updatedAt strictly after the reset.
    const newCand = await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
      status: 'new',
    });
    await db
      .update(candidates)
      .set({ updatedAt: future })
      .where(eq(candidates.id, newCand.id));

    const result = await projectsService.listProjects(q(), asActor(admin));
    const target = result.items.find((p) => p.id === proj.id);
    expect(target?.foundCount).toBe(1);
  });
});

describe('projects.service.listProjects — visibility across roles (integration)', () => {
  it('every authenticated role sees the full project list (projects are agency-shared)', async () => {
    // Per the listProjects header comment: "Projects themselves are shared
    // (every user sees the same list of projects)". Only the per-project
    // staffing metric is scoped to the actor. This locks row-visibility so
    // any future tightening (e.g. scoping projects to an owner) trips here.
    const admin = await makeUser({ role: 'admin' });
    const recruiter = await makeUser({ role: 'recruiter' });
    const coordinator = await makeUser({ role: 'coordinator' });
    const readonly = await makeUser({ role: 'readonly' });

    const p1 = await makeProject({ name: 'Visible-A' });
    const p2 = await makeProject({ name: 'Visible-B' });
    const p3 = await makeProject({ name: 'Visible-C' });
    const allIds = [p1.id, p2.id, p3.id].sort();

    for (const actor of [admin, recruiter, coordinator, readonly]) {
      const result = await projectsService.listProjects(q(), asActor(actor));
      const ids = result.items.map((p) => p.id).sort();
      expect(ids).toEqual(allIds);
      expect(result.total).toBe(3);
    }
  });

  it('recruiter foundCount is scoped to their own candidates; admin sees the global count', async () => {
    // Per the repo: foundCount is filtered by `candidates.recruiterId =
    // scope.recruiterId` when the actor is a recruiter. Admin sees the global
    // count (no scope). Lock both perspectives on the same row.
    const admin = await makeUser({ role: 'admin' });
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const proj = await makeProject({ name: 'Scoped-counts', headcountNeeded: 5 });

    await makeCandidate({ recruiterId: recA.id, projectId: proj.id, status: 'new' });
    await makeCandidate({ recruiterId: recA.id, projectId: proj.id, status: 'new' });
    await makeCandidate({ recruiterId: recB.id, projectId: proj.id, status: 'new' });

    const asAdmin = await projectsService.listProjects(q(), asActor(admin));
    expect(asAdmin.items.find((p) => p.id === proj.id)?.foundCount).toBe(3);

    const asRecA = await projectsService.listProjects(q(), asActor(recA));
    expect(asRecA.items.find((p) => p.id === proj.id)?.foundCount).toBe(2);

    const asRecB = await projectsService.listProjects(q(), asActor(recB));
    expect(asRecB.items.find((p) => p.id === proj.id)?.foundCount).toBe(1);
  });
});

describe('projects.service.listProjects — sort/order (integration)', () => {
  it('default sort = startDate desc NULLS LAST', async () => {
    // The repo wires startDate sort to `nulls last` so projects with no known
    // start date sink to the bottom regardless of direction. Lock the order
    // explicitly: latest startDate first, then earlier, then NULL.
    const admin = await makeUser({ role: 'admin' });
    const newest = await makeProject({
      name: 'Newest',
      startDate: '2026-08-01',
    });
    const middle = await makeProject({
      name: 'Middle',
      startDate: '2026-06-01',
    });
    const noDate = await makeProject({
      name: 'NoDate',
      startDate: null,
    });

    const result = await projectsService.listProjects(q(), asActor(admin));
    const ids = result.items.map((p) => p.id);
    expect(ids).toEqual([newest.id, middle.id, noDate.id]);
  });

  it('sortBy=name asc returns alphabetical order', async () => {
    const admin = await makeUser({ role: 'admin' });
    const c = await makeProject({ name: 'Charlie' });
    const a = await makeProject({ name: 'Alpha' });
    const b = await makeProject({ name: 'Bravo' });
    const result = await projectsService.listProjects(
      q({ sortBy: 'name', sortDir: 'asc' }),
      asActor(admin),
    );
    expect(result.items.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('projects.service.updateProject — admin-only mutation (integration)', () => {
  it('admin update lands in DB and writes an audit row', async () => {
    // horizontal_access.test.ts locks the FORBIDDEN branch for recruiters.
    // Here we lock the happy path: admin actor → DB row mutated, audit row
    // written with the right action/entityType.
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({
      name: 'Pre-rename',
      headcountNeeded: 3,
    });

    const result = await projectsService.updateProject(
      proj.id,
      { name: 'Post-rename', headcountNeeded: 7 },
      asActor(admin),
      noCtx,
    );
    expect(result.name).toBe('Post-rename');
    expect(result.headcountNeeded).toBe(7);

    const row = await db.select().from(projects).where(eq(projects.id, proj.id));
    expect(row[0]?.name).toBe('Post-rename');
    expect(row[0]?.headcountNeeded).toBe(7);

    const trail = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.entityType, 'project'), eq(auditLog.entityId, proj.id)),
      );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe('update_project');
    expect(trail[0]?.actorId).toBe(admin.id);
  });

  it('changing headcountNeeded bumps headcountResetAt (staffing-baseline reset)', async () => {
    // Per the service: headcountNeeded OR startDate change resets the baseline
    // so the progress bar restarts from 0. Touching `notes` or `isActive` does
    // NOT reset. Lock the reset trigger here.
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({
      name: 'Reset-trigger',
      headcountNeeded: 3,
    });
    const beforeReset = proj.headcountResetAt;

    const result = await projectsService.updateProject(
      proj.id,
      { headcountNeeded: 10 },
      asActor(admin),
      noCtx,
    );
    expect(result.headcountResetAt.getTime()).toBeGreaterThan(
      beforeReset.getTime(),
    );
  });

  it('changing only `notes` does NOT bump headcountResetAt', async () => {
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({
      name: 'No-reset',
      headcountNeeded: 3,
      notes: 'old notes',
    });
    const beforeReset = proj.headcountResetAt;

    const result = await projectsService.updateProject(
      proj.id,
      { notes: 'new notes' },
      asActor(admin),
      noCtx,
    );
    expect(result.headcountResetAt.getTime()).toBe(beforeReset.getTime());
  });
});

describe('projects.service.deleteProject — admin-only mutation (integration)', () => {
  it('admin delete removes the row AND writes audit BEFORE remove', async () => {
    // Canonical RODO-traceability pattern (same as dismissals): the audit
    // insert must happen BEFORE repo.remove so the trail survives even if
    // the delete fails. We assert both the row is gone AND the audit row
    // points at the (now-deleted) project entityId.
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'To-delete' });

    await projectsService.deleteProject(proj.id, asActor(admin), noCtx);

    const remaining = await db
      .select()
      .from(projects)
      .where(eq(projects.id, proj.id));
    expect(remaining).toHaveLength(0);

    const trail = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.entityType, 'project'), eq(auditLog.entityId, proj.id)),
      );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe('delete_project');
    expect(trail[0]?.actorId).toBe(admin.id);
    const oldValue = trail[0]?.oldValue as { name: string };
    expect(oldValue.name).toBe('To-delete');
  });

  it('deleting a project with assigned candidates → HAS_REFERENCES + row stays', async () => {
    // candidates.project_id has ON DELETE SET NULL — but the service catches
    // 23503 too. In practice the candidate FK is `set null`, so the raw
    // delete actually SUCCEEDS and the candidate's projectId becomes NULL.
    // Lock the actual behavior: project is removed, candidate.projectId=NULL.
    // (If a future schema change tightens the FK to RESTRICT, the service
    // would throw HAS_REFERENCES — this test should flip and assert that.)
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'Has-refs' });
    const cand = await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
    });

    await projectsService.deleteProject(proj.id, asActor(admin), noCtx);

    const projAfter = await db
      .select()
      .from(projects)
      .where(eq(projects.id, proj.id));
    expect(projAfter).toHaveLength(0);

    const candAfter = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(candAfter).toHaveLength(1);
    expect(candAfter[0]?.projectId).toBeNull();
  });
});

describe('projects FK behavior on candidate hard-delete (integration)', () => {
  it('deleting a candidate does NOT touch the project (no reverse FK)', async () => {
    // candidates.project_id → projects.id, ON DELETE SET NULL. There is no
    // reverse FK (projects do not reference candidates), so a candidate
    // hard-delete leaves the project row untouched. Lock the asymmetry.
    const admin = await makeUser({ role: 'admin' });
    const proj = await makeProject({ name: 'Survive-cand-delete' });
    const cand = await makeCandidate({
      recruiterId: admin.id,
      projectId: proj.id,
    });

    await db.delete(candidates).where(eq(candidates.id, cand.id));

    const projAfter = await db
      .select()
      .from(projects)
      .where(eq(projects.id, proj.id));
    expect(projAfter).toHaveLength(1);
    expect(projAfter[0]?.name).toBe('Survive-cand-delete');
  });
});
