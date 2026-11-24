import { randomBytes, randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/tables/users';
import type { User } from '../db/tables/users';
import * as usersRepo from '../repositories/users.repo';
import * as sessionsRepo from '../repositories/sessions.repo';
import * as resetRepo from '../repositories/password-reset-tokens.repo';
import * as audit from './audit.service';
import { hashPassword } from '../lib/bcrypt';
import { sha256 } from '../lib/hash';
import { resolveDateRange } from '../lib/date-range';
import { sendPasswordResetEmail } from './email.service';
import { sendEmail } from '../clients/resend.client';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import type {
  ListUsersQuery,
  AdminUser,
  CreateUserInput,
  UpdateUserInput,
} from '@crm/shared';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}

interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

function toAdminUser(u: User): AdminUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
    isFreelancer: u.isFreelancer,
    publicSlug: u.publicSlug,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    has2FA: u.twoFactorSecret !== null,
    updatedAt: u.updatedAt.toISOString(),
    failedLoginAttempts: u.failedLoginAttempts,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
  };
}

// Pick a slug for a new user. Loops with -2, -3, ... suffixes until the
// uniqueness constraint stops complaining; collisions are vanishingly rare
// (only family/coworkers with identical first+last name).
async function pickUniqueSlug(firstName: string, lastName: string): Promise<string> {
  const { buildUserSlug } = await import('../lib/slugify');
  const base = buildUserSlug(firstName, lastName);
  let candidate = base;
  let n = 2;
  // Re-query each iteration — race window is tiny and a duplicate on insert
  // still safely throws (the DB has the unique index).
  while (await usersRepo.findByPublicSlug(candidate)) {
    candidate = `${base}-${n++}`;
    if (n > 50) {
      // 50 same-name collisions is implausible; bail loudly.
      throw new Error(`Could not allocate public_slug for "${firstName} ${lastName}"`);
    }
  }
  return candidate;
}

export async function listUsers(
  query: ListUsersQuery,
  _actor: Actor,
): Promise<{ items: AdminUser[]; total: number; page: number; pageSize: number }> {
  const where: SQL[] = [];

  if (query.role) where.push(eq(users.role, query.role));
  if (query.isActive !== undefined) where.push(eq(users.isActive, query.isActive));
  if (query.isFreelancer !== undefined) where.push(eq(users.isFreelancer, query.isFreelancer));
  if (query.has2fa === true) where.push(isNotNull(users.twoFactorSecret));
  if (query.has2fa === false) where.push(isNull(users.twoFactorSecret));
  if (query.q) {
    const term = `%${query.q}%`;
    where.push(
      or(
        ilike(users.email, term),
        ilike(users.firstName, term),
        ilike(users.lastName, term),
      )!,
    );
  }

  const { since, until } = resolveDateRange({
    preset: query.preset,
    from: query.from,
    to: query.to,
  });
  if (since) where.push(gte(users.createdAt, since));
  if (until) where.push(lt(users.createdAt, until));

  const condition = where.length ? and(...where) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db.query.users.findMany({
      where: condition,
      orderBy: desc(users.createdAt),
      limit: query.pageSize,
      offset,
    }),
    db.select({ c: count() }).from(users).where(condition).then((r) => r[0]),
  ]);

  return {
    items: rows.map(toAdminUser),
    total: totalRow?.c ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getUser(id: string, _actor: Actor): Promise<AdminUser> {
  const user = await usersRepo.findById(id);
  if (!user) throw new NotFoundError('user');
  return toAdminUser(user);
}

// Build a non-deliverable internal email for no-login accounts created without
// one (freelancers used purely as source tags). Satisfies the NOT NULL/unique
// email column without a migration. Mirrors the historical freelancer-import
// script's placeholder approach; the .local TLD guarantees it never resolves.
async function buildPlaceholderEmail(firstName: string, lastName: string): Promise<string> {
  const { buildUserSlug } = await import('../lib/slugify');
  const local = buildUserSlug(firstName, lastName); // ascii, dash-separated
  let candidate = `${local}@no-login.crm.local`;
  let n = 2;
  while (await usersRepo.findByEmail(candidate)) {
    candidate = `${local}-${n++}@no-login.crm.local`;
    if (n > 50) throw new Error(`Could not allocate placeholder email for "${firstName} ${lastName}"`);
  }
  return candidate;
}

export async function createUser(
  input: CreateUserInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ user: AdminUser; passwordEmailSent: boolean; temporaryPassword?: string }> {
  const sendInvite = input.sendInvite ?? true;

  // Resolve the email. A provided address is validated for uniqueness (the
  // pre-check avoids a raw 500 on the unique-violation, see mcp_test M10). With
  // no email (no-login mode) we mint an internal placeholder instead.
  let email = input.email?.toLowerCase().trim();
  if (email) {
    const existing = await usersRepo.findByEmail(email);
    if (existing) {
      throw new AppError('DUPLICATE', { entity: 'user', field: 'email' }, 409);
    }
  } else {
    email = await buildPlaceholderEmail(input.firstName, input.lastName);
  }

  // Generate a random password — for invite accounts the admin never sees it
  // (unless the email send fails); for no-login accounts it's simply unusable.
  const temporaryPassword = randomBytes(16).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  const publicSlug = await pickUniqueSlug(input.firstName, input.lastName);

  const row = await usersRepo.create({
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role,
    isFreelancer: input.isFreelancer,
    passwordHash,
    // Invite → active (user logs in after setting a password). No-login →
    // inactive, so the account can never authenticate (it's a source tag).
    isActive: sendInvite,
    publicSlug,
  });

  let passwordEmailSent = false;
  let returnTemporaryPassword: string | undefined;

  if (sendInvite) {
    // Try sending welcome email with password reset link
    try {
      const token = randomUUID() + randomUUID();
      const tokenHash = sha256(token);
      await resetRepo.create({
        userId: row.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });

      const result = await sendNewAccountEmail(row.email, row.firstName, token);
      passwordEmailSent = result !== null;
    } catch (err) {
      logger.error({ err, userId: row.id }, 'Failed to send new account email');
    }

    if (!passwordEmailSent) {
      // Return temporary password so admin can hand-deliver to user
      returnTemporaryPassword = temporaryPassword;
    }
  }
  // No-login mode: no reset token, no email, no password to hand out.

  await audit.log({
    actorId: actor.id,
    action: 'create_user',
    entityType: 'user',
    entityId: row.id,
    newValue: {
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      isFreelancer: row.isFreelancer,
      sendInvite,
    },
    ...ctx,
  });

  return {
    user: toAdminUser(row),
    passwordEmailSent,
    temporaryPassword: returnTemporaryPassword,
  };
}

async function sendNewAccountEmail(to: string, firstName: string, token: string): Promise<{ id: string } | null> {
  const { env } = await import('../env');
  const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'CRM Demo — Twoje konto zostało utworzone',
    html: `
      <p>Witaj ${firstName},</p>
      <p>Administrator CRM Demo utworzył dla Ciebie konto.</p>
      <p><a href="${url}">Kliknij tutaj, aby ustawić hasło</a> (link ważny 1 godzinę).</p>
      <p>Po ustawieniu hasła możesz zalogować się do systemu.</p>
    `,
    text: `Witaj ${firstName},\n\nAdministrator CRM Demo utworzył dla Ciebie konto.\n\nOtwórz link, aby ustawić hasło (ważny 1h): ${url}`,
  });
}

export async function updateUser(
  id: string,
  patch: UpdateUserInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<AdminUser> {
  // Self-protection: cannot change own role or deactivate self
  if (actor.id === id) {
    if (patch.role !== undefined) {
      throw new AppError('FORBIDDEN', { reason: 'self_protection' }, 403);
    }
    if (patch.isActive === false) {
      throw new AppError('FORBIDDEN', { reason: 'self_protection' }, 403);
    }
  }

  const existing = await usersRepo.findById(id);
  if (!existing) throw new NotFoundError('user');

  // Block direct activation of a user who has never logged in. Flipping the
  // flag without setting a real password leaves them locked out — the bcrypt
  // hash on the row is either seeded or randomly generated and unknown to
  // anyone. Admin must (re)send an invitation instead, which sets a fresh
  // password through the registration flow. Reactivating someone who
  // previously logged in is still allowed (they already have a usable hash
  // and an admin can trigger reset-password separately).
  if (
    patch.isActive === true &&
    existing.isActive === false &&
    existing.lastLoginAt === null
  ) {
    throw new AppError(
      'VALIDATION',
      { reason: 'requires_invite', field: 'isActive' },
      409,
    );
  }

  // Email rewrite is allowed ONLY while the user has never logged in. Once
  // they have an active session, the email IS the login key — silently
  // rewriting it would orphan the account from any password-reset link
  // already in flight to the old address. Admin must trigger password
  // reset → user logs in once → THEN email can be changed (in practice we
  // just keep it immutable post-login).
  const normalizedPatch: Record<string, unknown> = { ...patch };
  if (patch.email !== undefined) {
    const newEmail = patch.email.toLowerCase().trim();
    if (newEmail !== existing.email) {
      if (existing.lastLoginAt !== null) {
        throw new AppError(
          'FORBIDDEN',
          { reason: 'email_locked_after_login' },
          403,
        );
      }
      const taken = await usersRepo.findByEmail(newEmail);
      if (taken && taken.id !== id) {
        throw new AppError('DUPLICATE', { entity: 'user', field: 'email' }, 409);
      }
      normalizedPatch.email = newEmail;
    } else {
      // No change — strip to avoid a no-op write in the diff.
      delete normalizedPatch.email;
    }
  }

  // Route through the repo so the user cache is busted on the same call.
  // A direct db.update(users) here would leave a stale cached role/isActive
  // in users.repo for up to the cache TTL — a security-relevant bug.
  const row = await usersRepo.update(id, normalizedPatch);

  if (!row) throw new NotFoundError('user');

  // Audit diff
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    oldValue[key] = (existing as Record<string, unknown>)[key as string];
    newValue[key] = (row as Record<string, unknown>)[key as string];
  }

  await audit.log({
    actorId: actor.id,
    action: 'update_user',
    entityType: 'user',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  return toAdminUser(row);
}

export async function triggerPasswordReset(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ emailSent: boolean }> {
  const user = await usersRepo.findById(id);
  if (!user) throw new NotFoundError('user');

  const token = randomUUID() + randomUUID();
  const tokenHash = sha256(token);
  await resetRepo.create({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  let emailSent = false;
  try {
    await sendPasswordResetEmail(user.email, token);
    emailSent = true;
  } catch (err) {
    logger.error({ err, userId: id }, 'Failed to send admin-triggered password reset email');
  }

  await audit.log({
    actorId: actor.id,
    action: 'admin_password_reset',
    entityType: 'user',
    entityId: id,
    newValue: { targetEmail: user.email, emailSent },
    ...ctx,
  });

  return { emailSent };
}

export async function deleteUser(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<void> {
  // Self-protection: deleting your own account would orphan the session making
  // this request and could remove the last admin. Deactivate instead.
  if (actor.id === id) {
    throw new AppError('FORBIDDEN', { reason: 'self_protection' }, 403);
  }

  const existing = await usersRepo.findById(id);
  if (!existing) throw new NotFoundError('user');

  // Audit BEFORE the destructive write so the trail survives even if the
  // delete later fails (RODO traceability). Canonical pattern, see
  // candidates.service.ts:deleteCandidate. Historical audit rows authored by
  // this user keep their data — only actor_id is nulled by the FK.
  await audit.log({
    actorId: actor.id,
    action: 'delete_user',
    entityType: 'user',
    entityId: id,
    oldValue: {
      email: existing.email,
      firstName: existing.firstName,
      lastName: existing.lastName,
      role: existing.role,
    },
    ...ctx,
  });

  try {
    await usersRepo.remove(id);
  } catch (err) {
    // PG 23503 = foreign_key_violation. Shouldn't happen (all FKs are set
    // null/cascade) but stay defensive if a future table adds a restrict FK.
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23503') {
      throw new AppError('VALIDATION', { constraint: e.constraint }, 409);
    }
    throw err;
  }
}

export async function forceLogout(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ sessionsDeleted: number }> {
  // mcp_test M18: this endpoint is for kicking OTHER users out. Without this
  // guard, clicking "force logout" on yourself nukes your own session (incl.
  // the one making the request) and bricks the tab — confusing footgun.
  if (actor.id === id) {
    throw new AppError('FORBIDDEN', { reason: 'self_protection' }, 403);
  }

  const user = await usersRepo.findById(id);
  if (!user) throw new NotFoundError('user');

  const sessionsDeleted = await sessionsRepo.deleteByUserId(id);

  await audit.log({
    actorId: actor.id,
    action: 'force_logout',
    entityType: 'user',
    entityId: id,
    newValue: { targetEmail: user.email, sessionsDeleted },
    ...ctx,
  });

  return { sessionsDeleted };
}
