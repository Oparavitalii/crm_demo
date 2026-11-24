import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/tasks.repo', () => ({
  list: vi.fn(),
  findById: vi.fn(),
  findByIdEnriched: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../services/candidates.service', () => ({
  getCandidate: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/tasks.repo';
import * as candidatesService from '../services/candidates.service';
import * as audit from '../services/audit.service';
import { ForbiddenError, NotFoundError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const otherRecruiter = { id: 'rec-2', role: 'recruiter' as const };

const candidateId = '11111111-1111-1111-1111-111111111111';
const ctx = { ip: null, userAgent: null };

const baseTask = {
  id: 'task-1',
  candidateId,
  assigneeId: 'rec-1',
  type: 'contact',
  title: 'Call candidate',
  description: null,
  status: 'new',
  dueAt: null,
  doneAt: null,
  createdById: 'rec-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Stub returned by candidatesService.getCandidate when the candidate is
// visible — only .id is consumed downstream.
const visibleCandidate = { id: candidateId } as never;

beforeEach(() => vi.clearAllMocks());

describe('tasks.service.createTask', () => {
  it('passes createdById = actor.id to repo.insert and calls audit.log', async () => {
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(visibleCandidate);
    vi.mocked(repo.insert).mockResolvedValue(baseTask);
    const { createTask } = await import('../services/tasks.service');
    const result = await createTask(
      {
        candidateId,
        assigneeId: 'rec-1',
        type: 'contact',
        title: 'Call candidate',
      },
      recruiterUser,
      ctx,
    );
    expect(result.id).toBe('task-1');
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId,
        assigneeId: 'rec-1',
        type: 'contact',
        title: 'Call candidate',
        createdById: 'rec-1',
        dueAt: null,
      }),
    );
    expect(audit.log).toHaveBeenCalledOnce();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'rec-1',
        action: 'create_task',
        entityType: 'task',
        entityId: 'task-1',
      }),
    );
  });

  it('throws NotFoundError when actor cannot see the candidate (RBAC propagation)', async () => {
    vi.mocked(candidatesService.getCandidate).mockRejectedValue(
      new NotFoundError('candidate'),
    );
    const { createTask } = await import('../services/tasks.service');
    await expect(
      createTask(
        {
          candidateId,
          assigneeId: 'rec-1',
          type: 'contact',
          title: 'Call candidate',
        },
        otherRecruiter,
        ctx,
      ),
    ).rejects.toThrow(NotFoundError);
    expect(repo.insert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('tasks.service.listTasks', () => {
  it('recruiter passes both scopeAssigneeId AND scopeRecruiterId (OR semantics in repo)', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [], total: 0 });
    const { listTasks } = await import('../services/tasks.service');
    await listTasks({ state: 'all', page: 1, pageSize: 20 }, recruiterUser);
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeAssigneeId: 'rec-1',
        scopeRecruiterId: 'rec-1',
      }),
    );
    const callArg = vi.mocked(repo.list).mock.calls[0]?.[0];
    expect(callArg?.scopeCoordinatorId).toBeUndefined();
  });

  it('admin passes no scope params', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [], total: 0 });
    const { listTasks } = await import('../services/tasks.service');
    await listTasks({ state: 'all', page: 1, pageSize: 20 }, adminUser);
    const callArg = vi.mocked(repo.list).mock.calls[0]?.[0];
    expect(callArg?.scopeAssigneeId).toBeUndefined();
    expect(callArg?.scopeRecruiterId).toBeUndefined();
    expect(callArg?.scopeCoordinatorId).toBeUndefined();
  });
});

describe('tasks.service.getTask', () => {
  // Enriched shape (names hydrated by repo.findByIdEnriched). Same id/scope
  // fields as baseTask so assertCanSeeTask branches are exercised correctly.
  const enrichedTask = {
    ...baseTask,
    assigneeFirstName: 'Rec',
    assigneeLastName: 'One',
    candidateFirstName: 'Cand',
    candidateLastName: null,
    createdByFirstName: 'Rec',
    createdByLastName: 'One',
  };

  it('returns enriched task in a SINGLE repo call (no findById + list double round-trip)', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(enrichedTask);
    const { getTask } = await import('../services/tasks.service');
    const result = await getTask('task-1', recruiterUser);
    expect(result).toEqual(enrichedTask);
    expect(repo.findByIdEnriched).toHaveBeenCalledOnce();
    expect(repo.findByIdEnriched).toHaveBeenCalledWith('task-1');
    // Regression guard: the old path was findById → list({candidateId,...}).
    // After the perf fix neither should fire on the happy path.
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('admin can fetch any task without triggering candidate-scope check', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({
      ...enrichedTask,
      assigneeId: 'someone-else',
      createdById: 'someone-else',
    });
    const { getTask } = await import('../services/tasks.service');
    const result = await getTask('task-1', adminUser);
    expect(result.id).toBe('task-1');
    expect(candidatesService.getCandidate).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when task does not exist', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue(undefined);
    const { getTask } = await import('../services/tasks.service');
    await expect(getTask('missing', recruiterUser)).rejects.toThrow(NotFoundError);
  });

  it('non-assignee recruiter must pass candidate-scope check', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({
      ...enrichedTask,
      assigneeId: 'someone-else',
      createdById: 'someone-else',
    });
    vi.mocked(candidatesService.getCandidate).mockRejectedValue(
      new NotFoundError('candidate'),
    );
    const { getTask } = await import('../services/tasks.service');
    await expect(getTask('task-1', otherRecruiter)).rejects.toThrow(NotFoundError);
    expect(candidatesService.getCandidate).toHaveBeenCalledWith(candidateId, otherRecruiter);
  });

  it('standalone task (candidateId=null) is hidden from non-assignee non-creator non-admin', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({
      ...enrichedTask,
      candidateId: null,
      assigneeId: 'someone-else',
      createdById: 'someone-else',
    });
    const { getTask } = await import('../services/tasks.service');
    await expect(getTask('task-1', otherRecruiter)).rejects.toThrow(NotFoundError);
    // Standalone path must NOT defer to candidatesService — there is no candidate.
    expect(candidatesService.getCandidate).not.toHaveBeenCalled();
  });
});

describe('tasks.service.deleteTask', () => {
  it('creator can delete their own task', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseTask, createdById: 'rec-1' });
    vi.mocked(repo.remove).mockResolvedValue(true);
    const { deleteTask } = await import('../services/tasks.service');
    await expect(deleteTask('task-1', recruiterUser, ctx)).resolves.toBeUndefined();
    expect(repo.remove).toHaveBeenCalledWith('task-1');
    expect(audit.log).toHaveBeenCalledOnce();
  });

  it('non-admin non-creator gets ForbiddenError; audit.log NOT called; repo.remove NOT called', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseTask, createdById: 'rec-1' });
    const { deleteTask } = await import('../services/tasks.service');
    await expect(deleteTask('task-1', otherRecruiter, ctx)).rejects.toThrow(
      ForbiddenError,
    );
    expect(repo.remove).not.toHaveBeenCalled();
    // Order matters: forbidden checks must come BEFORE the audit log, otherwise
    // a 403 attempt would leak an audit entry with no real action behind it.
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('tasks.service.updateTask', () => {
  const coordinatorUser = { id: 'coord-1', role: 'coordinator' as const };

  it('admin edits their own task: repo.update called and audit logs old + new diff', async () => {
    // Admin owns + assigned. Title change only.
    const existing = { ...baseTask, assigneeId: 'admin-1', createdById: 'admin-1' };
    const updated = { ...existing, title: 'New title' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    const result = await updateTask('task-1', { title: 'New title' }, adminUser, ctx);
    expect(result).toEqual(updated);
    expect(repo.update).toHaveBeenCalledWith('task-1', { title: 'New title' });
    expect(audit.log).toHaveBeenCalledOnce();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'update_task',
        entityType: 'task',
        entityId: 'task-1',
        oldValue: { title: 'Call candidate' },
        newValue: { title: 'New title' },
      }),
    );
  });

  it('recruiter who is the assignee can update (visibility via assigneeId === self.id)', async () => {
    // recruiterUser is the assignee but NOT the creator and NOT the candidate's recruiter.
    const existing = { ...baseTask, assigneeId: 'rec-1', createdById: 'other-creator' };
    const updated = { ...existing, title: 'Updated' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { title: 'Updated' }, recruiterUser, ctx),
    ).resolves.toEqual(updated);
    // Assignee shortcut MUST short-circuit before any candidate-scope hop.
    expect(candidatesService.getCandidate).not.toHaveBeenCalled();
  });

  it('recruiter who is the creator (but not assignee) can update (visibility via createdById)', async () => {
    const existing = { ...baseTask, assigneeId: 'someone-else', createdById: 'rec-1' };
    const updated = { ...existing, title: 'Edited by creator' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { title: 'Edited by creator' }, recruiterUser, ctx),
    ).resolves.toEqual(updated);
    expect(candidatesService.getCandidate).not.toHaveBeenCalled();
  });

  it('recruiter who is neither assignee nor creator AND candidate not visible: NotFoundError, no update, no audit', async () => {
    // Per assertCanSeeTask, candidate-scope failure surfaces as NotFoundError
    // (candidatesService.getCandidate throws NotFoundError when out of scope).
    // This matches deleteTask's "don't leak existence" posture for non-owners.
    const existing = { ...baseTask, assigneeId: 'someone-else', createdById: 'someone-else' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(candidatesService.getCandidate).mockRejectedValue(
      new NotFoundError('candidate'),
    );
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { title: 'Hack' }, otherRecruiter, ctx),
    ).rejects.toThrow(NotFoundError);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('coordinator on their own candidate can update the task', async () => {
    const existing = {
      ...baseTask,
      assigneeId: 'someone-else',
      createdById: 'someone-else',
    };
    const updated = { ...existing, title: 'Coord edit' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    // candidatesService.getCandidate resolves -> coordinator-scope passes
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(visibleCandidate);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { title: 'Coord edit' }, coordinatorUser, ctx),
    ).resolves.toEqual(updated);
    expect(candidatesService.getCandidate).toHaveBeenCalledWith(candidateId, coordinatorUser);
    expect(audit.log).toHaveBeenCalledOnce();
  });

  it("coordinator on someone else's candidate: NotFoundError, no update, no audit", async () => {
    const existing = {
      ...baseTask,
      assigneeId: 'someone-else',
      createdById: 'someone-else',
    };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(candidatesService.getCandidate).mockRejectedValue(
      new NotFoundError('candidate'),
    );
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { title: 'Coord edit' }, coordinatorUser, ctx),
    ).rejects.toThrow(NotFoundError);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('status new -> in_work: updates status, leaves doneAt null, audit captures diff', async () => {
    const existing = { ...baseTask, status: 'new', doneAt: null };
    const updated = { ...existing, status: 'in_work', doneAt: null };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await updateTask('task-1', { status: 'in_work' }, recruiterUser, ctx);
    // doneAt is forwarded as null whenever status != 'completed' — even when
    // it was already null. Lock that behavior so the SQL UPDATE stays explicit.
    expect(repo.update).toHaveBeenCalledWith('task-1', {
      status: 'in_work',
      doneAt: null,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: { status: 'new' },
        newValue: { status: 'in_work' },
      }),
    );
  });

  it('status -> completed stamps doneAt with new Date when previously null', async () => {
    const existing = { ...baseTask, status: 'in_work', doneAt: null };
    const updated = { ...existing, status: 'completed', doneAt: new Date('2026-06-17T10:00:00Z') };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await updateTask('task-1', { status: 'completed' }, recruiterUser, ctx);
    const call = vi.mocked(repo.update).mock.calls[0]?.[1] as { status: string; doneAt: Date };
    expect(call.status).toBe('completed');
    expect(call.doneAt).toBeInstanceOf(Date);
  });

  it('status completed -> in_work clears doneAt back to null', async () => {
    // 4-state workflow allows un-completing — verify the doneAt sync.
    const previouslyDone = new Date('2026-06-10T08:00:00Z');
    const existing = { ...baseTask, status: 'completed', doneAt: previouslyDone };
    const updated = { ...existing, status: 'in_work', doneAt: null };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await updateTask('task-1', { status: 'in_work' }, recruiterUser, ctx);
    expect(repo.update).toHaveBeenCalledWith('task-1', {
      status: 'in_work',
      doneAt: null,
    });
  });

  it('no-op patch (empty object) returns existing without calling repo.update or audit.log', async () => {
    const existing = { ...baseTask };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    const { updateTask } = await import('../services/tasks.service');
    const result = await updateTask('task-1', {}, recruiterUser, ctx);
    expect(result).toEqual(existing);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('NotFoundError when task id does not exist; no update, no audit', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('missing', { title: 'x' }, adminUser, ctx),
    ).rejects.toThrow(NotFoundError);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('admin reassigns task to another user: assigneeId persisted, audit diff captured', async () => {
    const existing = { ...baseTask, assigneeId: 'rec-1' };
    const updated = { ...existing, assigneeId: 'rec-2' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await updateTask('task-1', { assigneeId: 'rec-2' }, adminUser, ctx);
    expect(repo.update).toHaveBeenCalledWith('task-1', { assigneeId: 'rec-2' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: { assigneeId: 'rec-1' },
        newValue: { assigneeId: 'rec-2' },
      }),
    );
  });

  // updateTask mirrors createTask's "non-admin must pick self as assignee" rule.
  // A recruiter who owns the task cannot pass it to another user without admin role.
  it('non-admin cannot reassign their own task to another user (FORBIDDEN / assignee_not_self)', async () => {
    const existing = { ...baseTask, assigneeId: 'rec-1', createdById: 'rec-1' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { assigneeId: 'rec-2' }, recruiterUser, ctx),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('non-admin reassigning to self is allowed (no-op assigneeId change)', async () => {
    const existing = { ...baseTask, assigneeId: 'rec-1', createdById: 'rec-1' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(existing);
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { assigneeId: 'rec-1', title: 'updated' }, recruiterUser, ctx),
    ).resolves.toEqual(existing);
  });

  it('admin can reassign any task to any user', async () => {
    const existing = { ...baseTask, assigneeId: 'rec-1', createdById: 'rec-1' };
    const updated = { ...existing, assigneeId: 'rec-2' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { assigneeId: 'rec-2' }, adminUser, ctx),
    ).resolves.toEqual(updated);
    expect(repo.update).toHaveBeenCalledWith('task-1', { assigneeId: 'rec-2' });
  });

  it('audit.log is NOT written when permission is denied (assertCanSeeTask fails before update)', async () => {
    const existing = { ...baseTask, assigneeId: 'someone-else', createdById: 'someone-else' };
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(candidatesService.getCandidate).mockRejectedValue(
      new NotFoundError('candidate'),
    );
    const { updateTask } = await import('../services/tasks.service');
    await expect(
      updateTask('task-1', { title: 'x', status: 'completed' }, otherRecruiter, ctx),
    ).rejects.toThrow(NotFoundError);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

// Schema-layer validation lives in @crm/shared (Zod). The service trusts
// the zValidator middleware to have run, so these guards are tested via the
// schema directly rather than through updateTask.
describe('updateTaskSchema (Zod validation)', () => {
  it('rejects empty title (min(1) after trim)', async () => {
    const { updateTaskSchema } = await import('@crm/shared');
    const result = updateTaskSchema.safeParse({ title: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid ISO dueAt', async () => {
    const { updateTaskSchema } = await import('@crm/shared');
    const result = updateTaskSchema.safeParse({ dueAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('accepts valid status transition and ISO dueAt', async () => {
    const { updateTaskSchema } = await import('@crm/shared');
    const result = updateTaskSchema.safeParse({
      status: 'completed',
      dueAt: '2026-07-01T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});
