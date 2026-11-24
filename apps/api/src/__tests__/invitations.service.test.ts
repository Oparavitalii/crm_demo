import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';
process.env.APP_URL = 'http://localhost:5173';

// Build a chainable Drizzle query mock that resolves to a given value when awaited.
function makeThenableChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'where', 'orderBy', 'limit', 'leftJoin', 'set'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(resolve);
  chain.catch = (reject: (e: unknown) => unknown) => Promise.resolve(resolvedValue).catch(reject);
  chain.finally = (cb: () => void) => Promise.resolve(resolvedValue).finally(cb);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/client', () => ({
  db: {
    get select() { return mockSelect; },
    get insert() { return mockInsert; },
    get update() { return mockUpdate; },
  },
}));

vi.mock('../repositories/invitations.repo', () => ({
  create: vi.fn(),
  findValidByHash: vi.fn(),
  findPendingByEmail: vi.fn(),
  findAll: vi.fn(),
  findById: vi.fn(),
  markAccepted: vi.fn(),
  deleteById: vi.fn(),
  deleteExpired: vi.fn(),
}));

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
}));

vi.mock('../services/audit.service', () => ({ log: vi.fn() }));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/email.service', () => ({
  sendInvitationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendAccountLockedEmail: vi.fn(),
}));

vi.mock('../lib/bcrypt', () => ({
  hashPassword: vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
  verifyPassword: vi.fn(),
}));

import * as invitationsRepo from '../repositories/invitations.repo';
import * as usersRepo from '../repositories/users.repo';
import * as emailService from '../services/email.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../lib/errors';

const sha256Hex = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

const adminActor = {
  id: 'admin-1',
  firstName: 'Jan',
  lastName: 'Admin',
  role: 'admin' as const,
};
const ctx = { ip: null, userAgent: null };

const baseInvitation = {
  id: 'inv-1',
  email: 'new@example.com',
  firstName: 'Piotr',
  lastName: 'Nowak',
  role: 'recruiter' as const,
  tokenHash: 'somehash',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  invitedById: 'admin-1',
  acceptedAt: null,
  createdAt: new Date(),
};

const baseUserRow = {
  id: 'user-1',
  email: 'new@example.com',
  firstName: 'Piotr',
  lastName: 'Nowak',
  role: 'recruiter' as const,
  isActive: true,
  isFreelancer: false,
  publicSlug: null,
  passwordHash: '$2b$12$hash',
  twoFactorSecret: null,
  lastLoginAt: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invitations.service.createInvitation', () => {
  it('creates invitation successfully when user does not exist and no pending invite', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findPendingByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.create).mockResolvedValue(baseInvitation);
    vi.mocked(emailService.sendInvitationEmail).mockResolvedValue(undefined);

    const { createInvitation } = await import('../services/invitations.service');
    const result = await createInvitation(
      { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
      adminActor,
      ctx,
    );

    expect(invitationsRepo.create).toHaveBeenCalledOnce();
    expect(emailService.sendInvitationEmail).toHaveBeenCalledOnce();
    expect(result.emailSent).toBe(true);
    expect(result.inviteUrl).toBeNull(); // URL not returned when email sent
    expect(result.email).toBe('new@example.com');
  });

  it('throws DUPLICATE when user already exists with that email', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(baseUserRow);

    const { createInvitation } = await import('../services/invitations.service');
    await expect(
      createInvitation(
        { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
        adminActor,
        ctx,
      ),
    ).rejects.toThrow(AppError);

    try {
      await createInvitation(
        { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
        adminActor,
        ctx,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('DUPLICATE');
      expect((err as AppError).status).toBe(409);
    }
  });

  it('throws DUPLICATE when pending invitation for this email already exists', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findPendingByEmail).mockResolvedValue(baseInvitation);

    const { createInvitation } = await import('../services/invitations.service');
    await expect(
      createInvitation(
        { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
        adminActor,
        ctx,
      ),
    ).rejects.toThrow(AppError);

    try {
      await createInvitation(
        { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
        adminActor,
        ctx,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('DUPLICATE');
      expect((err as AppError).meta?.reason).toBe('invitation_pending');
    }
  });

  it('returns inviteUrl when email send fails', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findPendingByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.create).mockResolvedValue(baseInvitation);
    vi.mocked(emailService.sendInvitationEmail).mockRejectedValue(new Error('SMTP down'));

    const { createInvitation } = await import('../services/invitations.service');
    const result = await createInvitation(
      { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
      adminActor,
      ctx,
    );

    expect(result.emailSent).toBe(false);
    expect(result.inviteUrl).not.toBeNull();
    expect(result.inviteUrl).toContain('/register?token=');
  });
});

describe('invitations.service.acceptInvitation', () => {
  it('creates user and marks invitation accepted on success', async () => {
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(baseInvitation);
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(usersRepo.create).mockResolvedValue(baseUserRow);
    vi.mocked(invitationsRepo.markAccepted).mockResolvedValue(undefined);

    const { acceptInvitation } = await import('../services/invitations.service');
    const result = await acceptInvitation(
      { token: 'a'.repeat(43), password: 'SuperSecret123!' },
      ctx,
    );

    expect(usersRepo.create).toHaveBeenCalledOnce();
    expect(invitationsRepo.markAccepted).toHaveBeenCalledWith('inv-1');
    expect(result.userId).toBe('user-1');
    expect(result.email).toBe('new@example.com');
  });

  it('throws INVALID_TOKEN for invalid or expired token', async () => {
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(undefined);

    const { acceptInvitation } = await import('../services/invitations.service');
    await expect(
      acceptInvitation({ token: 'a'.repeat(43), password: 'SuperSecret123!' }, ctx),
    ).rejects.toThrow(AppError);

    try {
      await acceptInvitation({ token: 'a'.repeat(43), password: 'SuperSecret123!' }, ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_TOKEN');
      expect((err as AppError).status).toBe(400);
    }
  });

  it('throws ALREADY_ACTIVE when matching user already exists and is active', async () => {
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(baseInvitation);
    // baseUserRow.isActive is true — simulates a fully-registered account.
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(baseUserRow);

    const { acceptInvitation } = await import('../services/invitations.service');
    await expect(
      acceptInvitation({ token: 'a'.repeat(43), password: 'SuperSecret123!' }, ctx),
    ).rejects.toThrow(AppError);

    try {
      await acceptInvitation({ token: 'a'.repeat(43), password: 'SuperSecret123!' }, ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('ALREADY_ACTIVE');
      expect((err as AppError).status).toBe(409);
    }
  });
});

describe('invitations.service.createInvitation — admin-only guard', () => {
  const inputForRole = {
    email: 'new@example.com',
    firstName: 'Piotr',
    lastName: 'Nowak',
    role: 'recruiter' as const,
  };

  it.each([
    ['recruiter' as const, 'rec-1'],
    ['coordinator' as const, 'coord-1'],
    ['readonly' as const, 'read-1'],
  ])('rejects %s actor with FORBIDDEN and writes NO row, audit, or email', async (role, id) => {
    const { createInvitation } = await import('../services/invitations.service');
    await expect(
      createInvitation(inputForRole, { id, firstName: 'X', lastName: 'Y', role }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    // No side effects: no DB insert, no audit, no email, no email lookup.
    expect(invitationsRepo.create).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(emailService.sendInvitationEmail).not.toHaveBeenCalled();
    expect(usersRepo.findByEmail).not.toHaveBeenCalled();
    expect(invitationsRepo.findPendingByEmail).not.toHaveBeenCalled();
  });
});

describe('invitations.service.createInvitation — token hashing', () => {
  it('stores a sha256 tokenHash (NOT the raw token) and uses 7-day expiresAt', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findPendingByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.create).mockResolvedValue(baseInvitation);
    vi.mocked(emailService.sendInvitationEmail).mockResolvedValue(undefined);

    const fixedNow = new Date('2026-06-14T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const { createInvitation } = await import('../services/invitations.service');
    const result = await createInvitation(
      { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
      adminActor,
      ctx,
    );

    expect(invitationsRepo.create).toHaveBeenCalledOnce();
    const createArgs = vi.mocked(invitationsRepo.create).mock.calls[0]?.[0];
    expect(createArgs).toBeDefined();
    // tokenHash is a 64-char hex sha256 digest
    expect(createArgs?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    // The plaintext token MUST be present in the URL, but MUST NOT equal the stored hash.
    const url = result.emailSent
      ? // when emailSent is true, the URL is hidden in the response, so derive it from the spy call
        vi.mocked(emailService.sendInvitationEmail).mock.calls[0]?.[1] ?? ''
      : (result.inviteUrl ?? '');
    expect(url).toContain('/register?token=');
    const rawToken = new URL(url).searchParams.get('token') ?? '';
    expect(rawToken).not.toBe(createArgs?.tokenHash);
    expect(createArgs?.tokenHash).toBe(sha256Hex(rawToken));
    // Raw token must NOT appear anywhere in the persisted row
    const persistedJson = JSON.stringify(createArgs);
    expect(persistedJson).not.toContain(rawToken);

    // expiresAt is 7 days from "now"
    const expectedExpiry = fixedNow + 7 * 24 * 60 * 60 * 1000;
    expect(createArgs?.expiresAt).toBeInstanceOf(Date);
    expect((createArgs?.expiresAt as Date).getTime()).toBe(expectedExpiry);

    // invitedById = admin actor id
    expect(createArgs?.invitedById).toBe('admin-1');
  });

  it('lowercases and trims the email before persisting and audit', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findPendingByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.create).mockResolvedValue(baseInvitation);
    vi.mocked(emailService.sendInvitationEmail).mockResolvedValue(undefined);

    const { createInvitation } = await import('../services/invitations.service');
    await createInvitation(
      { email: '  NEW@Example.COM  ', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
      adminActor,
      ctx,
    );

    expect(usersRepo.findByEmail).toHaveBeenCalledWith('new@example.com');
    const createArgs = vi.mocked(invitationsRepo.create).mock.calls[0]?.[0];
    expect(createArgs?.email).toBe('new@example.com');
  });
});

describe('invitations.service.createInvitation — audit shape', () => {
  it('writes one audit row with action=invite_user, entityType=user, after the DB insert', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findPendingByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.create).mockResolvedValue(baseInvitation);
    vi.mocked(emailService.sendInvitationEmail).mockResolvedValue(undefined);

    const callOrder: string[] = [];
    vi.mocked(invitationsRepo.create).mockImplementation(async () => {
      callOrder.push('create');
      return baseInvitation;
    });
    vi.mocked(auditService.log).mockImplementation(async () => {
      callOrder.push('audit');
    });

    const { createInvitation } = await import('../services/invitations.service');
    await createInvitation(
      { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
      adminActor,
      ctx,
    );

    // Audit must run AFTER the row exists (so we never log an invite that wasn't persisted).
    expect(callOrder).toEqual(['create', 'audit']);

    expect(auditService.log).toHaveBeenCalledOnce();
    const auditArgs = vi.mocked(auditService.log).mock.calls[0]?.[0];
    expect(auditArgs).toMatchObject({
      actorId: 'admin-1',
      action: 'invite_user',
      entityType: 'user',
    });

    // Audit payload locks current behaviour: email + role are recorded for traceability.
    // It must NEVER include the raw token, password, or tokenHash.
    const serialized = JSON.stringify(auditArgs?.newValue);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/password/i);
    expect(auditArgs?.newValue).toMatchObject({ role: 'recruiter' });
  });

  it('does NOT audit if invitationsRepo.create throws (no orphan audit row)', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findPendingByEmail).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.create).mockRejectedValue(new Error('db down'));

    const { createInvitation } = await import('../services/invitations.service');
    await expect(
      createInvitation(
        { email: 'new@example.com', firstName: 'Piotr', lastName: 'Nowak', role: 'recruiter' },
        adminActor,
        ctx,
      ),
    ).rejects.toThrow('db down');

    expect(auditService.log).not.toHaveBeenCalled();
    expect(emailService.sendInvitationEmail).not.toHaveBeenCalled();
  });
});

describe('invitations.service.acceptInvitation — TTL boundary', () => {
  it('rejects a just-expired invitation (1s past) with INVALID_TOKEN', async () => {
    // findValidByHash filters expired rows server-side; simulate that contract.
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(undefined);

    const { acceptInvitation } = await import('../services/invitations.service');
    await expect(
      acceptInvitation({ token: 'b'.repeat(43), password: 'SuperSecret123!' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 400 });

    // No user side-effects on rejected accept.
    expect(usersRepo.create).not.toHaveBeenCalled();
    expect(invitationsRepo.markAccepted).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('rejects a long-expired invitation (30 days past) with INVALID_TOKEN', async () => {
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(undefined);

    const { acceptInvitation } = await import('../services/invitations.service');
    await expect(
      acceptInvitation({ token: 'c'.repeat(43), password: 'SuperSecret123!' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 400 });

    expect(usersRepo.create).not.toHaveBeenCalled();
    expect(invitationsRepo.markAccepted).not.toHaveBeenCalled();
  });

  it('hashes the submitted token before the lookup (raw token never queried)', async () => {
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(undefined);

    const rawToken = 'raw-token-' + 'd'.repeat(33);
    const { acceptInvitation } = await import('../services/invitations.service');
    await expect(
      acceptInvitation({ token: rawToken, password: 'SuperSecret123!' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });

    expect(invitationsRepo.findValidByHash).toHaveBeenCalledWith(sha256Hex(rawToken));
    // Defence-in-depth: the raw token must NEVER reach the repo layer.
    expect(invitationsRepo.findValidByHash).not.toHaveBeenCalledWith(rawToken);
  });
});

describe('invitations.service.acceptInvitation — single-use enforcement', () => {
  it('a second accept with the same token is rejected with INVALID_TOKEN and writes nothing', async () => {
    // First call: returns a valid invitation. Second call: repo returns undefined
    // because findValidByHash filters out accepted rows (isNull(accepted_at)).
    vi.mocked(invitationsRepo.findValidByHash)
      .mockResolvedValueOnce(baseInvitation)
      .mockResolvedValueOnce(undefined);
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(usersRepo.findByPublicSlug).mockResolvedValue(undefined);
    vi.mocked(usersRepo.create).mockResolvedValue(baseUserRow);
    vi.mocked(invitationsRepo.markAccepted).mockResolvedValue(undefined);

    const { acceptInvitation } = await import('../services/invitations.service');

    // First call succeeds.
    const ok = await acceptInvitation(
      { token: 'a'.repeat(43), password: 'SuperSecret123!' },
      ctx,
    );
    expect(ok.userId).toBe('user-1');
    expect(invitationsRepo.markAccepted).toHaveBeenCalledTimes(1);
    expect(usersRepo.create).toHaveBeenCalledTimes(1);

    // Second call rejects: state is unchanged after the throw.
    await expect(
      acceptInvitation({ token: 'a'.repeat(43), password: 'SuperSecret123!' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 400 });

    expect(invitationsRepo.markAccepted).toHaveBeenCalledTimes(1);
    expect(usersRepo.create).toHaveBeenCalledTimes(1);
  });
});

describe('invitations.service.acceptInvitation — reactivation of pre-seeded user', () => {
  it('updates the existing inactive user in place rather than creating a duplicate', async () => {
    const inactiveUser = { ...baseUserRow, isActive: false };
    const reactivated = { ...baseUserRow, isActive: true };

    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(baseInvitation);
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(inactiveUser);
    vi.mocked(invitationsRepo.markAccepted).mockResolvedValue(undefined);

    // Reactivation now routes through usersRepo.update (which busts the cache).
    vi.mocked(usersRepo.update).mockResolvedValue(reactivated);

    const { acceptInvitation } = await import('../services/invitations.service');
    const result = await acceptInvitation(
      { token: 'a'.repeat(43), password: 'SuperSecret123!' },
      ctx,
    );

    expect(result.userId).toBe('user-1');
    // No new user inserted on the reactivation path.
    expect(usersRepo.create).not.toHaveBeenCalled();
    // Invitation is still marked accepted (single-use).
    expect(invitationsRepo.markAccepted).toHaveBeenCalledWith('inv-1');

    // Audit row on accept references the reactivated user id.
    expect(auditService.log).toHaveBeenCalledOnce();
    const auditArgs = vi.mocked(auditService.log).mock.calls[0]?.[0];
    expect(auditArgs).toMatchObject({
      action: 'user.register',
      entityType: 'user',
      entityId: 'user-1',
      actorId: 'user-1',
    });
    expect(auditArgs?.newValue).toMatchObject({ reactivated: true });
  });
});

describe('invitations.service.acceptInvitation — audit on happy path', () => {
  it('writes an audit row with action=user.register pointing at the new user', async () => {
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(baseInvitation);
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    vi.mocked(usersRepo.findByPublicSlug).mockResolvedValue(undefined);
    vi.mocked(usersRepo.create).mockResolvedValue(baseUserRow);
    vi.mocked(invitationsRepo.markAccepted).mockResolvedValue(undefined);

    const order: string[] = [];
    vi.mocked(usersRepo.create).mockImplementation(async () => {
      order.push('user.create');
      return baseUserRow;
    });
    vi.mocked(invitationsRepo.markAccepted).mockImplementation(async () => {
      order.push('markAccepted');
    });
    vi.mocked(auditService.log).mockImplementation(async () => {
      order.push('audit');
    });

    const { acceptInvitation } = await import('../services/invitations.service');
    await acceptInvitation(
      { token: 'a'.repeat(43), password: 'SuperSecret123!' },
      ctx,
    );

    // Ordering: user must exist, then invitation marked, then audit.
    expect(order).toEqual(['user.create', 'markAccepted', 'audit']);

    expect(auditService.log).toHaveBeenCalledOnce();
    const auditArgs = vi.mocked(auditService.log).mock.calls[0]?.[0];
    expect(auditArgs).toMatchObject({
      actorId: 'user-1',
      action: 'user.register',
      entityType: 'user',
      entityId: 'user-1',
    });
    // Password and token never leak into the audit payload.
    const serialized = JSON.stringify(auditArgs);
    expect(serialized).not.toMatch(/SuperSecret123/);
    expect(serialized).not.toMatch(/token/i);
  });
});

describe('invitations.service.resendInvitation', () => {
  it('admin happy path: creates fresh row with NEW tokenHash WITHOUT invalidating the old link, sends email', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    const newInvitation = { ...baseInvitation, id: 'inv-2', tokenHash: 'newhash' };
    vi.mocked(invitationsRepo.create).mockResolvedValue(newInvitation);
    vi.mocked(emailService.sendInvitationEmail).mockResolvedValue(undefined);

    const fixedNow = new Date('2026-06-14T12:00:00.000Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const { resendInvitation } = await import('../services/invitations.service');
    const result = await resendInvitation('inv-1', adminActor, ctx);

    // The previous row is left untouched so its link keeps working until the
    // natural 7-day expiry — resend must NOT soft-expire it (db.update unused).
    expect(mockUpdate).not.toHaveBeenCalled();

    // Fresh invitation row inserted
    expect(invitationsRepo.create).toHaveBeenCalledOnce();
    const createArgs = vi.mocked(invitationsRepo.create).mock.calls[0]?.[0];
    expect(createArgs).toBeDefined();

    // The new tokenHash must NOT equal the old tokenHash
    expect(createArgs?.tokenHash).not.toBe(baseInvitation.tokenHash);
    // And it must be a valid sha256 hex digest
    expect(createArgs?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    // expiresAt is 7 days from "now"
    const expectedExpiry = fixedNow + 7 * 24 * 60 * 60 * 1000;
    expect((createArgs?.expiresAt as Date).getTime()).toBe(expectedExpiry);

    // Email sent with the same recipient as the original invitation
    expect(emailService.sendInvitationEmail).toHaveBeenCalledOnce();
    expect(emailService.sendInvitationEmail).toHaveBeenCalledWith(
      baseInvitation.email,
      expect.stringContaining('/register?token='),
      expect.any(String),
    );

    expect(result.emailSent).toBe(true);
    expect(result.inviteUrl).toBeNull(); // hidden when email delivered
    expect(result.email).toBe(baseInvitation.email);
    expect(result.id).toBe('inv-2');
  });

  it('exposes inviteUrl when the resend email fails (so admin can copy it manually)', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    mockUpdate.mockReturnValue(makeThenableChain([]));
    vi.mocked(invitationsRepo.create).mockResolvedValue({ ...baseInvitation, id: 'inv-2' });
    vi.mocked(emailService.sendInvitationEmail).mockRejectedValue(new Error('SMTP boom'));

    const { resendInvitation } = await import('../services/invitations.service');
    const result = await resendInvitation('inv-1', adminActor, ctx);

    expect(result.emailSent).toBe(false);
    expect(result.inviteUrl).not.toBeNull();
    expect(result.inviteUrl).toContain('/register?token=');
  });

  it('throws NOT_FOUND when the invitation id does not exist', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(undefined);

    const { resendInvitation } = await import('../services/invitations.service');
    await expect(resendInvitation('missing-id', adminActor, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });

    // No side effects
    expect(invitationsRepo.create).not.toHaveBeenCalled();
    expect(emailService.sendInvitationEmail).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('throws ALREADY_ACTIVE when the invitation was already accepted', async () => {
    const accepted = { ...baseInvitation, acceptedAt: new Date() };
    vi.mocked(invitationsRepo.findById).mockResolvedValue(accepted);

    const { resendInvitation } = await import('../services/invitations.service');
    await expect(resendInvitation('inv-1', adminActor, ctx)).rejects.toMatchObject({
      code: 'ALREADY_ACTIVE',
      status: 409,
    });

    expect(invitationsRepo.create).not.toHaveBeenCalled();
    expect(emailService.sendInvitationEmail).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('writes audit user.resend_invite on invitation entity, without leaking raw token/hash values', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    mockUpdate.mockReturnValue(makeThenableChain([]));
    const newInvitation = { ...baseInvitation, id: 'inv-2', tokenHash: 'newhash' };
    vi.mocked(invitationsRepo.create).mockResolvedValue(newInvitation);
    vi.mocked(emailService.sendInvitationEmail).mockResolvedValue(undefined);

    const { resendInvitation } = await import('../services/invitations.service');
    await resendInvitation('inv-1', adminActor, ctx);

    expect(auditService.log).toHaveBeenCalledOnce();
    const auditArgs = vi.mocked(auditService.log).mock.calls[0]?.[0];
    expect(auditArgs).toMatchObject({
      actorId: 'admin-1',
      action: 'user.resend_invite',
      entityType: 'invitation',
      entityId: 'inv-2',
    });

    // newValue includes emailSent flag — but no raw token, no tokenHash
    const serialized = JSON.stringify(auditArgs);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toContain('newhash');
    expect(serialized).not.toContain(baseInvitation.tokenHash);
    expect(auditArgs?.newValue).toMatchObject({
      email: baseInvitation.email,
      emailSent: true,
    });
  });

  it('rejects non-admin actors with FORBIDDEN before touching the DB', async () => {
    const { resendInvitation } = await import('../services/invitations.service');
    await expect(
      resendInvitation('inv-1', { id: 'r-1', firstName: 'X', lastName: 'Y', role: 'recruiter' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    expect(invitationsRepo.findById).not.toHaveBeenCalled();
    expect(invitationsRepo.create).not.toHaveBeenCalled();
    expect(emailService.sendInvitationEmail).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('persists a sha256 tokenHash whose plaintext appears in the URL but not in the row', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    mockUpdate.mockReturnValue(makeThenableChain([]));
    vi.mocked(invitationsRepo.create).mockResolvedValue({ ...baseInvitation, id: 'inv-2' });
    // Force email failure so inviteUrl is returned and we can extract the raw token.
    vi.mocked(emailService.sendInvitationEmail).mockRejectedValue(new Error('SMTP'));

    const { resendInvitation } = await import('../services/invitations.service');
    const result = await resendInvitation('inv-1', adminActor, ctx);

    const url = result.inviteUrl ?? '';
    const rawToken = new URL(url).searchParams.get('token') ?? '';
    expect(rawToken.length).toBeGreaterThan(20);

    const createArgs = vi.mocked(invitationsRepo.create).mock.calls[0]?.[0];
    expect(createArgs?.tokenHash).toBe(sha256Hex(rawToken));
    // The persisted row must NOT contain the raw token anywhere.
    expect(JSON.stringify(createArgs)).not.toContain(rawToken);
  });
});

describe('invitations.service.revokeInvitation', () => {
  it('admin happy path: deletes the invitation row and writes the audit entry', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    vi.mocked(invitationsRepo.deleteById).mockResolvedValue(undefined);

    const { revokeInvitation } = await import('../services/invitations.service');
    await revokeInvitation('inv-1', adminActor, ctx);

    expect(invitationsRepo.deleteById).toHaveBeenCalledWith('inv-1');
    expect(auditService.log).toHaveBeenCalledOnce();
  });

  it('writes audit revoke_invitation with email + role, without raw token data', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    vi.mocked(invitationsRepo.deleteById).mockResolvedValue(undefined);

    const { revokeInvitation } = await import('../services/invitations.service');
    await revokeInvitation('inv-1', adminActor, ctx);

    const auditArgs = vi.mocked(auditService.log).mock.calls[0]?.[0];
    expect(auditArgs).toMatchObject({
      actorId: 'admin-1',
      action: 'revoke_invitation',
      entityType: 'user',
    });
    expect(auditArgs?.newValue).toMatchObject({
      email: baseInvitation.email,
      role: baseInvitation.role,
    });
    // tokenHash and raw token must never appear in the audit payload.
    const serialized = JSON.stringify(auditArgs);
    expect(serialized).not.toMatch(/tokenHash/);
    expect(serialized).not.toContain(baseInvitation.tokenHash);
  });

  it('throws NOT_FOUND when the invitation id does not exist (no delete, no audit)', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(undefined);

    const { revokeInvitation } = await import('../services/invitations.service');
    await expect(revokeInvitation('missing-id', adminActor, ctx)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });

    expect(invitationsRepo.deleteById).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('rejects non-admin actors with FORBIDDEN before any DB lookup', async () => {
    const { revokeInvitation } = await import('../services/invitations.service');
    await expect(
      revokeInvitation('inv-1', { id: 'c-1', firstName: 'X', lastName: 'Y', role: 'coordinator' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    expect(invitationsRepo.findById).not.toHaveBeenCalled();
    expect(invitationsRepo.deleteById).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('after revoke, the old token can no longer be redeemed via acceptInvitation', async () => {
    // Simulate the post-delete state: findValidByHash returns nothing for the hash
    // of the (now deleted) invitation's token.
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    vi.mocked(invitationsRepo.deleteById).mockResolvedValue(undefined);
    vi.mocked(invitationsRepo.findValidByHash).mockResolvedValue(undefined);

    const { revokeInvitation, acceptInvitation } = await import('../services/invitations.service');
    await revokeInvitation('inv-1', adminActor, ctx);

    // Whatever token the admin had emailed earlier must now fail to redeem.
    await expect(
      acceptInvitation({ token: 'a'.repeat(43), password: 'SuperSecret123!' }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN', status: 400 });

    expect(usersRepo.create).not.toHaveBeenCalled();
    expect(invitationsRepo.markAccepted).not.toHaveBeenCalled();
  });

  it('audit runs BEFORE deleteById — survives if delete fails (docs/Engineering_Rules.md audit-before-delete rule)', async () => {
    vi.mocked(invitationsRepo.findById).mockResolvedValue(baseInvitation);
    const order: string[] = [];
    vi.mocked(invitationsRepo.deleteById).mockImplementation(async () => {
      order.push('delete');
    });
    vi.mocked(auditService.log).mockImplementation(async () => {
      order.push('audit');
    });

    const { revokeInvitation } = await import('../services/invitations.service');
    await revokeInvitation('inv-1', adminActor, ctx);

    expect(order).toEqual(['audit', 'delete']);
  });
});
