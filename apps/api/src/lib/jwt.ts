import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '@crm/shared';
import { env } from '../env';

const ACCESS_TTL_SEC = 60 * 15;
const REFRESH_TTL_SEC = 60 * 60 * 24 * 7;
const ALG = 'HS256';
const ISSUER = 'crm-demo';

const accessKey = new TextEncoder().encode(env.JWT_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface AccessPayload extends JWTPayload {
  sub: string;
  role: UserRole;
  sid: string;
  iat: number;
  exp: number;
}

export interface RefreshPayload extends JWTPayload {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

export async function signAccess(payload: Omit<AccessPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(accessKey);
}

export async function signRefresh(payload: Omit<RefreshPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SEC}s`)
    .sign(refreshKey);
}

export async function verifyAccess(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, accessKey, { issuer: ISSUER, algorithms: [ALG] });
  // Reject purpose-restricted tokens (e.g. 2fa-pending) from being used as access tokens
  if ((payload as Record<string, unknown>)['purpose']) {
    throw new Error('Purpose-restricted token cannot be used as access token');
  }
  return payload as AccessPayload;
}

export async function signPartial2FA(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, purpose: '2fa-pending' } as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(accessKey);
}

export async function verifyPartial2FA(token: string): Promise<{ sub: string; purpose: string }> {
  const { payload } = await jwtVerify(token, accessKey, { issuer: ISSUER, algorithms: [ALG] });
  if ((payload as Record<string, unknown>)['purpose'] !== '2fa-pending') {
    throw new Error('Token is not a 2FA-pending token');
  }
  return payload as { sub: string; purpose: string };
}

export async function verifyRefresh(token: string): Promise<RefreshPayload> {
  const { payload } = await jwtVerify(token, refreshKey, { issuer: ISSUER, algorithms: [ALG] });
  return payload as RefreshPayload;
}

export const TOKEN_TTL = {
  accessSec: ACCESS_TTL_SEC,
  refreshSec: REFRESH_TTL_SEC,
};
