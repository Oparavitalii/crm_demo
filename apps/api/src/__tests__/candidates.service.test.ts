import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/candidates.repo', () => ({
  list: vi.fn(),
  findById: vi.fn(),
  findByIdEnriched: vi.fn(),
  findDuplicates: vi.fn(),
  findDuplicateIds: vi.fn(),
  findFailedCandidates: vi.fn(),
  findFirstMatchingCandidate: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../repositories/employment-periods.repo', () => ({
  insert: vi.fn(),
  closeOpen: vi.fn(),
  findOpen: vi.fn(),
  hasAny: vi.fn(),
  listByCandidate: vi.fn(),
}));
vi.mock('../repositories/dismissals.repo', () => ({
  insert: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// db.transaction is mocked to just invoke the callback with a fake tx so
// hireCandidate (and any future transactional flow) doesn't reach Neon.
// The inner repo calls are already mocked; they ignore the tx arg.
// db.insert covers submitFromPublic's direct consent inserts — the chain is
// both awaitable (SMS consent path awaits .values() bare) and .returning()-
// capable (application_form path). Captured rows land in mockConsentInserts.
const { mockConsentInserts } = vi.hoisted(() => ({ mockConsentInserts: vi.fn() }));
vi.mock('../db/client', () => ({
  db: {
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
    insert: vi.fn(() => ({
      values: (row: unknown) => {
        mockConsentInserts(row);
        return {
          returning: async () => [{ id: 'consent-1' }],
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    })),
  },
}));

import * as repo from '../repositories/candidates.repo';
import * as periodsRepo from '../repositories/employment-periods.repo';
import * as dismissalsRepo from '../repositories/dismissals.repo';
import * as audit from '../services/audit.service';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
// F3: createCandidateSchema now requires recruiterId — every new candidate
// has an owner. Default the input to recruiterUser.id so existing tests stay
// representative of admin OR recruiter flows.
const baseInput = {
  name: 'Anna Kowalska',
  email: 'anna@example.com',
  phone: '+48555111222',
  recruiterId: 'rec-1',
};
const baseCandidate = {
  id: 'cand-1', ...baseInput, status: 'new' as const, kind: 'candidate' as const,
  recruiterId: null, coordinatorId: null, freelancerId: null,
  consentId: null, processingRestricted: false, anonymizedAt: null, createdAt: new Date(), updatedAt: new Date(),
  birthDate: null, nationality: null, source: null, notes: null,
  workStartDate: null, workEndDate: null, workEndReason: null,
  projectId: null,
  reasonNote: null,
  housingType: null,
  documentsSubmittedAt: null, arrivedAt: null,
  position: null, legalStatus: null, reconciliationPeriod: null,
  workOutcome: null, payoutStatus: null, paymentStatus: null, retention: null,
  messenger: null, experience: null,
};
const ctx = { ip: null, userAgent: null };

beforeEach(() => vi.clearAllMocks());

describe('candidates.service.createCandidate', () => {
  it('throws DUPLICATE with matchedBy populated when email matches and force is not set', async () => {
    vi.mocked(repo.findDuplicates).mockResolvedValue([baseCandidate]);
    const { createCandidate } = await import('../services/candidates.service');
    await expect(createCandidate(baseInput, adminUser, false, ctx)).rejects.toMatchObject({
      code: 'DUPLICATE',
      status: 409,
      meta: {
        duplicates: [expect.objectContaining({ id: 'cand-1', matchedBy: expect.arrayContaining(['email']) })],
      },
    });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('inserts when no duplicates exist', async () => {
    vi.mocked(repo.findDuplicates).mockResolvedValue([]);
    vi.mocked(repo.insert).mockResolvedValue(baseCandidate);
    const { createCandidate } = await import('../services/candidates.service');
    const result = await createCandidate(baseInput, adminUser, false, ctx);
    expect(result.id).toBe('cand-1');
    expect(repo.insert).toHaveBeenCalledOnce();
  });

  it('inserts despite duplicates when force=true', async () => {
    vi.mocked(repo.findDuplicates).mockResolvedValue([baseCandidate]);
    vi.mocked(repo.insert).mockResolvedValue({ ...baseCandidate, id: 'cand-2' });
    const { createCandidate } = await import('../services/candidates.service');
    const result = await createCandidate(baseInput, adminUser, true, ctx);
    expect(result.id).toBe('cand-2');
  });

  it('auto-assigns recruiterId to current user when role is recruiter', async () => {
    vi.mocked(repo.findDuplicates).mockResolvedValue([]);
    vi.mocked(repo.insert).mockImplementation(async (input) => ({ ...baseCandidate, ...input } as never));
    const { createCandidate } = await import('../services/candidates.service');
    const result = await createCandidate(baseInput, recruiterUser, false, ctx);
    expect(result.recruiterId).toBe('rec-1');
  });

  it('admin may explicitly set recruiterId', async () => {
    vi.mocked(repo.findDuplicates).mockResolvedValue([]);
    vi.mocked(repo.insert).mockImplementation(async (input) => ({ ...baseCandidate, ...input } as never));
    const { createCandidate } = await import('../services/candidates.service');
    const result = await createCandidate({ ...baseInput, recruiterId: 'rec-9' }, adminUser, false, ctx);
    expect(result.recruiterId).toBe('rec-9');
  });
});

describe('candidates.service.getCandidate (RBAC scope)', () => {
  const enrichedBase = {
    ...baseCandidate,
    recruiterFirstName: null,
    recruiterLastName: null,
    recruiterIsFreelancer: null,
    coordinatorFirstName: null,
    coordinatorLastName: null,
    freelancerFirstName: null,
    freelancerLastName: null,
    projectName: null,
    rodoConsent: false,
    emailConsent: false,
    smsConsent: false,
  };

  it('admin sees any candidate', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, recruiterId: 'someone-else' });
    const { getCandidate } = await import('../services/candidates.service');
    const result = await getCandidate('cand-1', adminUser);
    expect(result.id).toBe('cand-1');
  });

  it('recruiter cannot see other recruiters candidate (returns 404)', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, recruiterId: 'someone-else' });
    const { getCandidate } = await import('../services/candidates.service');
    await expect(getCandidate('cand-1', recruiterUser)).rejects.toThrow(/NOT_FOUND/);
  });

  it('recruiter sees own candidate', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, recruiterId: 'rec-1' });
    const { getCandidate } = await import('../services/candidates.service');
    const result = await getCandidate('cand-1', recruiterUser);
    expect(result.id).toBe('cand-1');
  });

  it('recruiter CANNOT see unassigned candidate (recruiterId null) — 2026-06-11 strict own-only', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, recruiterId: null });
    const { getCandidate } = await import('../services/candidates.service');
    await expect(getCandidate('cand-1', recruiterUser)).rejects.toThrow(/NOT_FOUND/);
  });

  it('coordinator cannot see unassigned client (FAZA 28 strict)', async () => {
    const coord = { id: 'coord-1', role: 'coordinator' as const };
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, kind: 'client', coordinatorId: null });
    const { getCandidate } = await import('../services/candidates.service');
    await expect(getCandidate('cand-1', coord)).rejects.toThrow(/NOT_FOUND/);
  });

  it('coordinator sees own client (FAZA 28)', async () => {
    const coord = { id: 'coord-1', role: 'coordinator' as const };
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, kind: 'client', coordinatorId: 'coord-1' });
    const { getCandidate } = await import('../services/candidates.service');
    const result = await getCandidate('cand-1', coord);
    expect(result.id).toBe('cand-1');
  });
});

describe('FAZA 28: coordinator strict own-only scope', () => {
  const enrichedBase = {
    ...baseCandidate,
    kind: 'client' as const,
    recruiterFirstName: null,
    recruiterLastName: null,
    recruiterIsFreelancer: null,
    coordinatorFirstName: null,
    coordinatorLastName: null,
    freelancerFirstName: null,
    freelancerLastName: null,
    projectName: null,
    rodoConsent: false,
    emailConsent: false,
    smsConsent: false,
  };
  const coord1 = { id: 'coord-1', role: 'coordinator' as const };

  it('coordinator can see their own client (coordinatorId === user.id)', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, coordinatorId: 'coord-1' });
    const { getCandidate } = await import('../services/candidates.service');
    const result = await getCandidate('cand-1', coord1);
    expect(result.id).toBe('cand-1');
  });

  it('coordinator CANNOT see unassigned client (coordinatorId === null) → NOT_FOUND', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, coordinatorId: null });
    const { getCandidate } = await import('../services/candidates.service');
    await expect(getCandidate('cand-1', coord1)).rejects.toThrow(/NOT_FOUND/);
  });

  it("coordinator CANNOT see another coordinator's client → NOT_FOUND", async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, coordinatorId: 'coord-2' });
    const { getCandidate } = await import('../services/candidates.service');
    await expect(getCandidate('cand-1', coord1)).rejects.toThrow(/NOT_FOUND/);
  });

  it('admin sees coordinator-assigned client regardless of coordinatorId', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, coordinatorId: 'coord-2' });
    const { getCandidate } = await import('../services/candidates.service');
    const result = await getCandidate('cand-1', adminUser);
    expect(result.id).toBe('cand-1');
  });

  it('admin sees unassigned client', async () => {
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({ ...enrichedBase, coordinatorId: null });
    const { getCandidate } = await import('../services/candidates.service');
    const result = await getCandidate('cand-1', adminUser);
    expect(result.id).toBe('cand-1');
  });

  it('coord1 cannot see coord2 client even when row kind is candidate (legacy)', async () => {
    // Defensive check: scope is by coordinatorId, not by status/kind.
    vi.mocked(repo.findByIdEnriched).mockResolvedValue({
      ...enrichedBase,
      kind: 'candidate',
      coordinatorId: 'coord-2',
    });
    const { getCandidate } = await import('../services/candidates.service');
    await expect(getCandidate('cand-1', coord1)).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('candidates.service.deleteCandidate', () => {
  it('translates FK-restrict (23503) to VALIDATION error', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseCandidate);
    const fkError = Object.assign(new Error('FK violation'), { code: '23503', constraint: 'dismissals_candidate_id_fkey' });
    vi.mocked(repo.remove).mockRejectedValue(fkError);
    const { deleteCandidate } = await import('../services/candidates.service');
    await expect(deleteCandidate('cand-1', adminUser, ctx)).rejects.toThrow(/VALIDATION/);
  });
});

// 2026-06-10: candidate-level `dismissedAt` auto-stamping was removed when the
// column was dropped. The PATCH /candidates/:id flow now only enforces that a
// reason (workEndReason or reasonNote) is present at terminal transitions.
describe('candidates.service.updateCandidate (terminal transitions)', () => {
  it('updates status when dismissed transition is requested with a reason', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'employed',
      kind: 'client',
      workEndDate: null,
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) => ({ ...baseCandidate, status: 'employed', kind: 'client', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate(
      'cand-1',
      { status: 'dismissed', workEndReason: 'voluntary' },
      adminUser,
      ctx,
    );
    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(updateCall?.status).toBe('dismissed');
    expect(updateCall?.workEndReason).toBe('voluntary');
  });
});

// 2026-07-02: rejected saves are journaled (update_candidate_failed & friends)
// so admins can see WHY a user's "Зберегти" bounced. The entry must carry the
// error code + field NAMES only — never the submitted values (PII).
describe('candidates.service failed-attempt journaling', () => {
  it('journals update_candidate_failed with error + field names on rejected save', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: recruiterUser.id,
      status: 'employed',
      kind: 'client',
    });
    // DB write blows up mid-save — the user sees an error, the journal must too.
    vi.mocked(repo.update).mockRejectedValue(new Error('db connection lost'));
    const { updateCandidate } = await import('../services/candidates.service');
    await expect(
      updateCandidate(
        'cand-1',
        { status: 'in_progress', email: 'secret@example.com' },
        recruiterUser,
        ctx,
      ),
    ).rejects.toThrow(/db connection lost/);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update_candidate_failed',
        entityType: 'candidate',
        entityId: 'cand-1',
        actorId: recruiterUser.id,
        newValue: expect.objectContaining({
          error: 'INTERNAL',
          fields: expect.arrayContaining(['status', 'email']),
        }),
      }),
    );
    // PII guard: the submitted email VALUE must not leak into the journal.
    const failedEntry = vi
      .mocked(audit.log)
      .mock.calls.find((c) => (c[0] as { action: string }).action === 'update_candidate_failed');
    expect(JSON.stringify(failedEntry)).not.toContain('secret@example.com');
    // Success action must not have been written.
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update_candidate' }),
    );
  });

  it('journals dismiss_candidate_failed when dismissing a non-client', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'new',
      kind: 'candidate',
    });
    const { dismissCandidate } = await import('../services/candidates.service');
    await expect(
      dismissCandidate(
        'cand-1',
        { workEndDate: '2026-07-02T10:00:00.000Z' },
        adminUser,
        ctx,
      ),
    ).rejects.toThrow(/VALIDATION/);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dismiss_candidate_failed',
        entityId: 'cand-1',
        newValue: expect.objectContaining({
          error: 'VALIDATION',
          meta: expect.objectContaining({ reason: 'not_a_client' }),
        }),
      }),
    );
  });

  it('original error still propagates when the journal write itself fails', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: recruiterUser.id,
      status: 'employed',
      kind: 'client',
    });
    vi.mocked(repo.update).mockRejectedValue(new Error('db connection lost'));
    vi.mocked(audit.log).mockRejectedValueOnce(new Error('audit db down'));
    const { updateCandidate } = await import('../services/candidates.service');
    await expect(
      updateCandidate('cand-1', { status: 'in_progress' }, recruiterUser, ctx),
    ).rejects.toThrow(/db connection lost/);
  });
});

// 2026-07-02 — the forward-only guard was removed per client request: any role
// with PATCH access may move a status in any direction. Locked here so a
// re-introduction of the guard surfaces as a failing test.
describe('candidates.service.updateCandidate (free status transitions)', () => {
  it('recruiter can move own dismissed client back to new (backward transition allowed)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: recruiterUser.id,
      status: 'dismissed',
      kind: 'client',
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) => ({ ...baseCandidate, recruiterId: recruiterUser.id, kind: 'client', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    const row = await updateCandidate('cand-1', { status: 'new' }, recruiterUser, ctx);
    expect(row.status).toBe('new');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update_candidate', entityId: 'cand-1' }),
    );
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update_candidate_failed' }),
    );
  });
});

describe('candidates.service.updateCandidate (FAZA 26 lifecycle checklist stamping)', () => {
  it('stamps documentsSubmittedAt on first transition to documents_submitted', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'in_progress',
      documentsSubmittedAt: null,
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({ ...baseCandidate, status: 'in_progress', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { status: 'documents_submitted' }, adminUser, ctx);
    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(updateCall?.documentsSubmittedAt).toBeInstanceOf(Date);
  });

  it('does NOT overwrite documentsSubmittedAt on re-transition to documents_submitted', async () => {
    const existingDocsAt = new Date('2024-02-15');
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'in_progress',
      documentsSubmittedAt: existingDocsAt,
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({
          ...baseCandidate,
          status: 'in_progress',
          documentsSubmittedAt: existingDocsAt,
          ...patch,
        } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { status: 'documents_submitted' }, adminUser, ctx);
    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(updateCall?.documentsSubmittedAt).toBeUndefined();
  });

  it('passes reasonNote through on cancelled transition', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'documents_submitted',
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({ ...baseCandidate, status: 'documents_submitted', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate(
      'cand-1',
      { status: 'cancelled', reasonNote: 'no_show_lost_contact' },
      adminUser,
      ctx,
    );
    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(updateCall?.status).toBe('cancelled');
    expect(updateCall?.reasonNote).toBe('no_show_lost_contact');
  });
});

// 2026-07-02 — the F9 reason_required guard was removed per client request:
// every field is independent, terminal statuses save with or without reason.
describe('terminal status transitions (reason optional)', () => {
  it('allows dismissed without any reason', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'employed',
      kind: 'client',
      workEndReason: null,
      reasonNote: null,
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({ ...baseCandidate, status: 'employed', kind: 'client', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    const row = await updateCandidate('cand-1', { status: 'dismissed' }, adminUser, ctx);
    expect(row.status).toBe('dismissed');
    expect(repo.update).toHaveBeenCalledOnce();
  });

  it('allows dismissed when patch contains workEndReason', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'employed',
      kind: 'client',
      workEndReason: null,
      reasonNote: null,
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({ ...baseCandidate, status: 'employed', kind: 'client', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate(
      'cand-1',
      { status: 'dismissed', workEndReason: 'left voluntarily' },
      adminUser,
      ctx,
    );
    expect(repo.update).toHaveBeenCalledOnce();
  });

  it('allows cancelled when patch provides reasonNote', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'in_progress',
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({ ...baseCandidate, status: 'in_progress', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate(
      'cand-1',
      { status: 'cancelled', reasonNote: 'personal_reasons' },
      adminUser,
      ctx,
    );
    expect(repo.update).toHaveBeenCalledOnce();
  });

  it('allows blacklist without any reason', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'in_progress',
      reasonNote: null,
      workEndReason: null,
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({ ...baseCandidate, status: 'in_progress', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    const row = await updateCandidate('cand-1', { status: 'blacklist' }, adminUser, ctx);
    expect(row.status).toBe('blacklist');
  });

  it('allows blacklist when patch contains reasonNote', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'in_progress',
      reasonNote: null,
      workEndReason: null,
    });
    vi.mocked(repo.update).mockImplementation(
      async (_id, patch) =>
        ({ ...baseCandidate, status: 'in_progress', ...patch } as never),
    );
    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate(
      'cand-1',
      { status: 'blacklist', reasonNote: 'Aggressive behaviour at site' },
      adminUser,
      ctx,
    );
    expect(repo.update).toHaveBeenCalledOnce();
  });
});

describe('candidates.service.listFailedCandidates (RBAC scope)', () => {
  // Minimal ListCandidatesQuery — page/pageSize are required by the type.
  const baseQuery = { page: 1, pageSize: 20, includeAnonymized: false };

  it('passes scopeRecruiterId for recruiter actor', async () => {
    vi.mocked(repo.findFailedCandidates).mockResolvedValue({ items: [], total: 0 });
    const { listFailedCandidates } = await import('../services/candidates.service');
    await listFailedCandidates(baseQuery as never, recruiterUser);
    expect(repo.findFailedCandidates).toHaveBeenCalledWith(baseQuery, 'rec-1', undefined);
  });

  it('passes scopeCoordinatorId for coordinator actor', async () => {
    vi.mocked(repo.findFailedCandidates).mockResolvedValue({ items: [], total: 0 });
    const coord = { id: 'coord-1', role: 'coordinator' as const };
    const { listFailedCandidates } = await import('../services/candidates.service');
    await listFailedCandidates(baseQuery as never, coord);
    expect(repo.findFailedCandidates).toHaveBeenCalledWith(baseQuery, undefined, 'coord-1');
  });

  it('passes no scope for admin actor', async () => {
    vi.mocked(repo.findFailedCandidates).mockResolvedValue({ items: [], total: 0 });
    const { listFailedCandidates } = await import('../services/candidates.service');
    await listFailedCandidates(baseQuery as never, adminUser);
    expect(repo.findFailedCandidates).toHaveBeenCalledWith(baseQuery, undefined, undefined);
  });
});

describe('candidates.service.hireCandidate', () => {
  it('first-time hire: flips kind to client, status to employed, inserts period', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      workStartDate: null,
      kind: 'candidate',
      status: 'documents_submitted',
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(false);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));
    vi.mocked(periodsRepo.insert).mockResolvedValue({} as never);

    const { hireCandidate } = await import('../services/candidates.service');
    await hireCandidate(
      'cand-1',
      {
        workStartDate: '2026-06-01T08:00:00.000Z',
        housingType: 'our',
        projectId: 'proj-1',
        coordinatorId: 'coord-1',
      },
      adminUser,
      ctx,
    );

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('employed');
    expect(updateCall.kind).toBe('client');
    expect(updateCall.housingType).toBe('our');
    expect(updateCall.workStartDate).toBeInstanceOf(Date);

    expect(periodsRepo.insert).toHaveBeenCalledOnce();
    const insertArg = vi.mocked(periodsRepo.insert).mock.calls[0]?.[0];
    expect(insertArg?.candidateId).toBe('cand-1');
    expect(insertArg?.createdBy).toBe('admin-1');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate', entityId: 'cand-1' }),
    );
  });

  it('re-hire: sets status=re_employed, card workStartDate moves to the new episode', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'dismissed',
      workStartDate: new Date('2025-01-01'),
      workEndDate: new Date('2025-12-01'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(true);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));
    vi.mocked(periodsRepo.insert).mockResolvedValue({} as never);

    const { hireCandidate } = await import('../services/candidates.service');
    await hireCandidate(
      'cand-1',
      {
        workStartDate: '2026-06-01T08:00:00.000Z',
        housingType: 'own',
      },
      adminUser,
      ctx,
    );

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('re_employed');
    expect(updateCall.kind).toBe('client');
    // 2026-07-10: the card mirrors the LATEST episode — rehire used to pin the
    // first-hire date, which the client could never change from the modal.
    expect((updateCall.workStartDate as Date).toISOString()).toBe('2026-06-01T08:00:00.000Z');
    expect(updateCall.workEndDate).toBeNull();

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rehire_candidate' }),
    );
  });

  it('first REAL hire of an imported row (workStartDate set, no periods) → employed, not re_employed', async () => {
    // Regression for the 09.07 client report: legacy imports set workStartDate
    // without creating employment_periods; the old !workStartDate signal
    // mislabelled their first actual hire as a re-hire.
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'candidate',
      status: 'documents_submitted',
      workStartDate: new Date('2026-01-06'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(false);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));
    vi.mocked(periodsRepo.insert).mockResolvedValue({} as never);

    const { hireCandidate } = await import('../services/candidates.service');
    await hireCandidate(
      'cand-1',
      { workStartDate: '2026-06-05T08:00:00.000Z', housingType: 'our' },
      adminUser,
      ctx,
    );

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('employed');
    expect((updateCall.workStartDate as Date).toISOString()).toBe('2026-06-05T08:00:00.000Z');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate' }),
    );
  });

  it('refuses to hire when an open period already exists', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseCandidate, kind: 'client' });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue({ id: 'ep-1' } as never);

    const { hireCandidate } = await import('../services/candidates.service');
    await expect(
      hireCandidate(
        'cand-1',
        { workStartDate: '2026-06-01T08:00:00.000Z', housingType: 'our' },
        adminUser,
        ctx,
      ),
    ).rejects.toThrow(/VALIDATION/);
    expect(repo.update).not.toHaveBeenCalled();
    expect(periodsRepo.insert).not.toHaveBeenCalled();
  });

  it('audit log is NOT written if the transaction throws (atomicity guard)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      workStartDate: null,
      kind: 'candidate',
      status: 'documents_submitted',
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));
    // Period insert fails — the entire hire flow must abort, audit must not fire.
    vi.mocked(periodsRepo.insert).mockRejectedValue(new Error('FK violation on project_id'));

    const { hireCandidate } = await import('../services/candidates.service');
    await expect(
      hireCandidate(
        'cand-1',
        {
          workStartDate: '2026-06-01T08:00:00.000Z',
          housingType: 'our',
          projectId: 'nonexistent',
        },
        adminUser,
        ctx,
      ),
    ).rejects.toThrow(/FK violation/);
    // Success audit must NOT fire (atomicity) — only the failed-attempt entry.
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate' }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate_failed' }),
    );
  });
});

describe('candidates.service.dismissCandidate', () => {
  it('closes open period, flips status to dismissed, sets workEndDate', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'employed',
      workStartDate: new Date('2026-01-01'),
    });
    vi.mocked(periodsRepo.closeOpen).mockResolvedValue({} as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));
    vi.mocked(dismissalsRepo.insert).mockResolvedValue({ id: 'dism-1' } as never);

    const { dismissCandidate } = await import('../services/candidates.service');
    await dismissCandidate(
      'cand-1',
      {
        workEndDate: '2026-06-01T08:00:00.000Z',
        reasonCode: 'absenteeism',
        reasonNote: 'recurring no-show',
      },
      adminUser,
      ctx,
    );

    // Verify period was closed BEFORE status flip (preserves history if update fails).
    expect(periodsRepo.closeOpen).toHaveBeenCalledWith(
      'cand-1',
      expect.any(Date),
      'absenteeism',
    );

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('dismissed');
    expect(updateCall.workEndDate).toBeInstanceOf(Date);
    expect(updateCall.workEndReason).toBe('absenteeism');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dismiss_candidate' }),
    );

    // 2026-06-02: the dismiss flow must mirror the event into the dismissals
    // table so the retention report stays in sync with candidate status.
    expect(dismissalsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-1',
        reasonCode: 'absenteeism',
        notes: 'recurring no-show',
        recordedById: adminUser.id,
      }),
    );
  });

  it('refuses to dismiss a non-client (status=cancelled or candidate)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'candidate',
      status: 'cancelled',
    });

    const { dismissCandidate } = await import('../services/candidates.service');
    await expect(
      dismissCandidate(
        'cand-1',
        { workEndDate: '2026-06-01T08:00:00.000Z', reasonCode: 'x' },
        adminUser,
        ctx,
      ),
    ).rejects.toThrow(/VALIDATION/);
    expect(periodsRepo.closeOpen).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  // 2026-07-02 — reason is optional now (client request: every field
  // independent). A reason-less dismiss succeeds; the dismissals-table mirror
  // falls back to 'other' because its reason column is non-null.
  it('allows dismiss without reason — dismissals row falls back to other', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'employed',
    });
    vi.mocked(periodsRepo.closeOpen).mockResolvedValue({} as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));
    vi.mocked(dismissalsRepo.insert).mockResolvedValue({ id: 'dism-1' } as never);

    const { dismissCandidate } = await import('../services/candidates.service');
    await dismissCandidate(
      'cand-1',
      { workEndDate: '2026-06-01T08:00:00.000Z' },
      adminUser,
      ctx,
    );
    expect(periodsRepo.closeOpen).toHaveBeenCalledWith('cand-1', expect.any(Date), null);
    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('dismissed');
    expect(updateCall.workEndReason).toBeNull();
    expect(dismissalsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'other', reasonCode: null, notes: null }),
    );
  });

  it('treats whitespace-only reason fields as no reason (still succeeds)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'employed',
    });
    vi.mocked(periodsRepo.closeOpen).mockResolvedValue({} as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));
    vi.mocked(dismissalsRepo.insert).mockResolvedValue({ id: 'dism-1' } as never);

    const { dismissCandidate } = await import('../services/candidates.service');
    await dismissCandidate(
      'cand-1',
      { workEndDate: '2026-06-01T08:00:00.000Z', reasonCode: '   ', reasonNote: '  ' },
      adminUser,
      ctx,
    );
    expect(dismissalsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'other', reasonCode: null, notes: null }),
    );
  });
});

describe('candidates.service.cancelCandidate', () => {
  it('persists reasonNote and routes to status=cancelled', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'candidate',
      status: 'in_progress',
    });
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { cancelCandidate } = await import('../services/candidates.service');
    await cancelCandidate(
      'cand-1',
      { reasonNote: 'moved away' },
      adminUser,
      ctx,
    );

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('cancelled');
    expect(updateCall.reasonNote).toBe('moved away');
    expect(updateCall.housingType).toBeNull();

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cancel_candidate' }),
    );
  });

  it('closes the open employment period with the annulment date and reason cancelled', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'employed',
    });
    vi.mocked(periodsRepo.closeOpen).mockResolvedValue({ id: 'ep-1' } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { cancelCandidate } = await import('../services/candidates.service');
    await cancelCandidate('cand-1', {}, adminUser, ctx);

    expect(periodsRepo.closeOpen).toHaveBeenCalledWith(
      'cand-1',
      expect.any(Date),
      'cancelled',
      expect.anything(),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cancel_candidate',
        newValue: expect.objectContaining({ closedEmploymentPeriod: true }),
      }),
    );
  });
});

// 2026-08-12 (client report «100% retention»): the generic PATCH and cancel
// used to change candidates.status without touching employment_periods, so
// annulled / bulk-dismissed candidates kept an open episode and counted as
// "working" in retention analytics forever. These tests lock the bookkeeping.
describe('employment-period bookkeeping on PATCH status transitions', () => {
  it('status=dismissed closes the open episode, records a dismissals row, mirrors workEndDate', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'employed',
    });
    vi.mocked(periodsRepo.closeOpen).mockResolvedValue({ id: 'ep-1' } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { status: 'dismissed', reasonNote: 'left' }, adminUser, ctx);

    expect(periodsRepo.closeOpen).toHaveBeenCalledWith(
      'cand-1',
      expect.any(Date),
      'left',
      expect.anything(),
    );
    expect(dismissalsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-1',
        dismissedAt: expect.any(Date),
        reason: 'left',
        recordedById: 'admin-1',
      }),
      expect.anything(),
    );
    // Bulk PATCH carries no dates — the card must mirror the episode end.
    const patchArg = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patchArg.workEndDate).toBeInstanceOf(Date);
  });

  it('status=cancelled / blacklist close the episode but record NO dismissal', async () => {
    for (const status of ['cancelled', 'blacklist'] as const) {
      vi.clearAllMocks();
      vi.mocked(repo.findById).mockResolvedValue({
        ...baseCandidate,
        kind: 'client',
        status: 'employed',
      });
      vi.mocked(periodsRepo.closeOpen).mockResolvedValue({ id: 'ep-1' } as never);
      vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

      const { updateCandidate } = await import('../services/candidates.service');
      await updateCandidate('cand-1', { status }, adminUser, ctx);

      expect(periodsRepo.closeOpen).toHaveBeenCalledWith(
        'cand-1',
        expect.any(Date),
        status,
        expect.anything(),
      );
      expect(dismissalsRepo.insert).not.toHaveBeenCalled();
    }
  });

  it('status=employed with no episode creates one dated today and mirrors workStartDate', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseCandidate, status: 'new' });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(false);
    // clearAllMocks resets calls, not implementations — the hire atomicity test
    // above leaves a mockRejectedValue on periodsRepo.insert.
    vi.mocked(periodsRepo.insert).mockResolvedValue({ id: 'ep-new' } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { status: 'employed' }, adminUser, ctx);

    const inserted = vi.mocked(periodsRepo.insert).mock.calls[0]?.[0] as { employedAt: Date; createdBy: string };
    expect(inserted.createdBy).toBe('admin-1');
    expect(Date.now() - inserted.employedAt.getTime()).toBeLessThan(60_000);
    const patchArg = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patchArg.workStartDate).toBeInstanceOf(Date);
  });

  it('first hire of an imported row uses the legacy card workStartDate for the episode', async () => {
    const legacyStart = new Date('2026-05-01T00:00:00.000Z');
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      status: 'new',
      workStartDate: legacyStart,
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(false);
    vi.mocked(periodsRepo.insert).mockResolvedValue({ id: 'ep-new' } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { status: 'employed' }, adminUser, ctx);

    expect(periodsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ employedAt: legacyStart }),
      expect.anything(),
    );
  });

  it('re-hire via PATCH does NOT inherit the previous episode start from the card', async () => {
    const oldStart = new Date('2026-01-10T00:00:00.000Z');
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'dismissed',
      workStartDate: oldStart,
      workEndDate: new Date('2026-03-01T00:00:00.000Z'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(true);
    vi.mocked(periodsRepo.insert).mockResolvedValue({ id: 'ep-new' } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { status: 're_employed' }, adminUser, ctx);

    const inserted = vi.mocked(periodsRepo.insert).mock.calls[0]?.[0] as { employedAt: Date };
    expect(Date.now() - inserted.employedAt.getTime()).toBeLessThan(60_000);
    // Card mirrors the fresh episode: end-of-work fields belong to the old one.
    const patchArg = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patchArg.workEndDate).toBeNull();
    expect(patchArg.workEndReason).toBeNull();
  });

  it('status=employed with an already-open episode creates nothing', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseCandidate, status: 'new' });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue({ id: 'ep-1' } as never);
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { status: 'employed' }, adminUser, ctx);

    expect(periodsRepo.insert).not.toHaveBeenCalled();
  });

  it('a non-status PATCH never touches employment periods', async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...baseCandidate, status: 'employed', kind: 'client' });
    vi.mocked(repo.update).mockImplementation(async (_id, p) => ({ ...baseCandidate, ...p } as never));

    const { updateCandidate } = await import('../services/candidates.service');
    await updateCandidate('cand-1', { notes: 'call back tomorrow' }, adminUser, ctx);

    expect(periodsRepo.closeOpen).not.toHaveBeenCalled();
    expect(periodsRepo.findOpen).not.toHaveBeenCalled();
    expect(periodsRepo.insert).not.toHaveBeenCalled();
    expect(dismissalsRepo.insert).not.toHaveBeenCalled();
  });
});

// rehireCandidate is implemented as a thin wrapper that delegates to
// hireCandidate. These tests lock the contract from the caller's perspective:
// the precondition is "no open employment_period" (not "status == dismissed").
// 2026-07-10: the lifecycle decision derives from employment_periods — any
// candidate with at least one prior episode (open or closed) gets re_employed;
// a candidate with no episodes gets first-hire employed, regardless of what
// workStartDate the import/form left on the card. See "contract note" cases
// below — those branches are NOT blocked at the service layer.
describe('candidates.service.rehireCandidate', () => {
  const rehireInput = {
    workStartDate: '2026-06-15T08:00:00.000Z',
    housingType: 'our' as const,
    projectId: 'proj-2',
    coordinatorId: 'coord-9',
  };

  it('admin rehires dismissed candidate → status re_employed, card workStartDate = new episode date, audit rehire_candidate', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'dismissed',
      workStartDate: new Date('2025-01-01'),
      workEndDate: new Date('2025-12-01'),
      workEndReason: 'voluntary',
      housingType: null,
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(true);
    vi.mocked(repo.update).mockImplementation(
      async (_id, p) => ({ ...baseCandidate, ...p } as never),
    );
    vi.mocked(periodsRepo.insert).mockResolvedValue({} as never);

    const { rehireCandidate } = await import('../services/candidates.service');
    await rehireCandidate('cand-1', rehireInput, adminUser, ctx);

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('re_employed');
    expect(updateCall.kind).toBe('client');
    expect(updateCall.housingType).toBe('our');
    expect(updateCall.workEndDate).toBeNull();
    expect(updateCall.workEndReason).toBeNull();
    // 2026-07-10: the card mirrors the LATEST episode — full history (and
    // retention across episodes) lives in employment_periods.
    expect((updateCall.workStartDate as Date).toISOString()).toBe(rehireInput.workStartDate);

    // New employment_period inserted with the *new* workStartDate as employedAt.
    expect(periodsRepo.insert).toHaveBeenCalledOnce();
    const insertArg = vi.mocked(periodsRepo.insert).mock.calls[0]?.[0];
    expect(insertArg?.candidateId).toBe('cand-1');
    expect(insertArg?.projectId).toBe('proj-2');
    expect(insertArg?.coordinatorId).toBe('coord-9');
    expect(insertArg?.createdBy).toBe('admin-1');
    expect((insertArg?.employedAt as Date).toISOString()).toBe(rehireInput.workStartDate);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rehire_candidate',
        actorId: 'admin-1',
        entityId: 'cand-1',
      }),
    );
  });

  it('recruiter can rehire own dismissed candidate', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: 'rec-1',
      kind: 'client',
      status: 'dismissed',
      workStartDate: new Date('2025-01-01'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(true);
    vi.mocked(repo.update).mockImplementation(
      async (_id, p) => ({ ...baseCandidate, ...p } as never),
    );
    vi.mocked(periodsRepo.insert).mockResolvedValue({} as never);

    const { rehireCandidate } = await import('../services/candidates.service');
    await rehireCandidate('cand-1', rehireInput, recruiterUser, ctx);

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('re_employed');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rehire_candidate', actorId: 'rec-1' }),
    );
  });

  it('coordinator can rehire own dismissed client (FAZA 28 own-only scope)', async () => {
    const coord = { id: 'coord-1', role: 'coordinator' as const };
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      coordinatorId: 'coord-1',
      kind: 'client',
      status: 'dismissed',
      workStartDate: new Date('2025-01-01'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(true);
    vi.mocked(repo.update).mockImplementation(
      async (_id, p) => ({ ...baseCandidate, ...p } as never),
    );
    vi.mocked(periodsRepo.insert).mockResolvedValue({} as never);

    const { rehireCandidate } = await import('../services/candidates.service');
    await rehireCandidate('cand-1', rehireInput, coord, ctx);

    expect(repo.update).toHaveBeenCalledOnce();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rehire_candidate', actorId: 'coord-1' }),
    );
  });

  it('refuses to rehire when an open period exists → VALIDATION already_employed', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'employed',
      workStartDate: new Date('2025-01-01'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue({ id: 'ep-open' } as never);

    const { rehireCandidate } = await import('../services/candidates.service');
    await expect(
      rehireCandidate('cand-1', rehireInput, adminUser, ctx),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      status: 409,
      meta: expect.objectContaining({ reason: 'already_employed' }),
    });
    expect(repo.update).not.toHaveBeenCalled();
    expect(periodsRepo.insert).not.toHaveBeenCalled();
    // Rejected attempt is journaled, success action is not.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate_failed' }),
    );
  });

  it('throws NOT_FOUND for non-existent candidate', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined as never);

    const { rehireCandidate } = await import('../services/candidates.service');
    await expect(
      rehireCandidate('missing', rehireInput, adminUser, ctx),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(periodsRepo.findOpen).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("recruiter cannot rehire another recruiter's candidate → NOT_FOUND (horizontal isolation)", async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      recruiterId: 'rec-other',
      kind: 'client',
      status: 'dismissed',
      workStartDate: new Date('2025-01-01'),
    });

    const { rehireCandidate } = await import('../services/candidates.service');
    await expect(
      rehireCandidate('cand-1', rehireInput, recruiterUser, ctx),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(periodsRepo.findOpen).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate' }),
    );
  });

  it("coordinator cannot rehire a client assigned to another coordinator → NOT_FOUND", async () => {
    const coord = { id: 'coord-1', role: 'coordinator' as const };
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      coordinatorId: 'coord-other',
      kind: 'client',
      status: 'dismissed',
      workStartDate: new Date('2025-01-01'),
    });

    const { rehireCandidate } = await import('../services/candidates.service');
    await expect(
      rehireCandidate('cand-1', rehireInput, coord, ctx),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(periodsRepo.findOpen).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate' }),
    );
  });

  it('audit log NOT written when transactional period insert fails (atomicity)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'dismissed',
      workStartDate: new Date('2025-01-01'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(true);
    vi.mocked(repo.update).mockImplementation(
      async (_id, p) => ({ ...baseCandidate, ...p } as never),
    );
    vi.mocked(periodsRepo.insert).mockRejectedValue(
      new Error('FK violation on coordinator_id'),
    );

    const { rehireCandidate } = await import('../services/candidates.service');
    await expect(
      rehireCandidate('cand-1', rehireInput, adminUser, ctx),
    ).rejects.toThrow(/FK violation/);
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rehire_candidate' }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hire_candidate_failed' }),
    );
  });

  // Contract note: the service does NOT enforce a "must be currently dismissed"
  // precondition. The lifecycle decision is derived purely from the candidate's
  // employment_periods: a cancelled/blacklist candidate with a prior (closed)
  // episode and no open one will be re-hired into re_employed. This matches
  // the loose forward-only transition model (see assertValidTransition:
  // "dismissed -> re_employed is explicitly forward", and admin is allowed to
  // override anything anyway). Locked here so changes to this behavior
  // surface as a failing test.
  it('contract: admin can rehire a cancelled candidate with a prior episode (no explicit "must be dismissed" guard)', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseCandidate,
      kind: 'client',
      status: 'cancelled',
      workStartDate: new Date('2025-01-01'),
    });
    vi.mocked(periodsRepo.findOpen).mockResolvedValue(null);
    vi.mocked(periodsRepo.hasAny).mockResolvedValue(true);
    vi.mocked(repo.update).mockImplementation(
      async (_id, p) => ({ ...baseCandidate, ...p } as never),
    );
    vi.mocked(periodsRepo.insert).mockResolvedValue({} as never);

    const { rehireCandidate } = await import('../services/candidates.service');
    await rehireCandidate('cand-1', rehireInput, adminUser, ctx);

    const updateCall = vi.mocked(repo.update).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.status).toBe('re_employed');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rehire_candidate' }),
    );
  });
});

describe('candidates.service.submitFromPublic — consents', () => {
  const publicInput = {
    name: 'Anna Kowalska',
    email: 'anna@example.com',
    phone: null,
    source: 'website' as const,
  };

  beforeEach(() => {
    vi.mocked(repo.findFirstMatchingCandidate).mockResolvedValue(null);
    vi.mocked(repo.insert).mockResolvedValue(baseCandidate);
  });

  it('records application_form AND sms_marketing rows when both consents accepted', async () => {
    const { submitFromPublic } = await import('../services/candidates.service');
    await submitFromPublic(
      { ...publicInput, consentAccepted: true, smsConsentAccepted: true },
      ctx,
    );

    expect(mockConsentInserts).toHaveBeenCalledTimes(2);
    expect(mockConsentInserts).toHaveBeenCalledWith(
      expect.objectContaining({ consentType: 'application_form' }),
    );
    expect(mockConsentInserts).toHaveBeenCalledWith(
      expect.objectContaining({
        consentType: 'sms_marketing',
        candidateEmail: 'anna@example.com',
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'submit_public_candidate',
        newValue: expect.objectContaining({
          consentRecorded: true,
          smsConsentRecorded: true,
        }),
      }),
    );
  });

  it('phone-only: records sms_marketing keyed on phone (email null), skips application_form', async () => {
    const { submitFromPublic } = await import('../services/candidates.service');
    await submitFromPublic(
      {
        ...publicInput,
        email: null,
        phone: '+48555111222',
        consentAccepted: true,
        smsConsentAccepted: true,
      },
      ctx,
    );

    // application_form needs an email → skipped. sms_marketing is phone-keyed →
    // recorded with candidatePhone set and candidateEmail null.
    expect(mockConsentInserts).toHaveBeenCalledTimes(1);
    expect(mockConsentInserts).toHaveBeenCalledWith(
      expect.objectContaining({
        consentType: 'sms_marketing',
        candidatePhone: '+48555111222',
        candidateEmail: null,
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({
          consentRecorded: false,
          smsConsentRecorded: true,
        }),
      }),
    );
  });

  it('legacy payload without consent flags creates no consent rows (back-compat)', async () => {
    const { submitFromPublic } = await import('../services/candidates.service');
    await submitFromPublic(publicInput, ctx);

    expect(mockConsentInserts).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({
          consentRecorded: false,
          smsConsentRecorded: false,
        }),
      }),
    );
  });

  it('sms consent alone (without application_form flag) still records the sms row', async () => {
    const { submitFromPublic } = await import('../services/candidates.service');
    await submitFromPublic({ ...publicInput, smsConsentAccepted: true }, ctx);

    expect(mockConsentInserts).toHaveBeenCalledTimes(1);
    expect(mockConsentInserts).toHaveBeenCalledWith(
      expect.objectContaining({ consentType: 'sms_marketing' }),
    );
  });
});

