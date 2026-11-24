import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';
process.env.APP_URL = 'http://localhost:3000';

vi.mock('../repositories/users.repo', () => ({
  findByEmail: vi.fn(),
  findById: vi.fn(),
  findByPublicSlug: vi.fn(),
  create: vi.fn(),
  updateLastLogin: vi.fn(),
  recordFailedLogin: vi.fn(),
  lockAccount: vi.fn(),
  clearExpiredLocks: vi.fn(),
  updatePasswordHash: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../repositories/sessions.repo', () => ({
  create: vi.fn(),
  findByTokenHash: vi.fn(),
  findById: vi.fn(),
  deleteById: vi.fn(),
  deleteByUserId: vi.fn(),
  deleteExpired: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock('../repositories/password-reset-tokens.repo', () => ({
  create: vi.fn(),
  findValidByHash: vi.fn(),
  markUsed: vi.fn(),
  deleteExpired: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({ log: vi.fn() }));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/email.service', () => ({
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('../clients/resend.client', () => ({
  sendEmail: vi.fn(),
}));

// Mock the db client + drizzle query builder used in listUsers
vi.mock('../db/client', () => {
  const queryBuilderUsers = {
    findMany: vi.fn(),
  };
  const mockDb = {
    query: {
      users: queryBuilderUsers,
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    then: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };
  return { db: mockDb };
});

import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import * as resetRepo from '../repositories/password-reset-tokens.repo';
import * as emailService from '../services/email.service';
import * as resendClient from '../clients/resend.client';
import { AppError, NotFoundError } from '../lib/errors';
import { db } from '../db/client';

const adminActor = { id: 'admin-1', role: 'admin' as const };
const ctx = { ip: null, userAgent: null };

const baseUserRow = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Jan',
  lastName: 'Kowalski',
  role: 'recruiter' as const,
  isActive: true,
  isFreelancer: false,
  publicSlug: null,
  passwordHash: '$2b$12$hash',
  twoFactorSecret: null,
  lastLoginAt: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('admin-users.service.listUsers', () => {
  it('returns paginated users list', async () => {
    vi.mocked(db.query.users.findMany).mockResolvedValue([baseUserRow]);

    // The service does: db.select({ c: count() }).from(users).where(condition).then(r => r[0])
    // We need to mock the select → from → where → then chain
    const whereMock = {
      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn([{ c: 1 }])),
    };
    const fromMock = { where: vi.fn().mockReturnValue(whereMock) };
    vi.mocked(db.select).mockReturnValue({ from: vi.fn().mockReturnValue(fromMock) } as never);

    const { listUsers } = await import('../services/admin-users.service');
    const result = await listUsers({ page: 1, pageSize: 20 }, adminActor);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.email).toBe('test@example.com');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });
});

describe('admin-users.service.getUser', () => {
  it('returns user when found', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(baseUserRow);
    const { getUser } = await import('../services/admin-users.service');
    const user = await getUser('user-1', adminActor);
    expect(user.id).toBe('user-1');
    expect(user.email).toBe('test@example.com');
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(undefined);
    const { getUser } = await import('../services/admin-users.service');
    await expect(getUser('nonexistent', adminActor)).rejects.toThrow(NotFoundError);
  });
});

describe('admin-users.service.createUser', () => {
  // Tests below assume the email is NOT taken — set findByEmail=undefined per
  // test so the DUPLICATE pre-check passes regardless of test order (mock
  // resolved-values persist across vi.clearAllMocks).
  beforeEach(() => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
  });

  it('creates user and returns passwordEmailSent: true when email send succeeds', async () => {
    vi.mocked(usersRepo.create).mockResolvedValue(baseUserRow);
    vi.mocked(resetRepo.create).mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      usedAt: null,
      createdAt: new Date(),
    });
    vi.mocked(resendClient.sendEmail).mockResolvedValue({ id: 'email-1' });

    const { createUser } = await import('../services/admin-users.service');
    const result = await createUser(
      { email: 'test@example.com', firstName: 'Jan', lastName: 'Kowalski', role: 'recruiter', isFreelancer: false, sendInvite: true },
      adminActor,
      ctx,
    );

    expect(result.user.id).toBe('user-1');
    expect(result.passwordEmailSent).toBe(true);
    expect(result.temporaryPassword).toBeUndefined();
    expect(usersRepo.create).toHaveBeenCalledOnce();
  });

  it('returns passwordEmailSent: false and exposes temporaryPassword when email send fails', async () => {
    vi.mocked(usersRepo.create).mockResolvedValue(baseUserRow);
    vi.mocked(resetRepo.create).mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      usedAt: null,
      createdAt: new Date(),
    });
    vi.mocked(resendClient.sendEmail).mockResolvedValue(null); // email fails

    const { createUser } = await import('../services/admin-users.service');
    const result = await createUser(
      { email: 'test@example.com', firstName: 'Jan', lastName: 'Kowalski', role: 'recruiter', isFreelancer: false, sendInvite: true },
      adminActor,
      ctx,
    );

    expect(result.passwordEmailSent).toBe(false);
    expect(result.temporaryPassword).toBeDefined();
    expect(typeof result.temporaryPassword).toBe('string');
  });

  it('throws DUPLICATE 409 when email already exists (no 500)', async () => {
    // Overrides the beforeEach default to simulate the email being taken.
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(baseUserRow);

    const { createUser } = await import('../services/admin-users.service');
    await expect(
      createUser(
        { email: 'test@example.com', firstName: 'Jan', lastName: 'Kowalski', role: 'recruiter', isFreelancer: false, sendInvite: true },
        adminActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE', status: 409 });
    expect(usersRepo.create).not.toHaveBeenCalled();
  });

  it('still creates user even when email send throws', async () => {
    vi.mocked(usersRepo.create).mockResolvedValue(baseUserRow);
    vi.mocked(resetRepo.create).mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      usedAt: null,
      createdAt: new Date(),
    });
    vi.mocked(resendClient.sendEmail).mockRejectedValue(new Error('SMTP down'));

    const { createUser } = await import('../services/admin-users.service');
    const result = await createUser(
      { email: 'test@example.com', firstName: 'Jan', lastName: 'Kowalski', role: 'recruiter', isFreelancer: false, sendInvite: true },
      adminActor,
      ctx,
    );

    expect(result.user.id).toBe('user-1');
    expect(result.passwordEmailSent).toBe(false);
    expect(result.temporaryPassword).toBeDefined();
  });

  it('no-login mode: no email, no reset token, inactive, no temp password', async () => {
    vi.mocked(usersRepo.create).mockResolvedValue({ ...baseUserRow, isActive: false });

    const { createUser } = await import('../services/admin-users.service');
    const result = await createUser(
      { email: 'test@example.com', firstName: 'Jan', lastName: 'Kowalski', role: 'recruiter', isFreelancer: false, sendInvite: false },
      adminActor,
      ctx,
    );

    // Created inactive, and none of the invite side effects ran.
    expect(vi.mocked(usersRepo.create).mock.calls[0]?.[0]).toMatchObject({ isActive: false });
    expect(resetRepo.create).not.toHaveBeenCalled();
    expect(resendClient.sendEmail).not.toHaveBeenCalled();
    expect(result.passwordEmailSent).toBe(false);
    expect(result.temporaryPassword).toBeUndefined();
  });

  it('generates an internal placeholder email when none provided', async () => {
    vi.mocked(usersRepo.create).mockResolvedValue({ ...baseUserRow, isActive: false });

    const { createUser } = await import('../services/admin-users.service');
    await createUser(
      { firstName: 'Jan', lastName: 'Testowy', role: 'recruiter', isFreelancer: true, sendInvite: false },
      adminActor,
      ctx,
    );

    const writtenEmail = vi.mocked(usersRepo.create).mock.calls[0]?.[0]?.email as string;
    expect(writtenEmail).toBe('jan-testowy@no-login.crm.local');
    expect(vi.mocked(usersRepo.create).mock.calls[0]?.[0]).toMatchObject({ isFreelancer: true, isActive: false });
    expect(resendClient.sendEmail).not.toHaveBeenCalled();
  });
});

describe('admin-users.service.updateUser', () => {
  it('updates user successfully', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(baseUserRow);
    const updatedRow = { ...baseUserRow, firstName: 'Marek' };
    // updateUser now routes the write through usersRepo.update (busts cache).
    vi.mocked(usersRepo.update).mockResolvedValue(updatedRow);

    const { updateUser } = await import('../services/admin-users.service');
    const result = await updateUser('user-1', { firstName: 'Marek' }, adminActor, ctx);
    expect(result.firstName).toBe('Marek');
    expect(usersRepo.update).toHaveBeenCalledWith('user-1', { firstName: 'Marek' });
  });

  it('throws FORBIDDEN when admin tries to change own role', async () => {
    const { updateUser } = await import('../services/admin-users.service');
    await expect(
      updateUser('admin-1', { role: 'recruiter' }, adminActor, ctx),
    ).rejects.toThrow(AppError);

    try {
      await updateUser('admin-1', { role: 'recruiter' }, adminActor, ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('FORBIDDEN');
      expect((err as AppError).meta?.reason).toBe('self_protection');
    }
  });

  it('throws FORBIDDEN when admin tries to deactivate self', async () => {
    const { updateUser } = await import('../services/admin-users.service');
    await expect(
      updateUser('admin-1', { isActive: false }, adminActor, ctx),
    ).rejects.toThrow(AppError);

    try {
      await updateUser('admin-1', { isActive: false }, adminActor, ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(undefined);
    const { updateUser } = await import('../services/admin-users.service');
    await expect(
      updateUser('nonexistent', { firstName: 'X' }, adminActor, ctx),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('admin-users.service.forceLogout', () => {
  it('deletes all sessions for target user', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(baseUserRow);
    vi.mocked(sessionsRepo.deleteByUserId).mockResolvedValue(3);

    const { forceLogout } = await import('../services/admin-users.service');
    const result = await forceLogout('user-1', adminActor, ctx);

    expect(sessionsRepo.deleteByUserId).toHaveBeenCalledWith('user-1');
    expect(result.sessionsDeleted).toBe(3);
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(undefined);
    const { forceLogout } = await import('../services/admin-users.service');
    await expect(forceLogout('nonexistent', adminActor, ctx)).rejects.toThrow(NotFoundError);
  });

  it('blocks logging yourself out (self-protection)', async () => {
    const { forceLogout } = await import('../services/admin-users.service');
    // adminActor.id = 'admin-1' — pass same id as target
    await expect(forceLogout('admin-1', adminActor, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(sessionsRepo.deleteByUserId).not.toHaveBeenCalled();
  });
});

describe('admin-users.service.deleteUser', () => {
  it('removes the target user', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(baseUserRow);
    vi.mocked(usersRepo.remove).mockResolvedValue(undefined);

    const { deleteUser } = await import('../services/admin-users.service');
    await deleteUser('user-1', adminActor, ctx);

    expect(usersRepo.remove).toHaveBeenCalledWith('user-1');
  });

  it('audits BEFORE removing (RODO traceability)', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(baseUserRow);
    const order: string[] = [];
    const audit = await import('../services/audit.service');
    vi.mocked(audit.log).mockImplementation(async () => { order.push('audit'); });
    vi.mocked(usersRepo.remove).mockImplementation(async () => { order.push('remove'); });

    const { deleteUser } = await import('../services/admin-users.service');
    await deleteUser('user-1', adminActor, ctx);

    expect(order).toEqual(['audit', 'remove']);
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(undefined);
    const { deleteUser } = await import('../services/admin-users.service');
    await expect(deleteUser('nonexistent', adminActor, ctx)).rejects.toThrow(NotFoundError);
    expect(usersRepo.remove).not.toHaveBeenCalled();
  });

  it('blocks deleting yourself (self-protection)', async () => {
    const { deleteUser } = await import('../services/admin-users.service');
    await expect(deleteUser('admin-1', adminActor, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(usersRepo.findById).not.toHaveBeenCalled();
    expect(usersRepo.remove).not.toHaveBeenCalled();
  });

  it('maps FK violation (23503) to a 409 VALIDATION error', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(baseUserRow);
    vi.mocked(usersRepo.remove).mockRejectedValue(
      Object.assign(new Error('fk'), { code: '23503', constraint: 'some_fk' }),
    );

    const { deleteUser } = await import('../services/admin-users.service');
    await expect(deleteUser('user-1', adminActor, ctx)).rejects.toMatchObject({
      code: 'VALIDATION',
      status: 409,
    });
  });
});

describe('admin-users.service.triggerPasswordReset', () => {
  it('creates token and sends email for existing user', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(baseUserRow);
    vi.mocked(resetRepo.create).mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(),
      usedAt: null,
      createdAt: new Date(),
    });
    vi.mocked(emailService.sendPasswordResetEmail).mockResolvedValue(undefined);

    const { triggerPasswordReset } = await import('../services/admin-users.service');
    const result = await triggerPasswordReset('user-1', adminActor, ctx);

    expect(resetRepo.create).toHaveBeenCalledOnce();
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledOnce();
    expect(result.emailSent).toBe(true);
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue(undefined);
    const { triggerPasswordReset } = await import('../services/admin-users.service');
    await expect(triggerPasswordReset('nonexistent', adminActor, ctx)).rejects.toThrow(NotFoundError);
  });
});
