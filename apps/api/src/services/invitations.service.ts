import { randomBytes } from 'node:crypto';
import { env } from '../env';
import * as invitationsRepo from '../repositories/invitations.repo';
import * as usersRepo from '../repositories/users.repo';
import * as audit from './audit.service';
import { hashPassword } from '../lib/bcrypt';
import { sha256 } from '../lib/hash';
import { buildUserSlug } from '../lib/slugify';
import { sendInvitationEmail } from './email.service';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import type { CreateInvitationInput, AcceptInvitationInput } from '@opushr/shared';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Actor {
  id: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}

interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

export async function createInvitation(
  input: CreateInvitationInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ id: string; email: string; inviteUrl: string | null; emailSent: boolean }> {
  // Admin-only
  if (actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', { reason: 'admin_only' }, 403);
  }

  const email = input.email.toLowerCase().trim();

  // Check if user already exists with that email
  const existingUser = await usersRepo.findByEmail(email);
  if (existingUser) {
    throw new AppError('DUPLICATE', { field: 'email', reason: 'user_exists' }, 409);
  }

  // Check if pending invitation for this email exists
  const existingInvitation = await invitationsRepo.findPendingByEmail(email);
  if (existingInvitation) {
    throw new AppError('DUPLICATE', { field: 'email', reason: 'invitation_pending' }, 409);
  }

  // Generate token with 256 bits of entropy
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);

  // Insert invitation
  const invitation = await invitationsRepo.create({
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role,
    tokenHash,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    invitedById: actor.id,
  });

  const inviteUrl = `${env.APP_URL}/register?token=${token}`;

  // Try sending email via Resend
  let emailSent = false;
  try {
    const inviterName = `${actor.firstName} ${actor.lastName}`;
    await sendInvitationEmail(email, inviteUrl, inviterName);
    emailSent = true;
  } catch (err) {
    logger.error({ err, invitationId: invitation.id }, 'Failed to send invitation email');
  }

  await audit.log({
    actorId: actor.id,
    action: 'invite_user',
    entityType: 'user',
    newValue: { email, role: input.role },
    ...ctx,
  });

  return {
    id: invitation.id,
    email,
    // Don't expose the URL to admin if email was sent successfully
    inviteUrl: emailSent ? null : inviteUrl,
    emailSent,
  };
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
  ctx: ReqCtx,
): Promise<{ userId: string; email: string }> {
  const tokenHash = sha256(input.token);

  // Find invitation by hash
  const invitation = await invitationsRepo.findValidByHash(tokenHash);
  if (!invitation) {
    throw new AppError('INVALID_TOKEN', { reason: 'invalid_or_expired' }, 400);
  }

  const passwordHash = await hashPassword(input.password);

  // If a user with this email already exists, the invitation is for an
  // imported / pre-seeded account. Activating it must NOT create a duplicate
  // row — we update the existing one in place.
  const existingUser = await usersRepo.findByEmail(invitation.email);
  if (existingUser) {
    if (existingUser.isActive) {
      throw new AppError('ALREADY_ACTIVE', { reason: 'user_already_active' }, 409);
    }

    // Route through the repo so the user cache is busted (this flips isActive
    // and role — stale cached values would be a security concern). The repo's
    // update sets updatedAt itself.
    const updated = await usersRepo.update(existingUser.id, {
      passwordHash,
      isActive: true,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      role: invitation.role,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    if (!updated) {
      throw new AppError('NOT_FOUND', { entity: 'user' }, 404);
    }

    await invitationsRepo.markAccepted(invitation.id);

    await audit.log({
      actorId: updated.id,
      action: 'user.register',
      entityType: 'user',
      entityId: updated.id,
      newValue: { email: updated.email, role: updated.role, reactivated: true },
      ...ctx,
    });

    return { userId: updated.id, email: updated.email };
  }

  // No existing user — create one. Preserves the original new-hire flow.
  // Assign a public_slug derived from name; uniqueness is handled by the DB
  // unique index — on the rare collision we suffix '-2', '-3' …
  const baseSlug = buildUserSlug(invitation.firstName, invitation.lastName);
  let publicSlug = baseSlug;
  for (let n = 2; n <= 50; n++) {
    if (!(await usersRepo.findByPublicSlug(publicSlug))) break;
    publicSlug = `${baseSlug}-${n}`;
  }

  const newUser = await usersRepo.create({
    email: invitation.email,
    firstName: invitation.firstName,
    lastName: invitation.lastName,
    role: invitation.role,
    passwordHash,
    isActive: true,
    publicSlug,
  });

  // Mark invitation as accepted
  await invitationsRepo.markAccepted(invitation.id);

  // Audit log — actor is the new user themselves
  await audit.log({
    actorId: newUser.id,
    action: 'user.register',
    entityType: 'user',
    entityId: newUser.id,
    newValue: { email: newUser.email, role: newUser.role },
    ...ctx,
  });

  return { userId: newUser.id, email: newUser.email };
}

export async function inviteExistingUser(
  userId: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ userId: string; email: string; inviteUrl: string; emailSent: boolean }> {
  const user = await usersRepo.findById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', { entity: 'user' }, 404);
  }
  if (user.isActive) {
    throw new AppError('ALREADY_ACTIVE', { reason: 'user_already_active' }, 409);
  }

  // Resend keeps any previously-sent link valid until its natural 7-day expiry
  // — the invitee can use whichever email they open. `revoke` is the explicit
  // kill switch when a link genuinely must be invalidated.
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const invitation = await invitationsRepo.create({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    tokenHash,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    invitedById: actor.id,
  });

  const inviteUrl = `${env.APP_URL}/register?token=${token}`;

  let emailSent = false;
  try {
    const inviterName = `${actor.firstName} ${actor.lastName}`.trim();
    await sendInvitationEmail(user.email, inviteUrl, inviterName || 'OPUS HR');
    emailSent = true;
  } catch (err) {
    logger.error(
      { err, invitationId: invitation.id, userId },
      'Failed to send resend-invite email',
    );
  }

  await audit.log({
    actorId: actor.id,
    action: 'user.resend_invite',
    entityType: 'user',
    entityId: userId,
    oldValue: null,
    newValue: { emailSent },
    ...ctx,
  });

  return { userId, email: user.email, inviteUrl, emailSent };
}

export async function resendInvitation(
  invitationId: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<{ id: string; email: string; inviteUrl: string | null; emailSent: boolean }> {
  if (actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', { reason: 'admin_only' }, 403);
  }

  const existing = await invitationsRepo.findById(invitationId);
  if (!existing) {
    throw new AppError('NOT_FOUND', { entity: 'invitation' }, 404);
  }
  if (existing.acceptedAt) {
    throw new AppError('ALREADY_ACTIVE', { reason: 'invitation_accepted' }, 409);
  }

  // Issue a fresh token + row but DON'T invalidate the existing one: the
  // previously-sent email stays valid until its natural 7-day expiry, so the
  // invitee can use whichever link they open (the old "expire immediately"
  // behavior is the #1 cause of "termin upłynął" on a freshly resent invite).
  // We can't re-send the original token — only its hash is stored — hence a new
  // row. `revoke` is the explicit kill switch; the pending list dedupes by
  // email so multiple live rows don't clutter the admin view.
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const invitation = await invitationsRepo.create({
    email: existing.email,
    firstName: existing.firstName,
    lastName: existing.lastName,
    role: existing.role,
    tokenHash,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    invitedById: actor.id,
  });

  const inviteUrl = `${env.APP_URL}/register?token=${token}`;

  let emailSent = false;
  try {
    const inviterName = `${actor.firstName} ${actor.lastName}`.trim();
    await sendInvitationEmail(existing.email, inviteUrl, inviterName || 'OPUS HR');
    emailSent = true;
  } catch (err) {
    logger.error(
      { err, invitationId: invitation.id },
      'Failed to send resend invitation email',
    );
  }

  await audit.log({
    actorId: actor.id,
    action: 'user.resend_invite',
    entityType: 'invitation',
    entityId: invitation.id,
    oldValue: null,
    newValue: { email: existing.email, emailSent },
    ...ctx,
  });

  return {
    id: invitation.id,
    email: existing.email,
    inviteUrl: emailSent ? null : inviteUrl,
    emailSent,
  };
}

// Shape the row before it leaves the server. tokenHash has no admin-side
// purpose and we don't want it in browser caches even though it's hashed.
export async function listPendingInvitations() {
  const rows = await invitationsRepo.findAll();
  // A resend issues a fresh row without expiring the previous one (so older
  // emails keep working), which means one email can have several pending rows.
  // Collapse to the most recent per email so the admin list stays clean.
  const latestByEmail = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const seen = latestByEmail.get(row.email);
    if (!seen || row.createdAt > seen.createdAt) {
      latestByEmail.set(row.email, row);
    }
  }
  return [...latestByEmail.values()].map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    invitedById: row.invitedById,
  }));
}

export async function revokeInvitation(id: string, actor: Actor, ctx: ReqCtx): Promise<void> {
  if (actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', { reason: 'admin_only' }, 403);
  }

  const invitation = await invitationsRepo.findById(id);
  if (!invitation) {
    throw new AppError('NOT_FOUND', { entity: 'invitation' }, 404);
  }

  await audit.log({
    actorId: actor.id,
    action: 'revoke_invitation',
    entityType: 'user',
    newValue: { email: invitation.email, role: invitation.role },
    ...ctx,
  });

  await invitationsRepo.deleteById(id);
}
