import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { users, type User, type NewUser } from '../db/tables/users';
import { TtlCache } from '../lib/ttl-cache';

// Short-lived cache for findById (the hot path: auth middleware loads the
// acting user on every authenticated request). TTL 60s keeps role/isActive
// staleness bounded; every write below busts the affected id explicitly so a
// changed user never lingers stale for the full TTL. NOTE: the session lookup
// in middleware/auth.ts stays LIVE on every request — it is the token-
// revocation mechanism and is deliberately NOT cached here.
const userCache = new TtlCache<User>(60_000);

// Exported so callers that mutate a user row outside this repo can invalidate
// the cache. Prefer routing writes through a repo method; use this only when
// that is impractical.
export function bustUser(id: string): void {
  userCache.delete(id);
}

export async function findByEmail(email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) });
}

// Single-flight: a burst of concurrent requests from the same user — one page
// open fires ~39 — collapses to one query instead of 39, each of which would
// otherwise take its own pool connection. The "cache real rows only" rule now
// lives inside getOrLoad.
export async function findById(id: string): Promise<User | undefined> {
  return userCache.getOrLoad(id, () =>
    db.query.users.findFirst({ where: eq(users.id, id) }),
  );
}

export async function findByPublicSlug(slug: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.publicSlug, slug.toLowerCase().trim()) });
}

export async function setPublicSlug(id: string, slug: string): Promise<void> {
  await db.update(users).set({ publicSlug: slug, updatedAt: new Date() }).where(eq(users.id, id));
  userCache.delete(id);
}

// Generic admin field update (role, isActive, email, name, isFreelancer, …).
// Routed through the repo so the cache bust below cannot be forgotten by the
// caller — a stale cached `role`/`isActive` is a security concern.
export async function update(
  id: string,
  patch: Record<string, unknown>,
): Promise<User | undefined> {
  const [row] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  userCache.delete(id);
  return row;
}

export async function create(input: NewUser): Promise<User> {
  // Normalize email on write — findByEmail lowercases on lookup, so writing
  // with mixed-case here would cause permanent login failure.
  const normalized = { ...input, email: input.email.toLowerCase().trim() };
  const [row] = await db.insert(users).values(normalized).returning();
  if (!row) throw new Error('Failed to insert user');
  return row;
}

export async function updateLastLogin(id: string): Promise<void> {
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(users.id, id));
  userCache.delete(id);
}

export async function recordFailedLogin(id: string): Promise<number> {
  const [row] = await db
    .update(users)
    .set({ failedLoginAttempts: sql`${users.failedLoginAttempts} + 1` })
    .where(eq(users.id, id))
    .returning({ count: users.failedLoginAttempts });
  userCache.delete(id);
  return row?.count ?? 0;
}

export async function lockAccount(id: string, until: Date): Promise<void> {
  await db.update(users).set({ lockedUntil: until }).where(eq(users.id, id));
  userCache.delete(id);
}

export async function clearExpiredLocks(): Promise<number> {
  const result = await db
    .update(users)
    .set({ lockedUntil: null, failedLoginAttempts: 0 })
    .where(and(isNotNull(users.lockedUntil), gt(sql`now()`, users.lockedUntil)));
  // Bulk update with no single id — we cannot bust per-id here, so a user whose
  // lock just expired may still read as locked for up to the cache TTL. This is
  // acceptable: login also re-checks (and clears) the lock at auth time, so the
  // stale flag never blocks a legitimate login.
  return result.rowCount ?? 0;
}

export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await db
    .update(users)
    .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, id));
  userCache.delete(id);
}

export async function updateTwoFactorSecret(id: string, secret: string | null): Promise<void> {
  await db
    .update(users)
    .set({ twoFactorSecret: secret, updatedAt: new Date() })
    .where(eq(users.id, id));
  userCache.delete(id);
}

// Hard delete. Safe because every FK to users.id is ON DELETE set null
// (candidates, audit_log.actorId, comments, …) or cascade (sessions,
// password_reset_tokens, document_acceptances) — so no foreign_key_violation.
export async function remove(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
  userCache.delete(id);
}
