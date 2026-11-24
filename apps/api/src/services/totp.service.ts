import qrcode from 'qrcode';
import { generateTotpSecret, getTotpUri, verifyTotp } from '../lib/totp';
import { AppError, NotFoundError } from '../lib/errors';
import { verifyPassword } from '../lib/bcrypt';
import * as usersRepo from '../repositories/users.repo';
import * as audit from './audit.service';

interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

export async function startEnrollment(
  userId: string,
): Promise<{ secret: string; uri: string; qrCodeDataUrl: string }> {
  const user = await usersRepo.findById(userId);
  if (!user) throw new NotFoundError('user');
  if (user.twoFactorSecret !== null) {
    throw new AppError('DUPLICATE', { reason: 'already_enrolled' }, 400);
  }
  const secret = generateTotpSecret();
  const uri = getTotpUri(user.email, secret);
  const qrCodeDataUrl = await qrcode.toDataURL(uri);
  return { secret, uri, qrCodeDataUrl };
}

export async function confirmEnrollment(
  userId: string,
  secret: string,
  code: string,
  ctx: ReqCtx,
): Promise<void> {
  const user = await usersRepo.findById(userId);
  if (!user) throw new NotFoundError('user');
  if (user.twoFactorSecret !== null) {
    throw new AppError('DUPLICATE', { reason: 'already_enrolled' }, 400);
  }
  if (!verifyTotp(code, secret)) {
    throw new AppError('INVALID_2FA', undefined, 400);
  }
  await usersRepo.updateTwoFactorSecret(userId, secret);
  await audit.log({
    actorId: userId,
    action: 'enable_2fa',
    entityType: 'user',
    entityId: userId,
    ...ctx,
  });
}

export async function disable(
  userId: string,
  password: string,
  code: string,
  ctx: ReqCtx,
): Promise<void> {
  const user = await usersRepo.findById(userId);
  if (!user) throw new NotFoundError('user');

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    throw new AppError('INVALID_CREDENTIALS', undefined, 401);
  }

  // Idempotent — already disabled
  if (user.twoFactorSecret === null) {
    return;
  }

  if (!verifyTotp(code, user.twoFactorSecret)) {
    throw new AppError('INVALID_2FA', undefined, 400);
  }

  await usersRepo.updateTwoFactorSecret(userId, null);
  await audit.log({
    actorId: userId,
    action: 'disable_2fa',
    entityType: 'user',
    entityId: userId,
    ...ctx,
  });
}
