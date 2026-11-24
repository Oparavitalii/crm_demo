import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env vars BEFORE any module imports (env.ts parses process.env at import time)
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

// Mock all dependencies before importing service
vi.mock('../repositories/users.repo', () => ({
  findByEmail: vi.fn(),
  findById: vi.fn(),
  updateLastLogin: vi.fn(),
  recordFailedLogin: vi.fn(),
  lockAccount: vi.fn(),
  updatePasswordHash: vi.fn(),
}));
vi.mock('../repositories/sessions.repo', () => ({
  create: vi.fn(),
  findByTokenHash: vi.fn(),
  findById: vi.fn(),
  deleteById: vi.fn(),
  deleteByUserId: vi.fn(),
  rotate: vi.fn(),
}));
vi.mock('../repositories/password-reset-tokens.repo', () => ({
  create: vi.fn(),
  findValidByHash: vi.fn(),
  markUsed: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../services/email.service', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(null),
  sendAccountLockedEmail: vi.fn().mockResolvedValue(null),
}));

import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import * as resetRepo from '../repositories/password-reset-tokens.repo';
import { hashPassword } from '../lib/bcrypt';
import { AppError } from '../lib/errors';

const baseUser = {
  id: 'user-1',
  email: 'admin@opus-demo.example',
  firstName: 'Admin',
  lastName: 'User',
  role: 'admin' as const,
  isActive: true,
  isFreelancer: false,
  publicSlug: null,
  twoFactorSecret: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth.service.login', () => {
  it('returns user + accessToken + refreshToken on valid credentials', async () => {
    const hash = await hashPassword('correctpassword');
    vi.mocked(usersRepo.findByEmail).mockResolvedValue({ ...baseUser, passwordHash: hash });
    vi.mocked(sessionsRepo.create).mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      rotatedAt: null,
      replacedById: null,
      ip: null,
      userAgent: null,
      createdAt: new Date(),
    });

    const { login } = await import('../services/auth.service');
    const result = await login({ email: 'admin@opus-demo.example', password: 'correctpassword' }, { ip: '1.2.3.4', userAgent: 'jest' });

    expect(result.user.id).toBe('user-1');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect('accessToken' in result && result.accessToken).toMatch(/^eyJ/);
    expect('refreshToken' in result && result.refreshToken).toMatch(/^eyJ/);
    expect(usersRepo.updateLastLogin).toHaveBeenCalledWith('user-1');
  });

  it('throws INVALID_CREDENTIALS on wrong password', async () => {
    const hash = await hashPassword('correctpassword');
    vi.mocked(usersRepo.findByEmail).mockResolvedValue({ ...baseUser, passwordHash: hash });
    vi.mocked(usersRepo.recordFailedLogin).mockResolvedValue(1);

    const { login } = await import('../services/auth.service');
    await expect(
      login({ email: 'admin@opus-demo.example', password: 'WRONG' }, { ip: null, userAgent: null }),
    ).rejects.toThrow(AppError);
    expect(usersRepo.recordFailedLogin).toHaveBeenCalledWith('user-1');
  });

  it('throws INVALID_CREDENTIALS (not enumerable) when user not found', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    const { login } = await import('../services/auth.service');
    await expect(
      login({ email: 'ghost@nowhere', password: 'x' }, { ip: null, userAgent: null }),
    ).rejects.toThrow(/INVALID_CREDENTIALS/);
  });

  it('refuses login when account is locked', async () => {
    const hash = await hashPassword('correctpassword');
    vi.mocked(usersRepo.findByEmail).mockResolvedValue({
      ...baseUser,
      passwordHash: hash,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const { login } = await import('../services/auth.service');
    await expect(
      login({ email: 'admin@opus-demo.example', password: 'correctpassword' }, { ip: null, userAgent: null }),
    ).rejects.toThrow(/INVALID_CREDENTIALS/);
  });

  it('locks account after 10 failed attempts', async () => {
    const hash = await hashPassword('correctpassword');
    vi.mocked(usersRepo.findByEmail).mockResolvedValue({ ...baseUser, passwordHash: hash });
    vi.mocked(usersRepo.recordFailedLogin).mockResolvedValue(10);

    const { login } = await import('../services/auth.service');
    await expect(
      login({ email: 'admin@opus-demo.example', password: 'WRONG' }, { ip: null, userAgent: null }),
    ).rejects.toThrow();
    expect(usersRepo.lockAccount).toHaveBeenCalledWith('user-1', expect.any(Date));
  });
});

describe('auth.service.login (2FA)', () => {
  it('returns partialToken + requires2FA when user has twoFactorSecret', async () => {
    const hash = await hashPassword('correctpassword');
    vi.mocked(usersRepo.findByEmail).mockResolvedValue({
      ...baseUser,
      passwordHash: hash,
      twoFactorSecret: 'SOMESECRET',
    });

    const { login } = await import('../services/auth.service');
    const result = await login(
      { email: 'admin@opus-demo.example', password: 'correctpassword' },
      { ip: null, userAgent: null },
    );

    expect(result).toHaveProperty('requires2FA', true);
    expect(result).toHaveProperty('partialToken');
    expect(result).not.toHaveProperty('accessToken');
  });
});

describe('auth.service.verify2FA', () => {
  it('returns full tokens when code is correct', async () => {
    const { generateSecret, generateSync } = await import('otplib');
    const secret = generateSecret();
    const code = generateSync({ secret, strategy: 'totp' });

    vi.mocked(usersRepo.findById).mockResolvedValue({
      ...baseUser,
      passwordHash: 'x',
      twoFactorSecret: secret,
    });
    vi.mocked(sessionsRepo.create).mockResolvedValue({
      id: 'sess-2',
      userId: 'user-1',
      refreshTokenHash: 'hash',
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      rotatedAt: null,
      replacedById: null,
      ip: null,
      userAgent: null,
      createdAt: new Date(),
    });

    // Issue a real partialToken first
    const { signPartial2FA } = await import('../lib/jwt');
    const partialToken = await signPartial2FA('user-1');

    const { verify2FA } = await import('../services/auth.service');
    const result = await verify2FA(partialToken, code, { ip: null, userAgent: null });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.user.id).toBe('user-1');
  });

  it('throws INVALID_2FA when code is wrong', async () => {
    const { generateSecret } = await import('otplib');
    const secret = generateSecret();

    vi.mocked(usersRepo.findById).mockResolvedValue({
      ...baseUser,
      passwordHash: 'x',
      twoFactorSecret: secret,
    });

    const { signPartial2FA } = await import('../lib/jwt');
    const partialToken = await signPartial2FA('user-1');

    const { verify2FA } = await import('../services/auth.service');
    await expect(
      verify2FA(partialToken, '000000', { ip: null, userAgent: null }),
    ).rejects.toMatchObject({ code: 'INVALID_2FA' });
  });

  it('throws INVALID_2FA when partialToken is tampered', async () => {
    const { verify2FA } = await import('../services/auth.service');
    await expect(
      verify2FA('totally.invalid.token', '123456', { ip: null, userAgent: null }),
    ).rejects.toMatchObject({ code: 'INVALID_2FA' });
  });
});

describe('auth.service.refresh', () => {
  const futureExpiry = () => new Date(Date.now() + 7 * 86400 * 1000);
  const makeSession = (over: Partial<import('../db/tables/users').Session> = {}) => ({
    id: 'sess-1',
    userId: 'user-1',
    refreshTokenHash: 'hash',
    expiresAt: futureExpiry(),
    rotatedAt: null,
    replacedById: null,
    ip: null,
    userAgent: null,
    createdAt: new Date(),
    ...over,
  });

  async function makeRefreshToken(sid = 'sess-1', sub = 'user-1'): Promise<string> {
    const { signRefresh } = await import('../lib/jwt');
    return signRefresh({ sub, sid });
  }

  it('rotates an active session and returns fresh tokens', async () => {
    const token = await makeRefreshToken();
    vi.mocked(sessionsRepo.findByTokenHash).mockResolvedValue(makeSession());
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, passwordHash: 'x' });
    vi.mocked(sessionsRepo.rotate).mockResolvedValue(makeSession({ id: 'sess-new' }));

    const { refresh } = await import('../services/auth.service');
    const result = await refresh(token, { ip: null, userAgent: null });

    expect(result.accessToken).toMatch(/^eyJ/);
    expect(result.refreshToken).toMatch(/^eyJ/);
    expect(sessionsRepo.rotate).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('grace window: rotated token yields an access token for the replacement, refreshToken null', async () => {
    const token = await makeRefreshToken();
    vi.mocked(sessionsRepo.findByTokenHash).mockResolvedValue(
      makeSession({ rotatedAt: new Date(Date.now() - 10_000), replacedById: 'sess-2' }),
    );
    vi.mocked(sessionsRepo.findById).mockResolvedValue(makeSession({ id: 'sess-2' }));
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, passwordHash: 'x' });

    const { refresh } = await import('../services/auth.service');
    const result = await refresh(token, { ip: null, userAgent: null });

    expect(result.accessToken).toMatch(/^eyJ/);
    expect(result.refreshToken).toBeNull();
    expect(result.sessionId).toBe('sess-2');
    expect(sessionsRepo.rotate).not.toHaveBeenCalled();
    expect(sessionsRepo.deleteByUserId).not.toHaveBeenCalled();
  });

  it('reuse outside grace: kills only this lineage, never all user sessions', async () => {
    const token = await makeRefreshToken();
    vi.mocked(sessionsRepo.findByTokenHash).mockResolvedValue(
      makeSession({ rotatedAt: new Date(Date.now() - 5 * 60_000), replacedById: 'sess-2' }),
    );

    const { refresh } = await import('../services/auth.service');
    await expect(refresh(token, { ip: null, userAgent: null })).rejects.toMatchObject({
      code: 'INVALID_REFRESH',
    });

    expect(sessionsRepo.deleteById).toHaveBeenCalledWith('sess-1');
    expect(sessionsRepo.deleteById).toHaveBeenCalledWith('sess-2');
    expect(sessionsRepo.deleteByUserId).not.toHaveBeenCalled();
  });

  it('unknown token hash: plain 401 without nuking sessions', async () => {
    const token = await makeRefreshToken();
    vi.mocked(sessionsRepo.findByTokenHash).mockResolvedValue(undefined);

    const { refresh } = await import('../services/auth.service');
    await expect(refresh(token, { ip: null, userAgent: null })).rejects.toMatchObject({
      code: 'INVALID_REFRESH',
    });

    expect(sessionsRepo.deleteByUserId).not.toHaveBeenCalled();
    expect(sessionsRepo.deleteById).not.toHaveBeenCalled();
  });
});

describe('auth.service.requestPasswordReset', () => {
  it('returns silently if user not found (no enumeration)', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue(undefined);
    const { requestPasswordReset } = await import('../services/auth.service');
    await expect(
      requestPasswordReset('ghost@nowhere', { ip: null, userAgent: null }),
    ).resolves.toBeUndefined();
    expect(resetRepo.create).not.toHaveBeenCalled();
  });

  it('creates reset token + sends email when user found', async () => {
    vi.mocked(usersRepo.findByEmail).mockResolvedValue({ ...baseUser, passwordHash: 'x' });
    vi.mocked(resetRepo.create).mockResolvedValue({} as never);
    const { requestPasswordReset } = await import('../services/auth.service');
    await requestPasswordReset('admin@opus-demo.example', { ip: null, userAgent: null });
    expect(resetRepo.create).toHaveBeenCalled();
  });
});
