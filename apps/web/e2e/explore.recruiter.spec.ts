import { test as base, expect } from './fixtures';
import { Pool } from 'pg';
import { SignJWT } from 'jose';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dir = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dir, '../../../.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL });
const accessKey = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

async function issueTokenFor(email: string): Promise<string> {
  const u = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
  const { id: userId, role } = u.rows[0];
  const sid = randomUUID();
  await pool.query(
    `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [sid, userId, createHash('sha256').update(sid).digest('hex'), new Date(Date.now() + 6 * 60 * 60 * 1000)],
  );
  return await new SignJWT({ sub: userId, role, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('opushr-crm')
    .setIssuedAt()
    .setExpirationTime('6h')
    .sign(accessKey);
}

const test = base.extend<{ asRole: 'recruiter' }>({
  asRole: ['recruiter', { option: true }],
  page: async ({ page, asRole }, use) => {
    const email =
      asRole === 'recruiter' ? 'e2e-recruiter@opushr.test'
        : asRole === 'coordinator' ? 'e2e-coordinator@opushr.test'
        : 'e2e-readonly@opushr.test';
    const token = await issueTokenFor(email);
    await page.route('**/auth/refresh', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: token }) });
    });
    await use(page);
  },
});

// Pages accessible to recruiter
const PAGES_RECRUITER = [
  '/', '/candidates', '/leads', '/clients', '/projects', '/accommodations',
  '/dismissals', '/failed-candidates', '/tasks', '/communications', '/documents', '/profile',
];

// Admin-only — should redirect or forbid
const PAGES_FORBIDDEN_FOR_RECRUITER = [
  '/admin', '/admin/users', '/admin/audit-log', '/admin/documents', '/admin/settings/statuses',
];

test.describe('Live UI — Recruiter scope', () => {
  for (const path of PAGES_RECRUITER) {
    test(`recruiter sees: ${path}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const net403: string[] = [];
      page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()));
      page.on('response', (r) => {
        if (r.status() === 403) net403.push(new URL(r.url()).pathname);
      });
      const start = Date.now();
      const resp = await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 }).catch(() => null);
      const url = page.url();
      const ms = Date.now() - start;
      const findings = [
        url.includes('/login') ? '🔴 REDIRECTED TO LOGIN' : '',
        url.includes('/forbidden') ? '🟡 403' : '',
        consoleErrors.length ? `🟡 ${consoleErrors.length} console.error` : '',
        net403.length ? `🟡 403 fetches: ${[...new Set(net403)].join(', ')}` : '',
      ].filter(Boolean);
      console.log(`  ${path.padEnd(40)} → ${url.replace('http://localhost:5173', '')} | ${ms}ms | ${findings.join(' | ') || '✅ OK'}`);
      expect(url.includes('/login'), 'recruiter should not be redirected to login').toBeFalsy();
    });
  }

  for (const path of PAGES_FORBIDDEN_FOR_RECRUITER) {
    test(`recruiter FORBIDDEN: ${path}`, async ({ page }) => {
      const net403: string[] = [];
      page.on('response', (r) => {
        if (r.status() === 403) net403.push(new URL(r.url()).pathname);
      });
      await page.goto(path, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => null);
      // ForbiddenPage doesn't change URL — check the body
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const isForbiddenPage = /forbidden|brak dostępu|немає доступу|403|access denied/i.test(bodyText);
      const hasNet403 = net403.length > 0;
      const blocked = isForbiddenPage;
      console.log(`  ${path.padEnd(40)} → ${blocked ? '✅ ForbiddenPage' : '🔴 page rendered'}${hasNet403 ? ` (also ${net403.length} 403 fetches)` : ''}`);
      expect(isForbiddenPage, `${path} should show ForbiddenPage for recruiter`).toBeTruthy();
    });
  }
});
