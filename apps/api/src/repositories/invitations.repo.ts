import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { invitations, type Invitation, type NewInvitation } from '../db/tables/invitations';

export async function create(input: NewInvitation): Promise<Invitation> {
  const [row] = await db.insert(invitations).values(input).returning();
  if (!row) throw new Error('Failed to insert invitation');
  return row;
}

export async function findValidByHash(tokenHash: string): Promise<Invitation | undefined> {
  return db.query.invitations.findFirst({
    where: and(
      eq(invitations.tokenHash, tokenHash),
      isNull(invitations.acceptedAt),
      sql`${invitations.expiresAt} > now()`,
    ),
  });
}

export async function findPendingByEmail(email: string): Promise<Invitation | undefined> {
  return db.query.invitations.findFirst({
    where: and(
      eq(invitations.email, email),
      isNull(invitations.acceptedAt),
      sql`${invitations.expiresAt} > now()`,
    ),
  });
}

export async function findAll(): Promise<Invitation[]> {
  return db.query.invitations.findMany({
    where: and(
      isNull(invitations.acceptedAt),
      sql`${invitations.expiresAt} > now()`,
    ),
  });
}

export async function findById(id: string): Promise<Invitation | undefined> {
  return db.query.invitations.findFirst({
    where: eq(invitations.id, id),
  });
}

export async function markAccepted(id: string): Promise<void> {
  await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(eq(invitations.id, id));
}

export async function deleteById(id: string): Promise<void> {
  await db.delete(invitations).where(eq(invitations.id, id));
}

export async function deleteExpired(): Promise<number> {
  const result = await db
    .delete(invitations)
    .where(lt(invitations.expiresAt, sql`now()`));
  return result.rowCount ?? 0;
}
