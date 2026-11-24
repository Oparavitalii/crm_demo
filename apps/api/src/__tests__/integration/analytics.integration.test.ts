import { describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { employmentPeriods } from '../../db/tables/employment-periods';
import * as analyticsRepo from '../../repositories/analytics.repo';
import * as analyticsService from '../../services/analytics.service';
import { asActor, makeCandidate, makeDismissal, makeUser } from './fixtures';

// Real-Postgres integration tests for getUserProfileStats. Mirrors the style
// of dismissals.integration.test.ts. Unit tests mock the SQL layer; this file
// verifies aggregations against actual rows, locking the role-based scoping
// (recruiter scope = recruiterId, coordinator scope = coordinatorId).

describe('analytics.service.getUserProfileStats — recruiter funnel (integration)', () => {
  it('funnel counts only candidates assigned to the recruiter', async () => {
    const admin = await makeUser({ role: 'admin' });
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });

    // A owns: 2 new, 1 employed, 1 dismissed (4 total)
    await makeCandidate({ recruiterId: recA.id, status: 'new' });
    await makeCandidate({ recruiterId: recA.id, status: 'new' });
    await makeCandidate({
      recruiterId: recA.id,
      status: 'employed',
      kind: 'client',
    });
    await makeCandidate({
      recruiterId: recA.id,
      status: 'dismissed',
      kind: 'client',
    });
    // B owns: 1 new — must NOT leak into A's funnel
    await makeCandidate({ recruiterId: recB.id, status: 'new' });
    // Unassigned candidate — invisible to per-user stats
    await makeCandidate({ status: 'new' });

    const stats = await analyticsService.getUserProfileStats(
      recA.id,
      asActor(admin),
    );

    expect(stats.user.role).toBe('recruiter');
    expect(stats.funnel.new).toBe(2);
    expect(stats.funnel.employed).toBe(1);
    expect(stats.funnel.dismissed).toBe(1);
    expect(stats.funnel.total).toBe(4);
    // Recruiter shape — sourceBreakdown defined, housingUtilization omitted.
    expect(stats.sourceBreakdown).toBeDefined();
    expect(stats.housingUtilization).toBeUndefined();
  });

  it('retention = currentlyEmployed / totalEverEmployed', async () => {
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });

    // 3 ever-clients, 2 currently employed, 1 currently dismissed
    await makeCandidate({
      recruiterId: rec.id,
      status: 'employed',
      kind: 'client',
    });
    await makeCandidate({
      recruiterId: rec.id,
      status: 're_employed',
      kind: 'client',
    });
    await makeCandidate({
      recruiterId: rec.id,
      status: 'dismissed',
      kind: 'client',
    });
    // A non-client candidate should NOT count in retention denominator
    await makeCandidate({ recruiterId: rec.id, status: 'new' });

    const stats = await analyticsService.getUserProfileStats(
      rec.id,
      asActor(admin),
    );
    expect(stats.retention.totalEverEmployed).toBe(3);
    expect(stats.retention.currentlyEmployed).toBe(2);
    expect(stats.retention.rate).toBeCloseTo(2 / 3, 5);
  });

  it('avgTimeToHireDays computes mean across employment_periods', async () => {
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });

    // Candidate created 10 days before being employed
    const createdA = new Date('2026-05-01T00:00:00Z');
    const employedA = new Date('2026-05-11T00:00:00Z');
    const candA = await makeCandidate({
      recruiterId: rec.id,
      status: 'employed',
      kind: 'client',
      createdAt: createdA,
    });
    await db.insert(employmentPeriods).values({
      candidateId: candA.id,
      employedAt: employedA,
    });

    // Candidate created 30 days before being employed
    const createdB = new Date('2026-05-01T00:00:00Z');
    const employedB = new Date('2026-05-31T00:00:00Z');
    const candB = await makeCandidate({
      recruiterId: rec.id,
      status: 'employed',
      kind: 'client',
      createdAt: createdB,
    });
    await db.insert(employmentPeriods).values({
      candidateId: candB.id,
      employedAt: employedB,
    });

    const stats = await analyticsService.getUserProfileStats(
      rec.id,
      asActor(admin),
    );
    // (10 + 30) / 2 = 20.0
    expect(stats.avgTimeToHireDays).toBe(20);
  });

  it('dismissal reasons grouped by reasonCode, scoped to recruiter candidates', async () => {
    const admin = await makeUser({ role: 'admin' });
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });

    const candA1 = await makeCandidate({ recruiterId: recA.id });
    const candA2 = await makeCandidate({ recruiterId: recA.id });
    const candB = await makeCandidate({ recruiterId: recB.id });

    await makeDismissal({
      candidateId: candA1.id,
      reasonCode: 'employee_resigned',
      reason: 'free text 1',
    });
    await makeDismissal({
      candidateId: candA2.id,
      reasonCode: 'employee_resigned',
      reason: 'free text 2',
    });
    await makeDismissal({
      candidateId: candB.id,
      reasonCode: 'employer_terminated',
      reason: 'free text 3',
    });

    const stats = await analyticsService.getUserProfileStats(
      recA.id,
      asActor(admin),
    );
    expect(stats.dismissalReasons.employee_resigned).toBe(2);
    expect(stats.dismissalReasons.employer_terminated).toBeUndefined();
  });
});

describe('analytics.service.getUserProfileStats — coordinator housing (integration)', () => {
  it('housingUtilization = currentlyEmployed / totalHoused', async () => {
    const admin = await makeUser({ role: 'admin' });
    const coord = await makeUser({ role: 'coordinator' });

    // Coordinator has 4 candidates: 2 employed, 1 re_employed, 1 dismissed
    await makeCandidate({
      coordinatorId: coord.id,
      status: 'employed',
      housingType: 'our',
    });
    await makeCandidate({
      coordinatorId: coord.id,
      status: 'employed',
      housingType: 'our',
    });
    await makeCandidate({
      coordinatorId: coord.id,
      status: 're_employed',
      housingType: 'own',
    });
    await makeCandidate({
      coordinatorId: coord.id,
      status: 'dismissed',
      housingType: 'our',
    });

    const stats = await analyticsService.getUserProfileStats(
      coord.id,
      asActor(admin),
    );
    expect(stats.user.role).toBe('coordinator');
    expect(stats.housingUtilization).toBeDefined();
    expect(stats.housingUtilization?.totalHoused).toBe(4);
    expect(stats.housingUtilization?.currentlyEmployed).toBe(3);
    expect(stats.housingUtilization?.rate).toBeCloseTo(3 / 4, 5);
    // Coordinator shape — sourceBreakdown omitted.
    expect(stats.sourceBreakdown).toBeUndefined();
  });

  it('coordinator funnel scoped to coordinatorId, not recruiterId', async () => {
    const admin = await makeUser({ role: 'admin' });
    const coord = await makeUser({ role: 'coordinator' });
    const rec = await makeUser({ role: 'recruiter' });

    // 1 candidate assigned to BOTH (counts for both, but we test coordinator scope)
    await makeCandidate({
      coordinatorId: coord.id,
      recruiterId: rec.id,
      status: 'employed',
    });
    // 1 candidate assigned ONLY to recruiter — must NOT show in coordinator funnel
    await makeCandidate({ recruiterId: rec.id, status: 'new' });

    const stats = await analyticsService.getUserProfileStats(
      coord.id,
      asActor(admin),
    );
    expect(stats.funnel.employed).toBe(1);
    expect(stats.funnel.new).toBe(0);
    expect(stats.funnel.total).toBe(1);
  });
});

describe('analytics.repo.coordinatorKpi (integration)', () => {
  it('aggregates housing utilization and avgTenureDays from employment_periods', async () => {
    const coord = await makeUser({ role: 'coordinator', isActive: true });

    // Two candidates with OPEN employment periods (still housed) and one with
    // a CLOSED period (dismissed → not currently housed). Total coordinated = 3.
    const candA = await makeCandidate({ coordinatorId: coord.id });
    const candB = await makeCandidate({ coordinatorId: coord.id });
    const candC = await makeCandidate({ coordinatorId: coord.id });

    // Open period — 10 day tenure (against now() — approximate, we assert range).
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    await db.insert(employmentPeriods).values({
      candidateId: candA.id,
      employedAt: tenDaysAgo,
    });
    // Open period — 20 day tenure.
    const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000);
    await db.insert(employmentPeriods).values({
      candidateId: candB.id,
      employedAt: twentyDaysAgo,
    });
    // Closed period — 30 day tenure (employedAt=40 days ago, dismissedAt=10 days ago).
    await db.insert(employmentPeriods).values({
      candidateId: candC.id,
      employedAt: new Date(Date.now() - 40 * 86_400_000),
      dismissedAt: new Date(Date.now() - 10 * 86_400_000),
    });

    const rows = await analyticsRepo.coordinatorKpi();
    const row = rows.find((r) => r.userId === coord.id);
    expect(row).toBeDefined();
    expect(row!.candidatesCoordinated).toBe(3);
    expect(row!.currentlyHoused).toBe(2);
    expect(row!.housingUtilizationPercent).toBeCloseTo(2 / 3, 5);
    // avg tenure across the three periods ≈ (10 + 20 + 30) / 3 = 20 days.
    expect(row!.avgTenureDays).not.toBeNull();
    expect(row!.avgTenureDays!).toBeGreaterThan(19);
    expect(row!.avgTenureDays!).toBeLessThan(21);
    expect(row!.isFreelancer).toBe(false);
  });

  it('coordinator with zero candidates returns 0 utilization (div-zero guard, no NaN)', async () => {
    const coord = await makeUser({ role: 'coordinator', isActive: true });

    const rows = await analyticsRepo.coordinatorKpi();
    const row = rows.find((r) => r.userId === coord.id);
    expect(row).toBeDefined();
    expect(row!.candidatesCoordinated).toBe(0);
    expect(row!.currentlyHoused).toBe(0);
    expect(row!.housingUtilizationPercent).toBe(0);
    expect(Number.isNaN(row!.housingUtilizationPercent)).toBe(false);
    expect(row!.avgTenureDays).toBeNull();
  });

  it('excludes inactive coordinators', async () => {
    const inactive = await makeUser({ role: 'coordinator', isActive: false });

    const rows = await analyticsRepo.coordinatorKpi();
    expect(rows.find((r) => r.userId === inactive.id)).toBeUndefined();
  });

  it('dismissalsThisMonth counts only dismissals on this coordinator candidates this month', async () => {
    const coord = await makeUser({ role: 'coordinator', isActive: true });
    const otherCoord = await makeUser({ role: 'coordinator', isActive: true });

    const candMine = await makeCandidate({ coordinatorId: coord.id });
    const candOther = await makeCandidate({ coordinatorId: otherCoord.id });

    await makeDismissal({ candidateId: candMine.id, dismissedAt: new Date() });
    await makeDismissal({ candidateId: candOther.id, dismissedAt: new Date() });

    const rows = await analyticsRepo.coordinatorKpi();
    const row = rows.find((r) => r.userId === coord.id);
    expect(row!.dismissalsThisMonth).toBe(1);
  });
});

describe('analytics.service.getUserProfileStats — authorization (integration)', () => {
  it('recruiter A fetching recruiter B stats throws FORBIDDEN', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    await expect(
      analyticsService.getUserProfileStats(recB.id, asActor(recA)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('recruiter fetching themselves succeeds', async () => {
    const rec = await makeUser({ role: 'recruiter' });
    const stats = await analyticsService.getUserProfileStats(
      rec.id,
      asActor(rec),
    );
    expect(stats.user.id).toBe(rec.id);
  });

  it('admin-role target throws VALIDATION', async () => {
    const admin = await makeUser({ role: 'admin' });
    const adminTarget = await makeUser({ role: 'admin' });
    await expect(
      analyticsService.getUserProfileStats(adminTarget.id, asActor(admin)),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
