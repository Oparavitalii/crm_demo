import { eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions, type Session, type NewSession } from '../db/tables/users';

export async function create(input: NewSession): Promise<Session> {
  const [row] = await db.insert(sessions).values(input).returning();
  if (!row) throw new Error('Failed to insert session');
  return row;
}

export async function findByTokenHash(tokenHash: string): Promise<Session | undefined> {
  return db.query.sessions.findFirst({ where: eq(sessions.refreshTokenHash, tokenHash) });
}

export async function findById(id: string): Promise<Session | undefined> {
  return db.query.sessions.findFirst({ where: eq(sessions.id, id) });
}

export async function deleteById(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteByUserId(userId: string): Promise<number> {
  const result = await db.delete(sessions).where(eq(sessions.userId, userId));
  return result.rowCount ?? 0;
}

export async function deleteExpired(): Promise<number> {
  const result = await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
  return result.rowCount ?? 0;
}

// Sweeps rotation tombstones (see rotate below). Cutoff must stay well above
// both the access-token TTL (15 min — requireAuth resolves old sids against
// these rows) and the refresh grace window (60 s).
export async function deleteRotatedBefore(cutoff: Date): Promise<number> {
  const result = await db.delete(sessions).where(lt(sessions.rotatedAt, cutoff));
  return result.rowCount ?? 0;
}

// Rotation keeps the old row as a tombstone instead of deleting it: the row
// is marked rotatedAt=now() and pointed at its replacement. auth.service uses
// the tombstone to serve the rotation grace window and to detect real token
// reuse; requireAuth uses it so access tokens issued before the rotation
// keep working until their own expiry. Insert first — replacedById is a
// self-FK and must reference an existing row.
export async function rotate(oldId: string, newSession: NewSession): Promise<Session> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(sessions).values(newSession).returning();
    if (!row) throw new Error('Failed to rotate session');
    await tx
      .update(sessions)
      .set({ rotatedAt: sql`now()`, replacedById: row.id })
      .where(eq(sessions.id, oldId));
    return row;
  });
}
