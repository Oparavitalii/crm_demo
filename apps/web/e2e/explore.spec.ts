import { test as base, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';
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

async function issueAdminToken(): Promise<string> {
  const u = await pool.query("SELECT id, role FROM users WHERE email = 'e2e-admin@crm.test'");
  const { id: userId, role } = u.rows[0];
  const sid = randomUUID();
  await pool.query(
    `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [sid, userId, createHash('sha256').update(sid).digest('hex'), new Date(Date.now() + 6 * 60 * 60 * 1000)],
  );
  return await new SignJWT({ sub: userId, role, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('crm-demo')
    .setIssuedAt()
    .setExpirationTime('6h')
    .sign(accessKey);
}

// Override the test to use page with intercepted /auth/refresh — survives session rotation
const test = base.extend<{}>({
  page: async ({ page }, use) => {
    const token = await issueAdminToken();
    await page.route('**/auth/refresh', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accessToken: token }),
      });
    });
    await use(page);
  },
});

const PAGES_ADMIN = [
  '/',
  '/candidates',
  '/clients',
  '/projects',
  '/accommodations',
  '/dismissals',
  '/failed-candidates',
  '/tasks',
  '/employer-inquiries',
  '/communications',
  '/communications/history',
  '/documents',
  '/profile',
  '/admin',
  '/admin/users',
  '/admin/audit-log',
  '/admin/documents',
  '/admin/settings/statuses',
];

const SCREENSHOT_DIR = 'e2e-screenshots';

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
});

test.describe('Live UI exploration — admin', () => {
  for (const path of PAGES_ADMIN) {
    test(`page: ${path}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => pageErrors.push(err.message));

      const start = Date.now();
      const response = await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 }).catch((err) => {
        console.warn(`  goto ${path} threw:`, err.message);
        return null;
      });
      const loadMs = Date.now() - start;

      // Wait briefly for late-loading content
      await page.waitForLoadState('domcontentloaded').catch(() => null);

      const status = response?.status() ?? 0;
      const url = page.url();
      const isLoginRedirect = url.includes('/login');
      const isForbidden = url.includes('/forbidden') || status === 403;
      const is404 = url.includes('/404') || status === 404;

      const slug = path.replace(/[\/]/g, '_').replace(/^_/, '') || 'root';
      const filename = `${SCREENSHOT_DIR}/admin-${slug}.png`;
      await page.screenshot({ path: filename, fullPage: false }).catch(() => null);

      const findings: string[] = [];
      if (isLoginRedirect) findings.push('🔴 REDIRECTED TO LOGIN (auth broken?)');
      if (isForbidden) findings.push('🟡 403 FORBIDDEN');
      if (is404) findings.push('🟡 404 NOT FOUND');
      if (consoleErrors.length) findings.push(`🟡 ${consoleErrors.length} console.error(s)`);
      if (pageErrors.length) findings.push(`🔴 ${pageErrors.length} uncaught page error(s)`);
      if (loadMs > 5000) findings.push(`🟡 slow load: ${loadMs}ms`);

      // Always log a clean line so the report can pick it up
      console.log(`  ${path.padEnd(40)} → ${url.replace('http://localhost:5173', '')} | ${loadMs}ms | ${findings.length ? findings.join(' | ') : '✅ OK'}`);

      if (consoleErrors.length) console.log(`    console.error: ${consoleErrors.slice(0, 3).join(' || ')}`);
      if (pageErrors.length) console.log(`    pageerror:     ${pageErrors.slice(0, 3).join(' || ')}`);

      // Soft assertions — we want all pages explored even if some fail
      expect(isLoginRedirect, `${path} redirected to login`).toBeFalsy();
    });
  }
});
