import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { candidates } from '../../db/tables/candidates';
import { employmentPeriods } from '../../db/tables/employment-periods';
import { auditLog } from '../../db/tables/audit-log';
import {
  deleteCandidate,
  getCandidate,
  hireCandidate,
  listCandidates,
  rehireCandidate,
  updateCandidate,
} from '../../services/candidates.service';
import { asActor, makeCandidate, makeProject, makeUser, noCtx } from './fixtures';

// These tests run against a real Neon branch (TEST_DATABASE_URL). They prove
// behavior the mocked-repo unit tests cannot: real FK constraints fire,
// transactions actually roll back, and RBAC scoping translates to a WHERE
// clause that returns the right rows.

describe('candidates.service.deleteCandidate (integration)', () => {
  it('writes audit row, removes candidate, audit survives the delete', async () => {
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });

    await deleteCandidate(cand.id, asActor(admin), noCtx);

    const remaining = await db.select().from(candidates).where(eq(candidates.id, cand.id));
    expect(remaining).toHaveLength(0);

    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, cand.id));
    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe('delete_candidate');
    expect(trail[0]?.actorId).toBe(admin.id);
  });

  it('cascades to employment_periods (FK onDelete: cascade) and keeps audit row', async () => {
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });
    // employment_periods.candidate_id is ON DELETE CASCADE — deleting the
    // candidate must silently remove the period rows. Audit row stays as the
    // RODO trail of the deletion event.
    await db.insert(employmentPeriods).values({
      candidateId: cand.id,
      employedAt: new Date(),
      housingType: 'our',
      createdBy: admin.id,
    });

    await deleteCandidate(cand.id, asActor(admin), noCtx);

    const remaining = await db.select().from(candidates).where(eq(candidates.id, cand.id));
    expect(remaining).toHaveLength(0);

    const cascadedPeriods = await db
      .select()
      .from(employmentPeriods)
      .where(eq(employmentPeriods.candidateId, cand.id));
    expect(cascadedPeriods).toHaveLength(0);

    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, cand.id));
    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe('delete_candidate');
  });
});

describe('candidates.service.listCandidates (integration)', () => {
  it('recruiter scope returns own only — hides other recruiters AND unassigned rows (2026-06-11)', async () => {
    const rec1 = await makeUser({ role: 'recruiter' });
    const rec2 = await makeUser({ role: 'recruiter' });

    const ownCand = await makeCandidate({ recruiterId: rec1.id });
    const otherCand = await makeCandidate({ recruiterId: rec2.id });
    const unassigned = await makeCandidate({ recruiterId: null });

    const result = await listCandidates(
      { page: 1, pageSize: 50, includeAnonymized: false },
      asActor(rec1),
    );

    const ids = result.items.map((it) => it.id).sort();
    expect(ids).toEqual([ownCand.id]);
    expect(ids).not.toContain(otherCand.id);
    expect(ids).not.toContain(unassigned.id);
  });
});

describe('candidates.service — horizontal access (recruiter A vs recruiter B)', () => {
  // The single most dangerous CRM bug class: a recruiter touches a candidate
  // belonging to someone else. Service must surface a NotFound (not Forbidden)
  // so the row's existence is not leaked.

  it('recruiter A cannot getCandidate of recruiter B → NotFound', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const candOfB = await makeCandidate({ recruiterId: recB.id });

    await expect(getCandidate(candOfB.id, asActor(recA))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('recruiter A cannot updateCandidate of recruiter B → NotFound', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const candOfB = await makeCandidate({ recruiterId: recB.id, name: 'Original' });

    await expect(
      updateCandidate(candOfB.id, { name: 'Hacked' }, asActor(recA), noCtx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const row = await db.select().from(candidates).where(eq(candidates.id, candOfB.id));
    expect(row[0]?.name).toBe('Original');
    expect(row[0]?.recruiterId).toBe(recB.id);
  });

  it('recruiter A cannot deleteCandidate of recruiter B → NotFound, row stays', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const candOfB = await makeCandidate({ recruiterId: recB.id });

    await expect(deleteCandidate(candOfB.id, asActor(recA), noCtx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const stillThere = await db.select().from(candidates).where(eq(candidates.id, candOfB.id));
    expect(stillThere).toHaveLength(1);
  });

  it('recruiter cannot reassign own candidate to another recruiter (silent coerce to self)', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const candOfA = await makeCandidate({ recruiterId: recA.id });

    await updateCandidate(
      candOfA.id,
      { recruiterId: recB.id },
      asActor(recA),
      noCtx,
    );

    const row = await db.select().from(candidates).where(eq(candidates.id, candOfA.id));
    expect(row[0]?.recruiterId).toBe(recA.id);
  });
});

describe('candidates.service.hireCandidate (integration)', () => {
  it('happy path: writes candidate update AND employment_period atomically', async () => {
    const admin = await makeUser({ role: 'admin' });
    const project = await makeProject();
    const cand = await makeCandidate({
      recruiterId: admin.id,
      status: 'documents_submitted',
      workStartDate: null,
    });

    const result = await hireCandidate(
      cand.id,
      {
        workStartDate: new Date('2026-06-01T08:00:00.000Z').toISOString(),
        housingType: 'our',
        projectId: project.id,
        coordinatorId: admin.id,
      },
      asActor(admin),
      noCtx,
    );

    expect(result.status).toBe('employed');
    expect(result.kind).toBe('client');
    expect(result.workStartDate).toBeInstanceOf(Date);

    const periods = await db
      .select()
      .from(employmentPeriods)
      .where(eq(employmentPeriods.candidateId, cand.id));
    expect(periods).toHaveLength(1);
    expect(periods[0]?.projectId).toBe(project.id);
    expect(periods[0]?.coordinatorId).toBe(admin.id);
  });

  it('rolls back BOTH writes when employment_period violates a foreign key', async () => {
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({
      recruiterId: admin.id,
      status: 'documents_submitted',
      workStartDate: null,
    });
    const badProjectId = '00000000-0000-0000-0000-deadbeef0001';

    await expect(
      hireCandidate(
        cand.id,
        {
          workStartDate: new Date('2026-06-01T08:00:00.000Z').toISOString(),
          housingType: 'our',
          projectId: badProjectId,
        },
        asActor(admin),
        noCtx,
      ),
    ).rejects.toThrow();

    // Candidate must NOT have flipped to employed — the transaction unwound.
    const after = await db.select().from(candidates).where(eq(candidates.id, cand.id));
    expect(after[0]?.status).toBe('documents_submitted');
    expect(after[0]?.kind).toBe('candidate');
    expect(after[0]?.workStartDate).toBeNull();

    // No employment_period row should have leaked through.
    const periods = await db
      .select()
      .from(employmentPeriods)
      .where(eq(employmentPeriods.candidateId, cand.id));
    expect(periods).toHaveLength(0);

    // Audit log is outside the transaction; it must NOT fire on tx failure.
    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, cand.id));
    expect(trail).toHaveLength(0);
  });
});

describe('candidates.service.rehireCandidate (integration)', () => {
  // Re-hire scenario: a candidate was hired (employment_period row exists,
  // dismissedAt set), candidate.status moved to dismissed, then a new hire
  // is requested. The lifecycle service must:
  //   1. Detect "not first hire" from the existing employment_period rows and
  //      set candidate.status = 're_employed' (2026-07-10: the card's
  //      workStartDate now moves to the new episode; history stays in periods).
  //   2. Insert a NEW employment_period row alongside the closed one.
  //   3. Write candidate update + period insert atomically.

  it('happy path: writes re_employed status + new employment_period alongside the closed one', async () => {
    const admin = await makeUser({ role: 'admin' });
    const project = await makeProject();
    const originalStart = new Date('2025-01-01T08:00:00.000Z');
    const cand = await makeCandidate({
      recruiterId: admin.id,
      kind: 'client',
      status: 'dismissed',
      workStartDate: originalStart,
      workEndDate: new Date('2025-12-01T17:00:00.000Z'),
      workEndReason: 'voluntary',
    });
    // Seed the closed prior period so the re-hire scenario is realistic.
    await db.insert(employmentPeriods).values({
      candidateId: cand.id,
      employedAt: originalStart,
      dismissedAt: new Date('2025-12-01T17:00:00.000Z'),
      dismissedReason: 'voluntary',
      housingType: 'our',
      createdBy: admin.id,
    });

    const newStart = new Date('2026-06-01T08:00:00.000Z');
    const result = await rehireCandidate(
      cand.id,
      {
        workStartDate: newStart.toISOString(),
        housingType: 'own',
        projectId: project.id,
        coordinatorId: admin.id,
      },
      asActor(admin),
      noCtx,
    );

    // Status flipped to re_employed; card workStartDate mirrors the NEW
    // episode (2026-07-10) — per-episode tenure lives in employment_periods.
    expect(result.status).toBe('re_employed');
    expect(result.kind).toBe('client');
    expect(result.workStartDate?.getTime()).toBe(newStart.getTime());
    expect(result.workEndDate).toBeNull();
    expect(result.workEndReason).toBeNull();
    expect(result.housingType).toBe('own');

    // Two periods now: the original closed one + the brand-new open one.
    const periods = await db
      .select()
      .from(employmentPeriods)
      .where(eq(employmentPeriods.candidateId, cand.id));
    expect(periods).toHaveLength(2);
    const open = periods.find((p) => p.dismissedAt === null);
    expect(open).toBeDefined();
    expect(open?.employedAt.getTime()).toBe(newStart.getTime());
    expect(open?.projectId).toBe(project.id);
    expect(open?.coordinatorId).toBe(admin.id);
    expect(open?.housingType).toBe('own');
    expect(open?.createdBy).toBe(admin.id);

    // Audit trail: action is 'rehire_candidate' because isFirstHire was false.
    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, cand.id));
    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe('rehire_candidate');
    expect(trail[0]?.actorId).toBe(admin.id);
  });

  it('rolls back candidate update when the new employment_period violates an FK', async () => {
    const admin = await makeUser({ role: 'admin' });
    const originalStart = new Date('2025-01-01T08:00:00.000Z');
    const cand = await makeCandidate({
      recruiterId: admin.id,
      kind: 'client',
      status: 'dismissed',
      workStartDate: originalStart,
      workEndDate: new Date('2025-12-01T17:00:00.000Z'),
      workEndReason: 'voluntary',
    });
    await db.insert(employmentPeriods).values({
      candidateId: cand.id,
      employedAt: originalStart,
      dismissedAt: new Date('2025-12-01T17:00:00.000Z'),
      dismissedReason: 'voluntary',
      housingType: 'our',
      createdBy: admin.id,
    });
    const badProjectId = '00000000-0000-0000-0000-deadbeef9999';

    await expect(
      rehireCandidate(
        cand.id,
        {
          workStartDate: new Date('2026-06-01T08:00:00.000Z').toISOString(),
          housingType: 'our',
          projectId: badProjectId,
        },
        asActor(admin),
        noCtx,
      ),
    ).rejects.toThrow();

    // Candidate must still be dismissed — the tx unwound the status flip.
    const after = await db.select().from(candidates).where(eq(candidates.id, cand.id));
    expect(after[0]?.status).toBe('dismissed');
    expect(after[0]?.workStartDate?.getTime()).toBe(originalStart.getTime());
    expect(after[0]?.workEndDate).not.toBeNull();

    // Only the original closed period must remain; no new period leaked in.
    const periods = await db
      .select()
      .from(employmentPeriods)
      .where(eq(employmentPeriods.candidateId, cand.id));
    expect(periods).toHaveLength(1);
    expect(periods[0]?.dismissedAt).not.toBeNull();

    // Audit happens after the tx — no trail row on failure.
    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, cand.id));
    expect(trail).toHaveLength(0);
  });
});
