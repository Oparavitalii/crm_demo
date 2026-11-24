import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

describe('makeToken helper', () => {
  it('mints a valid access token verifiable by lib/jwt', async () => {
    const { makeToken } = await import('./make-token');
    const { verifyAccess } = await import('../../lib/jwt');
    const t = await makeToken({ userId: 'u-1', role: 'admin', sid: 's-1' });
    const p = await verifyAccess(t);
    expect(p.sub).toBe('u-1');
    expect(p.role).toBe('admin');
    expect(p.sid).toBe('s-1');
  });

  it('mints an already-expired token when expiresInSec is negative', async () => {
    const { makeToken } = await import('./make-token');
    const { verifyAccess } = await import('../../lib/jwt');
    const t = await makeToken({ userId: 'u', role: 'admin', sid: 's', expiresInSec: -60 });
    await expect(verifyAccess(t)).rejects.toBeDefined();
  });

  it('mints a token signed with a wrong secret', async () => {
    const { makeToken } = await import('./make-token');
    const { verifyAccess } = await import('../../lib/jwt');
    const t = await makeToken({ userId: 'u', role: 'admin', sid: 's', secret: 'z'.repeat(48) });
    await expect(verifyAccess(t)).rejects.toBeDefined();
  });
});
