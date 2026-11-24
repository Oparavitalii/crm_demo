import { SignJWT } from 'jose';
import type { UserRole } from '@crm/shared';

interface MakeTokenInput {
  userId: string;
  role: UserRole;
  sid: string;
  /** Negative seconds = already expired. Default 900 (15min, matches prod). */
  expiresInSec?: number;
  /** Override signing key — use to forge tokens with the wrong secret. */
  secret?: string;
}

export async function makeToken(input: MakeTokenInput): Promise<string> {
  const secret = input.secret ?? process.env.JWT_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('makeToken: secret must be >=32 chars');
  }
  const key = new TextEncoder().encode(secret);
  const ttl = input.expiresInSec ?? 60 * 15;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: input.userId, role: input.role, sid: input.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('crm-demo')
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key);
}
