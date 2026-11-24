import { and, eq, isNull, sql, lt } from 'drizzle-orm';
import { db } from '../db/client';
import {
  passwordResetTokens,
  type PasswordResetToken,
  type NewPasswordResetToken,
} from '../db/tables/users';

export async function create(input: NewPasswordResetToken): Promise<PasswordResetToken> {
  const [row] = await db.insert(passwordResetTokens).values(input).returning();
  if (!row) throw new Error('Failed to insert reset token');
  return row;
}

export async function findValidByHash(tokenHash: string): Promise<PasswordResetToken | undefined> {
  return db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      isNull(passwordResetTokens.usedAt),
      sql`${passwordResetTokens.expiresAt} > now()`,
    ),
  });
}

export async function markUsed(id: string): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, id));
}

export async function deleteExpired(): Promise<number> {
  const result = await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, sql`now()`));
  return result.rowCount ?? 0;
}
