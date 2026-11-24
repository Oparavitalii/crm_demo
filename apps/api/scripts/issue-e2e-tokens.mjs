/* eslint-env node */
/* eslint-disable no-undef, no-console */
// Issue long-lived access tokens for E2E test users, bypassing /auth/login
// rate-limit. Creates a session row + signs JWT with matching sid. Tokens
// have 6h TTL — re-run before each E2E session.
// Output: apps/web/e2e/.auth/tokens.json
// Usage: node apps/api/scripts/issue-e2e-tokens.mjs

import 'dotenv/config';
import { Pool } from 'pg';
import { SignJWT } from 'jose';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';

const ROLES = [
  'e2e-admin@opushr.test',
  'e2e-recruiter@opushr.test',
  'e2e-recruiter2@opushr.test',
  'e2e-coordinator@opushr.test',
  'e2e-coordinator2@opushr.test',
  'e2e-readonly@opushr.test',
];

const ACCESS_TTL_SEC = 6 * 60 * 60;
const SESSION_TTL_SEC = 6 * 60 * 60;
const ISSUER = 'opushr-crm';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL,
});

const accessKey = new TextEncoder().encode(process.env.JWT_SECRET);
const refreshKey = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET);

const tokens = {};

const ROLE_TO_FILE = {
  admin: 'admin.json',
  recruiter: 'recruiter.json',
  coordinator: 'coordinator.json',
  readonly: 'readonly.json',
};

try {
  for (const email of ROLES) {
    const u = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
    if (!u.rows.length) {
      console.error(`User not found: ${email}`);
      continue;
    }
    const { id: userId, role } = u.rows[0];

    const sid = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);

    const refreshToken = await new SignJWT({ sub: userId, sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SEC}s`)
      .sign(refreshKey);

    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');

    await pool.query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [sid, userId, refreshTokenHash, expiresAt]
    );

    const accessToken = await new SignJWT({ sub: userId, role, sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SEC}s`)
      .sign(accessKey);

    tokens[email] = { userId, role, sid, token: accessToken, refreshToken };
    console.log(`  ✓ ${role.padEnd(11)} ${email}  (sid=${sid.slice(0, 8)}...)`);

    // Write storageState file for the primary user of each role
    const stateFile = ROLE_TO_FILE[role];
    if (stateFile && !Object.values(tokens).filter((t) => t.role === role).length > 1) {
      const stateOut = `apps/web/e2e/.auth/${stateFile}`;
      const state = {
        cookies: [
          {
            name: 'refresh_token',
            value: refreshToken,
            domain: 'localhost',
            path: '/auth',
            expires: Math.floor(expiresAt.getTime() / 1000),
            httpOnly: true,
            secure: false,
            sameSite: 'Strict',
          },
        ],
        origins: [],
      };
      await mkdir('apps/web/e2e/.auth', { recursive: true });
      await writeFile(stateOut, JSON.stringify(state, null, 2));
    }
  }

  await mkdir('apps/web/e2e/.auth', { recursive: true });
  await writeFile('apps/web/e2e/.auth/tokens.json', JSON.stringify(tokens, null, 2));
  console.log(`\nTokens + storageState written to apps/web/e2e/.auth/`);
} catch (err) {
  console.error('Token issue failed:', err);
  process.exit(1);
} finally {
  await pool.end();
}
