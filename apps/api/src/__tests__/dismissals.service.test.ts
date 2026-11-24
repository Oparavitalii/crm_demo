import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/dismissals.repo', () => ({
  list: vi.fn(),
  findById: vi.fn(),
  listByCandidate: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../repositories/candidates.repo', () => ({
  update: vi.fn(),
  findById: vi.fn(),
}));
vi.mock('../repositories/employment-periods.repo', () => ({
  closeOpen: vi.fn(),
  adjustClosedDismissal: vi.fn(),
}));
vi.mock('../services/candidates.service', () => ({
  getCandidate: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/dismissals.repo';
import * as candidatesRepo from '../repositories/candidates.repo';
import * as periodsRepo from '../repositories/employment-periods.repo';
import * as candidatesService from '../services/candidates.service';
import { NotFoundError, ForbiddenError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const coordinatorUser = { id: 'coord-1', role: 'coordinator' as const };

const baseDismissal = {
  id: 'dis-1',
  candidateId: 'cand-1',
  dismissedAt: new Date('2024-03-01'),
  reason: 'Voluntary resignation',
  reasonCode: null,
  recordedById: 'admin-1',
  notes: null,
  createdAt: new Date(),
};
const baseCandidate = {
  id: 'cand-1',
  name: 'Anna Kowalska',
  email: 'anna@example.com',
  recruiterId: 'rec-1',
};
const ctx = { ip: null, userAgent: null };

beforeEach(() => vi.clearAllMocks());

describe('dismissals.service.createDismissal', () => {
  it('records dismissal and sets recordedById to actor.id', async () => {
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(baseCandidate as never);
    vi.mocked(repo.insert).mockResolvedValue(baseDismissal);
    const { createDismissal } = await import('../services/dismissals.service');
    const result = await createDismissal(
      { candidateId: 'cand-1', dismissedAt: '2024-03-01T00:00:00.000Z', reason: 'Test' },
      adminUser,
      ctx,
    );
    expect(result.id).toBe('dis-1');
    const callArg = vi.mocked(repo.insert).mock.calls[0]?.[0];
    expect(callArg?.recordedById).toBe('admin-1');
  });

  it('throws NOT_FOUND when recruiter cannot access candidate', async () => {
    vi.mocked(candidatesService.getCandidate).mockRejectedValue(new NotFoundError('candidate'));
    const { createDismissal } = await import('../services/dismissals.service');
    await expect(
      createDismissal(
        { candidateId: 'cand-99', dismissedAt: '2024-03-01T00:00:00.000Z', reason: 'Test' },
        recruiterUser,
        ctx,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('coordinator can create dismissal', async () => {
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(baseCandidate as never);
    vi.mocked(repo.insert).mockResolvedValue({ ...baseDismissal, recordedById: 'coord-1' });
    const { createDismissal } = await import('../services/dismissals.service');
    const result = await createDismissal(
      { candidateId: 'cand-1', dismissedAt: '2024-03-01T00:00:00.000Z', reason: 'End of contract' },
      coordinatorUser,
      ctx,
    );
    expect(result.id).toBe('dis-1');
  });

  it('syncs candidate lifecycle (status, dates, housing) on dismissal create', async () => {
    // housing is cleared on dismissal sync (client left our facilities).
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(baseCandidate as never);
    vi.mocked(repo.insert).mockResolvedValue({ ...baseDismissal, reasonCode: 'absenteeism' });
    vi.mocked(candidatesRepo.update).mockResolvedValue({ ...baseCandidate, status: 'dismissed' } as never);

    const { createDismissal } = await import('../services/dismissals.service');
    await createDismissal(
      {
        candidateId: 'cand-1',
        dismissedAt: '2024-03-01T00:00:00.000Z',
        reason: 'absenteeism',
        reasonCode: 'absenteeism',
      },
      adminUser,
      ctx,
    );

    expect(periodsRepo.closeOpen).toHaveBeenCalledWith(
      'cand-1',
      expect.any(Date),
      'absenteeism',
    );
    const updatePatch = vi.mocked(candidatesRepo.update).mock.calls[0]?.[1];
    expect(updatePatch).toMatchObject({
      status: 'dismissed',
      housingType: null,
      workEndReason: 'absenteeism',
    });
  });
});

describe('dismissals.service.updateDismissal', () => {
  it('admin can update dismissal', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDismissal);
    const updated = { ...baseDismissal, reason: 'Contract expired' };
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateDismissal } = await import('../services/dismissals.service');
    const result = await updateDismissal('dis-1', { reason: 'Contract expired' }, adminUser, ctx);
    expect(result.reason).toBe('Contract expired');
  });

  it('coordinator can update dismissal (I-5: coordinator has full CRUD per spec)', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDismissal);
    const updated = { ...baseDismissal, reason: 'Coordinator updated' };
    vi.mocked(repo.update).mockResolvedValue(updated);
    const { updateDismissal } = await import('../services/dismissals.service');
    const result = await updateDismissal('dis-1', { reason: 'Coordinator updated' }, coordinatorUser, ctx);
    expect(result.reason).toBe('Coordinator updated');
  });

  it('throws NOT_FOUND when dismissal does not exist', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { updateDismissal } = await import('../services/dismissals.service');
    await expect(
      updateDismissal('dis-99', { reason: 'Test' }, adminUser, ctx),
    ).rejects.toThrow(NotFoundError);
  });

  it('correcting the exit date syncs candidate.workEndDate + employment period', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDismissal); // dismissedAt 2024-03-01
    const corrected = { ...baseDismissal, dismissedAt: new Date('2024-03-15') };
    vi.mocked(repo.update).mockResolvedValue(corrected);
    // Candidate is currently dismissed and its denormalized exit date matches
    // this dismissal → it's the operative one, so the edit must propagate.
    vi.mocked(candidatesRepo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'dismissed',
      workEndDate: new Date('2024-03-01'),
    } as never);

    const { updateDismissal } = await import('../services/dismissals.service');
    await updateDismissal('dis-1', { dismissedAt: '2024-03-15T00:00:00.000Z' }, adminUser, ctx);

    const patch = vi.mocked(candidatesRepo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect((patch.workEndDate as Date).getTime()).toBe(new Date('2024-03-15').getTime());
    expect(periodsRepo.adjustClosedDismissal).toHaveBeenCalledWith(
      'cand-1',
      new Date('2024-03-01'),
      new Date('2024-03-15'),
      'Voluntary resignation',
    );
  });

  it('does NOT touch the candidate when editing a non-operative (historical) dismissal', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDismissal); // dismissedAt 2024-03-01
    vi.mocked(repo.update).mockResolvedValue({ ...baseDismissal, dismissedAt: new Date('2024-03-15') });
    // Candidate was re-hired since: currently employed, so this old dismissal is
    // not the operative exit date and must be left alone.
    vi.mocked(candidatesRepo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 're_employed',
      workEndDate: null,
    } as never);

    const { updateDismissal } = await import('../services/dismissals.service');
    await updateDismissal('dis-1', { dismissedAt: '2024-03-15T00:00:00.000Z' }, adminUser, ctx);

    expect(candidatesRepo.update).not.toHaveBeenCalled();
    expect(periodsRepo.adjustClosedDismissal).not.toHaveBeenCalled();
  });
});

describe('dismissals.service.deleteDismissal', () => {
  it('admin can delete dismissal', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDismissal);
    vi.mocked(repo.remove).mockResolvedValue(true);
    const { deleteDismissal } = await import('../services/dismissals.service');
    await expect(deleteDismissal('dis-1', adminUser, ctx)).resolves.toBeUndefined();
  });

  it('recruiter cannot delete dismissal', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDismissal);
    const { deleteDismissal } = await import('../services/dismissals.service');
    await expect(deleteDismissal('dis-1', recruiterUser, ctx)).rejects.toThrow(ForbiddenError);
  });
});

describe('dismissals.service.listDismissals', () => {
  it('recruiter with no candidateId returns empty', async () => {
    const { listDismissals } = await import('../services/dismissals.service');
    const result = await listDismissals({ page: 1, pageSize: 20 }, recruiterUser);
    expect(result.items).toEqual([]);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('admin sees all dismissals', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [baseDismissal], total: 1 });
    const { listDismissals } = await import('../services/dismissals.service');
    const result = await listDismissals({ page: 1, pageSize: 20 }, adminUser);
    expect(result.total).toBe(1);
  });
});

describe('dismissals.service — custom (non-canonical) reasonCode (free-text)', () => {
  it('createDismissal persists custom reasonCode like "covid_leave"', async () => {
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(baseCandidate as never);
    vi.mocked(repo.insert).mockImplementation(
      async (input) => ({ ...baseDismissal, ...input, id: 'dis-new' } as never),
    );
    const { createDismissal } = await import('../services/dismissals.service');
    const result = await createDismissal(
      {
        candidateId: 'cand-1',
        dismissedAt: '2024-03-01T00:00:00.000Z',
        reason: 'Custom leave reason',
        reasonCode: 'covid_leave',
      },
      adminUser,
      ctx,
    );
    const callArg = vi.mocked(repo.insert).mock.calls[0]?.[0];
    expect(callArg?.reasonCode).toBe('covid_leave');
    expect(result.reasonCode).toBe('covid_leave');
  });

  it('createDismissal without reasonCode persists null', async () => {
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(baseCandidate as never);
    vi.mocked(repo.insert).mockImplementation(
      async (input) => ({ ...baseDismissal, ...input, id: 'dis-no-code' } as never),
    );
    const { createDismissal } = await import('../services/dismissals.service');
    await createDismissal(
      {
        candidateId: 'cand-1',
        dismissedAt: '2024-03-01T00:00:00.000Z',
        reason: 'No code given',
      },
      adminUser,
      ctx,
    );
    const callArg = vi.mocked(repo.insert).mock.calls[0]?.[0];
    expect(callArg?.reasonCode).toBeNull();
  });

  it('updateDismissal forwards custom reasonCode string to repo', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseDismissal);
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) => ({ ...baseDismissal, ...(patch as object) } as never),
    );
    const { updateDismissal } = await import('../services/dismissals.service');
    await updateDismissal(
      'dis-1',
      { reasonCode: 'moved_to_germany' },
      adminUser,
      ctx,
    );
    const patchArg = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(patchArg?.reasonCode).toBe('moved_to_germany');
  });
});
