import { describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { tasks } from '../../db/tables/tasks';
import { candidates } from '../../db/tables/candidates';
import { users } from '../../db/tables/users';
import * as tasksService from '../../services/tasks.service';
import type { ListTasksQuery } from '@crm/shared';
import { asActor, makeCandidate, makeTask, makeUser } from './fixtures';

// Real-Postgres integration tests for tasks.service. The unit suite mocks
// the chainable db, which hides wrong-join / dropped-WHERE / OR-clause bugs.
// This file exercises listTasks + delete-cascade against the actual schema.

// Tiny helper — every list call needs the pagination defaults + a `state`.
// Spelling out the full shape on every call buries the assertion under noise.
function q(overrides: Partial<ListTasksQuery> = {}): ListTasksQuery {
  return {
    page: 1,
    pageSize: 20,
    state: 'all',
    ...overrides,
  } as ListTasksQuery;
}

describe('tasks.service.listTasks — filter combinations (integration)', () => {
  it('filters by {status} returns only rows matching the literal status', async () => {
    const admin = await makeUser({ role: 'admin' });
    const tNew = await makeTask({
      title: 'new-task',
      status: 'new',
      assigneeId: admin.id,
      createdById: admin.id,
    });
    await makeTask({
      title: 'in-work-task',
      status: 'in_work',
      assigneeId: admin.id,
      createdById: admin.id,
    });
    await makeTask({
      title: 'completed-task',
      status: 'completed',
      doneAt: new Date(),
      assigneeId: admin.id,
      createdById: admin.id,
    });

    const result = await tasksService.listTasks(
      q({ status: 'new' }),
      asActor(admin),
    );

    expect(result.total).toBe(1);
    expect(result.items.map((t) => t.id)).toEqual([tNew.id]);
  });

  it('filters by {status, assigneeId} AND-combines correctly', async () => {
    const admin = await makeUser({ role: 'admin' });
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });

    const want = await makeTask({
      status: 'in_work',
      assigneeId: recA.id,
      createdById: admin.id,
    });
    // Same status, different assignee — must be excluded.
    await makeTask({
      status: 'in_work',
      assigneeId: recB.id,
      createdById: admin.id,
    });
    // Same assignee, different status — must be excluded.
    await makeTask({
      status: 'new',
      assigneeId: recA.id,
      createdById: admin.id,
    });

    const result = await tasksService.listTasks(
      q({ status: 'in_work', assigneeId: recA.id }),
      asActor(admin),
    );

    expect(result.total).toBe(1);
    expect(result.items.map((t) => t.id)).toEqual([want.id]);
  });

  it('filters by {candidateId, state: open} excludes completed tasks on same candidate', async () => {
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });

    const openTask = await makeTask({
      candidateId: cand.id,
      assigneeId: admin.id,
      createdById: admin.id,
      status: 'new',
    });
    // Same candidate, but doneAt IS NOT NULL → state='open' must drop it.
    await makeTask({
      candidateId: cand.id,
      assigneeId: admin.id,
      createdById: admin.id,
      status: 'completed',
      doneAt: new Date(),
    });
    // Different candidate altogether — must be excluded by candidateId filter.
    const otherCand = await makeCandidate({ recruiterId: admin.id });
    await makeTask({
      candidateId: otherCand.id,
      assigneeId: admin.id,
      createdById: admin.id,
      status: 'new',
    });

    const result = await tasksService.listTasks(
      q({ candidateId: cand.id, state: 'open' }),
      asActor(admin),
    );

    expect(result.total).toBe(1);
    expect(result.items.map((t) => t.id)).toEqual([openTask.id]);
  });

  it('state=done returns only tasks with doneAt IS NOT NULL', async () => {
    const admin = await makeUser({ role: 'admin' });
    const done = await makeTask({
      assigneeId: admin.id,
      createdById: admin.id,
      status: 'completed',
      doneAt: new Date('2026-06-01T10:00:00Z'),
    });
    await makeTask({
      assigneeId: admin.id,
      createdById: admin.id,
      status: 'new',
    });

    const result = await tasksService.listTasks(
      q({ state: 'done' }),
      asActor(admin),
    );

    expect(result.total).toBe(1);
    expect(result.items.map((t) => t.id)).toEqual([done.id]);
  });
});

describe('tasks.service.listTasks — recruiter scope at the SQL layer (integration)', () => {
  it('recruiter sees own assigned tasks AND tasks on their candidates, never others', async () => {
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const admin = await makeUser({ role: 'admin' });

    const candA = await makeCandidate({ recruiterId: recA.id });
    const candB = await makeCandidate({ recruiterId: recB.id });

    // recA-assigned standalone (no candidate) — visible via scopeAssigneeId.
    const ownAssigned = await makeTask({
      assigneeId: recA.id,
      createdById: admin.id,
    });
    // Task on candA assigned to recB — visible via scopeRecruiterId.
    const ownCandidate = await makeTask({
      candidateId: candA.id,
      assigneeId: recB.id,
      createdById: admin.id,
    });
    // recB-assigned, standalone — must NOT be visible to recA.
    const otherAssigned = await makeTask({
      assigneeId: recB.id,
      createdById: admin.id,
    });
    // Task on candB (recB's candidate) assigned to admin — must NOT leak.
    const otherCandidate = await makeTask({
      candidateId: candB.id,
      assigneeId: admin.id,
      createdById: admin.id,
    });

    const result = await tasksService.listTasks(q(), asActor(recA));

    const ids = result.items.map((t) => t.id).sort();
    expect(ids).toEqual([ownAssigned.id, ownCandidate.id].sort());
    expect(ids).not.toContain(otherAssigned.id);
    expect(ids).not.toContain(otherCandidate.id);
    expect(result.total).toBe(2);
  });

  it('admin sees all tasks regardless of assignee or candidate ownership', async () => {
    const admin = await makeUser({ role: 'admin' });
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const candA = await makeCandidate({ recruiterId: recA.id });
    const candB = await makeCandidate({ recruiterId: recB.id });

    const t1 = await makeTask({ assigneeId: recA.id, createdById: recA.id });
    const t2 = await makeTask({
      candidateId: candA.id,
      assigneeId: recA.id,
      createdById: recA.id,
    });
    const t3 = await makeTask({
      candidateId: candB.id,
      assigneeId: recB.id,
      createdById: recB.id,
    });

    const result = await tasksService.listTasks(q(), asActor(admin));
    const ids = result.items.map((t) => t.id).sort();
    expect(ids).toEqual([t1.id, t2.id, t3.id].sort());
    expect(result.total).toBe(3);
  });

  it('coordinator sees own assigned + tasks on candidates where coordinatorId = me', async () => {
    const coord = await makeUser({ role: 'coordinator' });
    const otherCoord = await makeUser({ role: 'coordinator' });
    const admin = await makeUser({ role: 'admin' });

    const myClient = await makeCandidate({
      recruiterId: admin.id,
      coordinatorId: coord.id,
      kind: 'client',
    });
    const otherClient = await makeCandidate({
      recruiterId: admin.id,
      coordinatorId: otherCoord.id,
      kind: 'client',
    });

    const ownAssigned = await makeTask({
      assigneeId: coord.id,
      createdById: admin.id,
    });
    const ownClientTask = await makeTask({
      candidateId: myClient.id,
      assigneeId: admin.id,
      createdById: admin.id,
    });
    const otherClientTask = await makeTask({
      candidateId: otherClient.id,
      assigneeId: admin.id,
      createdById: admin.id,
    });

    const result = await tasksService.listTasks(q(), asActor(coord));
    const ids = result.items.map((t) => t.id).sort();
    expect(ids).toEqual([ownAssigned.id, ownClientTask.id].sort());
    expect(ids).not.toContain(otherClientTask.id);
  });

  it('readonly sees all (no scope clauses) — mirrors admin', async () => {
    const ro = await makeUser({ role: 'readonly' });
    const recA = await makeUser({ role: 'recruiter' });
    const recB = await makeUser({ role: 'recruiter' });
    const t1 = await makeTask({ assigneeId: recA.id, createdById: recA.id });
    const t2 = await makeTask({ assigneeId: recB.id, createdById: recB.id });

    const result = await tasksService.listTasks(q(), asActor(ro));
    const ids = result.items.map((t) => t.id).sort();
    expect(ids).toEqual([t1.id, t2.id].sort());
  });
});

describe('tasks.service.listTasks — pagination edges (integration)', () => {
  it('pageSize hits exactly: page=1 returns first N, page=2 returns the rest', async () => {
    const admin = await makeUser({ role: 'admin' });
    // 5 tasks, all open with NULL dueAt — order falls back to createdAt DESC.
    const created = [] as { id: string }[];
    for (let i = 0; i < 5; i += 1) {
      // Sequential await so createdAt strictly increases (test stability).
      const t = await makeTask({
        title: `paged-${i}`,
        assigneeId: admin.id,
        createdById: admin.id,
      });
      created.push(t);
    }
    // Newest first by the orderBy contract.
    const expectedDesc = [...created].reverse().map((t) => t.id);

    const page1 = await tasksService.listTasks(
      q({ page: 1, pageSize: 2 }),
      asActor(admin),
    );
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page1.items.map((t) => t.id)).toEqual(expectedDesc.slice(0, 2));

    const page2 = await tasksService.listTasks(
      q({ page: 2, pageSize: 2 }),
      asActor(admin),
    );
    expect(page2.items).toHaveLength(2);
    expect(page2.items.map((t) => t.id)).toEqual(expectedDesc.slice(2, 4));

    const page3 = await tasksService.listTasks(
      q({ page: 3, pageSize: 2 }),
      asActor(admin),
    );
    expect(page3.items).toHaveLength(1);
    expect(page3.items.map((t) => t.id)).toEqual(expectedDesc.slice(4, 5));
  });

  it('offset past the last row returns empty items but total is still correct', async () => {
    const admin = await makeUser({ role: 'admin' });
    await makeTask({ assigneeId: admin.id, createdById: admin.id });
    await makeTask({ assigneeId: admin.id, createdById: admin.id });

    const result = await tasksService.listTasks(
      q({ page: 99, pageSize: 20 }),
      asActor(admin),
    );
    expect(result.items).toEqual([]);
    expect(result.total).toBe(2);
    expect(result.page).toBe(99);
  });
});

describe('tasks.service.listTasks — sort order (integration)', () => {
  it('open tasks rank above done; within open, earliest dueAt first; NULL dueAt sinks to bottom', async () => {
    const admin = await makeUser({ role: 'admin' });

    // Done task — should land at the BOTTOM regardless of dueAt.
    const done = await makeTask({
      title: 'done',
      status: 'completed',
      doneAt: new Date('2026-06-01T10:00:00Z'),
      dueAt: new Date('2026-05-01T00:00:00Z'),
      assigneeId: admin.id,
      createdById: admin.id,
    });
    // Open with NULL dueAt — sinks to bottom of the open group.
    const openNullDue = await makeTask({
      title: 'open-null-due',
      assigneeId: admin.id,
      createdById: admin.id,
    });
    // Open with the latest dueAt.
    const openLate = await makeTask({
      title: 'open-late',
      dueAt: new Date('2026-07-01T00:00:00Z'),
      assigneeId: admin.id,
      createdById: admin.id,
    });
    // Open with the earliest dueAt — should be first.
    const openEarly = await makeTask({
      title: 'open-early',
      dueAt: new Date('2026-06-15T00:00:00Z'),
      assigneeId: admin.id,
      createdById: admin.id,
    });

    const result = await tasksService.listTasks(q(), asActor(admin));
    expect(result.items.map((t) => t.id)).toEqual([
      openEarly.id,
      openLate.id,
      openNullDue.id,
      done.id,
    ]);
  });
});

describe('tasks.service.listTasks — overdueOnly / dueTodayOnly (integration)', () => {
  it('overdueOnly returns open tasks whose dueAt is strictly in the past', async () => {
    const admin = await makeUser({ role: 'admin' });
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const overdue = await makeTask({
      title: 'overdue',
      dueAt: past,
      assigneeId: admin.id,
      createdById: admin.id,
    });
    // Past-due but ALREADY DONE — must NOT appear: filter ANDs doneAt IS NULL.
    await makeTask({
      title: 'overdue-but-done',
      dueAt: past,
      status: 'completed',
      doneAt: new Date(),
      assigneeId: admin.id,
      createdById: admin.id,
    });
    // Open but future-due — must NOT appear.
    await makeTask({
      title: 'future',
      dueAt: future,
      assigneeId: admin.id,
      createdById: admin.id,
    });

    const result = await tasksService.listTasks(
      q({ overdueOnly: true }),
      asActor(admin),
    );

    expect(result.total).toBe(1);
    expect(result.items.map((t) => t.id)).toEqual([overdue.id]);
  });

  it('dueTodayOnly returns open tasks due before end-of-today UTC', async () => {
    const admin = await makeUser({ role: 'admin' });
    const now = new Date();
    const todayMorningUtc = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        6,
        0,
        0,
      ),
    );
    const tomorrowUtc = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        12,
        0,
        0,
      ),
    );

    const dueToday = await makeTask({
      title: 'today',
      dueAt: todayMorningUtc,
      assigneeId: admin.id,
      createdById: admin.id,
    });
    const dueTomorrow = await makeTask({
      title: 'tomorrow',
      dueAt: tomorrowUtc,
      assigneeId: admin.id,
      createdById: admin.id,
    });

    const result = await tasksService.listTasks(
      q({ dueTodayOnly: true }),
      asActor(admin),
    );

    const ids = result.items.map((t) => t.id);
    expect(ids).toContain(dueToday.id);
    // Anything past end-of-today UTC must NOT appear.
    expect(ids).not.toContain(dueTomorrow.id);
  });
});

describe('tasks deletion cascade (FK onDelete: cascade) — integration', () => {
  it('deleting a candidate removes all per-candidate tasks (Postgres CASCADE)', async () => {
    const admin = await makeUser({ role: 'admin' });
    const cand = await makeCandidate({ recruiterId: admin.id });

    const t1 = await makeTask({
      candidateId: cand.id,
      assigneeId: admin.id,
      createdById: admin.id,
    });
    const t2 = await makeTask({
      candidateId: cand.id,
      assigneeId: admin.id,
      createdById: admin.id,
    });
    // Standalone task on a different (or no) candidate — must SURVIVE.
    const standalone = await makeTask({
      assigneeId: admin.id,
      createdById: admin.id,
    });

    await db.delete(candidates).where(eq(candidates.id, cand.id));

    const survivors = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.id, [t1.id, t2.id, standalone.id]));
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.id).toBe(standalone.id);
  });

  it('deactivating an assignee user sets assigneeId NULL (onDelete: set null) — task survives', async () => {
    const admin = await makeUser({ role: 'admin' });
    const rec = await makeUser({ role: 'recruiter' });
    const task = await makeTask({
      assigneeId: rec.id,
      createdById: admin.id,
    });

    // Hard delete to trigger the FK rule (the production path is anonymization,
    // but the table-level rule is the same: assignee_id ON DELETE SET NULL).
    await db.delete(users).where(eq(users.id, rec.id));

    const row = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row).toHaveLength(1);
    expect(row[0]?.assigneeId).toBeNull();
  });
});
