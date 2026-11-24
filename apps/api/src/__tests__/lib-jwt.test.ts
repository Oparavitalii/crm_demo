import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';

// Set env BEFORE importing the module
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
// minimal env to pass env.ts parse:
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

const accessKey = new TextEncoder().encode('a'.repeat(48));
const wrongKey = new TextEncoder().encode('z'.repeat(48));

describe('jwt', () => {
  it('signs and verifies an access token', async () => {
    const { signAccess, verifyAccess } = await import('../lib/jwt');
    const token = await signAccess({ sub: 'user-1', role: 'admin', sid: 's-1' });
    const payload = await verifyAccess(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('admin');
    expect(payload.sid).toBe('s-1');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects token signed with refresh secret when verifying as access', async () => {
    const { signRefresh, verifyAccess } = await import('../lib/jwt');
    const refresh = await signRefresh({ sub: 'user-1', sid: 's-1' });
    await expect(verifyAccess(refresh)).rejects.toBeDefined();
  });

  it('access token expires within 15 minutes', async () => {
    const { signAccess, verifyAccess } = await import('../lib/jwt');
    const t = await signAccess({ sub: 'u', role: 'admin', sid: 's' });
    const p = await verifyAccess(t);
    const ttl = p.exp - p.iat;
    expect(ttl).toBeLessThanOrEqual(60 * 15);
    expect(ttl).toBeGreaterThan(60 * 14);
  });

  it('refresh token expires within 7 days', async () => {
    const { signRefresh, verifyRefresh } = await import('../lib/jwt');
    const t = await signRefresh({ sub: 'u', sid: 's' });
    const p = await verifyRefresh(t);
    const ttl = p.exp - p.iat;
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 24 * 7);
    expect(ttl).toBeGreaterThan(60 * 60 * 24 * 6);
  });

  it('rejects a token whose exp is in the past', async () => {
    const { verifyAccess } = await import('../lib/jwt');
    const pastIat = Math.floor(Date.now() / 1000) - 3600;
    const expired = await new SignJWT({ sub: 'u', role: 'admin', sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('crm-demo')
      .setIssuedAt(pastIat)
      .setExpirationTime(pastIat + 60)
      .sign(accessKey);
    await expect(verifyAccess(expired)).rejects.toBeDefined();
  });

  it('rejects a token signed with an unrelated secret', async () => {
    const { verifyAccess } = await import('../lib/jwt');
    const forged = await new SignJWT({ sub: 'u', role: 'admin', sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('crm-demo')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(wrongKey);
    await expect(verifyAccess(forged)).rejects.toBeDefined();
  });
});
