import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set env vars BEFORE any module imports
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/users.repo', () => ({
  findById: vi.fn(),
  updateTwoFactorSecret: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/bcrypt', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

import * as usersRepo from '../repositories/users.repo';
import * as bcrypt from '../lib/bcrypt';
import { AppError } from '../lib/errors';
import { generateTotpSecret } from '../lib/totp';

const baseUser = {
  id: 'user-1',
  email: 'admin@crm-demo.example',
  firstName: 'Admin',
  lastName: 'User',
  role: 'admin' as const,
  isActive: true,
  isFreelancer: false,
  publicSlug: null as string | null,
  twoFactorSecret: null as string | null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  passwordHash: 'hash',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ctx = { ip: '1.2.3.4', userAgent: 'test' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('totp.service.startEnrollment', () => {
  it('returns secret + uri + qrCodeDataUrl for un-enrolled user', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, twoFactorSecret: null });
    const { startEnrollment } = await import('../services/totp.service');
    const result = await startEnrollment('user-1');
    expect(result.secret).toBeTruthy();
    expect(result.uri).toContain('otpauth://totp/');
    expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('throws DUPLICATE when user is already enrolled', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({
      ...baseUser,
      twoFactorSecret: 'EXISTINGSECRET',
    });
    const { startEnrollment } = await import('../services/totp.service');
    await expect(startEnrollment('user-1')).rejects.toThrow(AppError);
    await expect(startEnrollment('user-1')).rejects.toMatchObject({ code: 'DUPLICATE' });
  });
});

describe('totp.service.confirmEnrollment', () => {
  it('saves secret when code is valid', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, twoFactorSecret: null });
    vi.mocked(usersRepo.updateTwoFactorSecret).mockResolvedValue(undefined);
    const { confirmEnrollment } = await import('../services/totp.service');

    // Generate a real secret and real code
    const secret = generateTotpSecret();
    const { generateSync } = await import('otplib');
    const code = generateSync({ secret, strategy: 'totp' });

    await expect(confirmEnrollment('user-1', secret, code, ctx)).resolves.toBeUndefined();
    expect(usersRepo.updateTwoFactorSecret).toHaveBeenCalledWith('user-1', secret);
  });

  it('throws INVALID_2FA when code is wrong', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, twoFactorSecret: null });
    const { confirmEnrollment } = await import('../services/totp.service');
    const secret = generateTotpSecret();
    await expect(confirmEnrollment('user-1', secret, '000000', ctx)).rejects.toMatchObject({
      code: 'INVALID_2FA',
    });
  });

  it('throws DUPLICATE if already enrolled at confirm time', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({
      ...baseUser,
      twoFactorSecret: 'ALREADY',
    });
    const { confirmEnrollment } = await import('../services/totp.service');
    await expect(confirmEnrollment('user-1', 'SECRET', '123456', ctx)).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
  });
});

describe('totp.service.disable', () => {
  it('disables 2FA when password + code are correct', async () => {
    const secret = generateTotpSecret();
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, twoFactorSecret: secret });
    vi.mocked(usersRepo.updateTwoFactorSecret).mockResolvedValue(undefined);
    vi.mocked(bcrypt.verifyPassword).mockResolvedValue(true);

    const { generateSync } = await import('otplib');
    const code = generateSync({ secret, strategy: 'totp' });

    const { disable } = await import('../services/totp.service');
    await expect(disable('user-1', 'password', code, ctx)).resolves.toBeUndefined();
    expect(usersRepo.updateTwoFactorSecret).toHaveBeenCalledWith('user-1', null);
  });

  it('throws INVALID_2FA when TOTP code is wrong', async () => {
    const secret = generateTotpSecret();
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, twoFactorSecret: secret });
    vi.mocked(bcrypt.verifyPassword).mockResolvedValue(true);

    const { disable } = await import('../services/totp.service');
    await expect(disable('user-1', 'password', '000000', ctx)).rejects.toMatchObject({
      code: 'INVALID_2FA',
    });
  });

  it('throws INVALID_CREDENTIALS when password is wrong', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({
      ...baseUser,
      twoFactorSecret: generateTotpSecret(),
    });
    vi.mocked(bcrypt.verifyPassword).mockResolvedValue(false);

    const { disable } = await import('../services/totp.service');
    await expect(disable('user-1', 'wrongpw', '123456', ctx)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('returns idempotently if 2FA already disabled', async () => {
    vi.mocked(usersRepo.findById).mockResolvedValue({ ...baseUser, twoFactorSecret: null });
    vi.mocked(bcrypt.verifyPassword).mockResolvedValue(true);

    const { disable } = await import('../services/totp.service');
    await expect(disable('user-1', 'password', '123456', ctx)).resolves.toBeUndefined();
    expect(usersRepo.updateTwoFactorSecret).not.toHaveBeenCalled();
  });
});
