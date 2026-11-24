import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { candidates } from '../../db/tables/candidates';
import { tasks } from '../../db/tables/tasks';
import { dismissals } from '../../db/tables/dismissals';
import { projects } from '../../db/tables/projects';
import { users } from '../../db/tables/users';
import * as candidatesService from '../../services/candidates.service';
import * as dismissalsService from '../../services/dismissals.service';
import * as tasksService from '../../services/tasks.service';
import * as projectsService from '../../services/projects.service';
import * as adminUsersService from '../../services/admin-users.service';
import {
  asActor,
  makeCandidate,
  makeDismissal,
  makeProject,
  makeTask,
  makeUser,
  noCtx,
} from './fixtures';

// Cross-recruiter access is the single highest-risk bug class in this CRM
// (per docs/Engineering_Rules.md). This file enumerates "recruiter A touches an
// entity owned by recruiter B" for every mutating service. New entities
// MUST be added here when they land — adding a row to the matrix is the
// price of admission.
//
// Convention: services should throw NotFoundError (code: 'NOT_FOUND') so the
// row's existence is not leaked. A handful of legacy paths throw
// ForbiddenError (code: 'FORBIDDEN') instead — see the inline notes on
// `deleteTask` and `deleteDismissal`. Either way the mutation MUST be
// rejected and the row preserved unchanged.

describe('horizontal access — candidates (recruiter A vs B)', () => {
  it('getCandidate of B as A → NOT_FOUND', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({ recruiterId: recB.id });
    await expect(
      candidatesService.getCandidate(cand.id, asActor(recA)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updateCandidate of B as A → NOT_FOUND + row unchanged', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({ recruiterId: recB.id, name: 'Original' });
    await expect(
      candidatesService.updateCandidate(
        cand.id,
        { name: 'Hacked' },
        asActor(recA),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const row = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(row[0]?.name).toBe('Original');
    expect(row[0]?.recruiterId).toBe(recB.id);
  });

  it('deleteCandidate of B as A → NOT_FOUND + row stays', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({ recruiterId: recB.id });
    await expect(
      candidatesService.deleteCandidate(cand.id, asActor(recA), noCtx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const row = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(row).toHaveLength(1);
  });

  it('hireCandidate of B as A → NOT_FOUND', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({
      recruiterId: recB.id,
      status: 'documents_submitted',
    });
    await expect(
      candidatesService.hireCandidate(
        cand.id,
        { workStartDate: new Date().toISOString(), housingType: 'our' },
        asActor(recA),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const row = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(row[0]?.status).toBe('documents_submitted');
  });

  it('dismissCandidate of B as A → NOT_FOUND', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({
      recruiterId: recB.id,
      status: 'employed',
      kind: 'client',
    });
    await expect(
      candidatesService.dismissCandidate(
        cand.id,
        {
          workEndDate: new Date().toISOString(),
          reasonNote: 'attempted cross-recruiter dismiss',
        },
        asActor(recA),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const row = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, cand.id));
    expect(row[0]?.status).toBe('employed');
  });
});

describe('horizontal access — tasks (recruiter A vs B)', () => {
  it('getTask of B as A → NOT_FOUND', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    // Standalone task (no candidateId) owned by recB. assertCanSeeTask falls
    // through to the "no candidate link" branch and throws NotFoundError.
    const task = await makeTask({
      assigneeId: recB.id,
      createdById: recB.id,
    });
    await expect(
      tasksService.getTask(task.id, asActor(recA)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updateTask of B as A → NOT_FOUND + row unchanged', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const task = await makeTask({
      assigneeId: recB.id,
      createdById: recB.id,
      title: 'Original task',
    });
    await expect(
      tasksService.updateTask(
        task.id,
        { title: 'Hacked' },
        asActor(recA),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const row = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row[0]?.title).toBe('Original task');
  });

  // SECURITY: tasks.service.deleteTask short-circuits on creator-check and
  // throws ForbiddenError (not NotFoundError), which leaks the task's
  // existence. The mutation is still blocked — recruiter A cannot delete
  // recruiter B's task — but a strict "don't leak existence" reviewer would
  // flag this. Tracked as a soft follow-up; the matrix asserts FORBIDDEN
  // to lock current behavior so any future change is intentional.
  it('deleteTask of B as A → FORBIDDEN + row stays (existence leaks via 403)', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const task = await makeTask({
      assigneeId: recB.id,
      createdById: recB.id,
    });
    await expect(
      tasksService.deleteTask(task.id, asActor(recA), noCtx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row).toHaveLength(1);
  });
});

describe('horizontal access — dismissals (recruiter A vs B)', () => {
  it('getDismissal of B as A → NOT_FOUND', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({ recruiterId: recB.id });
    const dism = await makeDismissal({
      candidateId: cand.id,
      recordedById: recB.id,
    });
    await expect(
      dismissalsService.getDismissal(dism.id, asActor(recA)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('updateDismissal of B as A → NOT_FOUND + row unchanged', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({ recruiterId: recB.id });
    const dism = await makeDismissal({
      candidateId: cand.id,
      recordedById: recB.id,
      reason: 'original-reason',
    });
    await expect(
      dismissalsService.updateDismissal(
        dism.id,
        { reason: 'Hacked' },
        asActor(recA),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const row = await db
      .select()
      .from(dismissals)
      .where(eq(dismissals.id, dism.id));
    expect(row[0]?.reason).toBe('original-reason');
  });

  // SECURITY: dismissals.service.deleteDismissal is admin-only by spec —
  // recruiters are rejected with FORBIDDEN before any findById. That means
  // existence is NOT leaked here (the same error fires whether the row
  // exists or not), but the code path differs from get/update which use
  // NotFoundError for cross-recruiter access. We lock the FORBIDDEN
  // behavior for visibility in the matrix.
  it('deleteDismissal of B as A → FORBIDDEN + row stays', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const cand = await makeCandidate({ recruiterId: recB.id });
    const dism = await makeDismissal({
      candidateId: cand.id,
      recordedById: recB.id,
    });
    await expect(
      dismissalsService.deleteDismissal(dism.id, asActor(recA), noCtx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await db
      .select()
      .from(dismissals)
      .where(eq(dismissals.id, dism.id));
    expect(row).toHaveLength(1);
  });
});

describe('horizontal access — projects (recruiter A vs admin-owned)', () => {
  // QUIRK: projects are SHARED across the agency by design — see
  // listProjects's "every user sees the same list" comment. The only
  // per-recruiter twist is the staffing metric, not row visibility. So
  // getProject does NOT reject another recruiter — it returns the row.
  // We lock this behavior so any future tightening (e.g. scoping projects
  // to an owner) trips this test.
  it('getProject by any recruiter → succeeds (projects are shared)', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const proj = await makeProject({ name: 'Shared Project' });
    const fetched = await projectsService.getProject(proj.id, asActor(recA));
    expect(fetched.id).toBe(proj.id);
    expect(fetched.name).toBe('Shared Project');
  });

  // QUIRK: updateProject is admin-only → recruiter gets FORBIDDEN. Note the
  // role check fires BEFORE the existence check, so a non-existent id with
  // a recruiter actor also returns FORBIDDEN (mild existence-leak prevention
  // by accident, but the more interesting fact is mutation is locked down).
  it('updateProject as recruiter → FORBIDDEN + row unchanged', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const proj = await makeProject({ name: 'Original' });
    await expect(
      projectsService.updateProject(
        proj.id,
        { name: 'Hacked' },
        asActor(recA),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await db.select().from(projects).where(eq(projects.id, proj.id));
    expect(row[0]?.name).toBe('Original');
  });

  // QUIRK: deleteProject is admin-only → recruiter gets FORBIDDEN. Same
  // shape as updateProject; row stays put.
  it('deleteProject as recruiter → FORBIDDEN + row stays', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const proj = await makeProject();
    await expect(
      projectsService.deleteProject(proj.id, asActor(recA), noCtx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await db.select().from(projects).where(eq(projects.id, proj.id));
    expect(row).toHaveLength(1);
  });
});

describe('horizontal access — users (recruiter A vs B)', () => {
  // QUIRK: the admin-users SERVICE layer has NO role guards on
  // getUser / updateUser / triggerPasswordReset / forceLogout. All
  // admin gating lives at the ROUTE layer (routes/admin/users.ts uses
  // requireRole(['admin'])). This means calling the service functions
  // directly from a recruiter actor will SUCCEED — that is intentional
  // because the services trust their caller, and integration tests
  // hitting the HTTP layer cover the route-level guard separately.
  //
  // To keep the horizontal-access matrix meaningful for `users`, we
  // assert the self-protection rules that DO live in the service (the
  // ones that protect against admin-on-admin / admin-on-self mistakes),
  // and we document the absence of cross-recruiter checks here.
  //
  // SUSPECTED GAP (for human review, do NOT fix):
  //   - adminUsersService.getUser / updateUser / triggerPasswordReset
  //     do not check actor.role. If any non-admin route is ever wired
  //     to these without requireRole(['admin']), recruiters could read
  //     or mutate arbitrary user rows. The route file is currently
  //     correct, so this is a latent footgun, not an active bug.
  it('getUser of B as A → succeeds at service layer (route-only guard, see comment)', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const fetched = await adminUsersService.getUser(recB.id, asActor(recA));
    expect(fetched.id).toBe(recB.id);
  });

  // Admin attempting to change their OWN role → FORBIDDEN (self_protection).
  // This is the one cross-cutting guard that DOES live in updateUser, and
  // it fires regardless of role.
  it('updateUser self role change → FORBIDDEN', async () => {
    const admin = await makeUser({ role: 'admin' });
    await expect(
      adminUsersService.updateUser(
        admin.id,
        { role: 'recruiter' },
        asActor(admin),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await db.select().from(users).where(eq(users.id, admin.id));
    expect(row[0]?.role).toBe('admin');
  });

  // Admin attempting to deactivate THEMSELVES → FORBIDDEN (self_protection).
  it('updateUser self deactivate → FORBIDDEN', async () => {
    const admin = await makeUser({ role: 'admin' });
    await expect(
      adminUsersService.updateUser(
        admin.id,
        { isActive: false },
        asActor(admin),
        noCtx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const row = await db.select().from(users).where(eq(users.id, admin.id));
    expect(row[0]?.isActive).toBe(true);
  });

  // forceLogout against self → FORBIDDEN (mcp_test M18 footgun guard).
  it('forceLogout self → FORBIDDEN', async () => {
    const admin = await makeUser({ role: 'admin' });
    await expect(
      adminUsersService.forceLogout(admin.id, asActor(admin), noCtx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
