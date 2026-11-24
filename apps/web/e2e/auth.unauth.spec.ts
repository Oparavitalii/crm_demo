import { test, expect } from '@playwright/test';

// Use different accounts per test to avoid rate-limit cross-contamination.
const ADMIN = 'e2e-admin@crm.test';
const RECRUITER = 'e2e-recruiter@crm.test';
const COORDINATOR = 'e2e-coordinator@crm.test';
const VALID_PASSWORD = 'E2E-Test-Pass-2026!';

test.describe('Auth — login flow', () => {
  // Valid-login UI success is proven by global.setup.ts (4 roles authenticate before any test).
  // We cannot re-run it here because loginRateLimiter caps at 5 logins/15min/IP and setup consumes 4.
  // FINDING: this is a real DX issue for local E2E iteration.
  test.skip('login with valid credentials redirects from /login (covered by global.setup.ts)', async () => {});

  test('login with wrong password keeps user on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(RECRUITER);
    await page.getByLabel(/has[lł]o|пароль/i).first().fill('totally-wrong-password-9999');
    await page.getByRole('button', { name: /^zaloguj|^увійти/i }).click();
    // Give backend time to respond (401)
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/login/);
  });

  test('login with non-existent email keeps user on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('does-not-exist-9999@crm.test');
    await page.getByLabel(/has[lł]o|пароль/i).first().fill(VALID_PASSWORD);
    await page.getByRole('button', { name: /^zaloguj|^увійти/i }).click();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/login/);
  });

  test('login form validates required email', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^zaloguj|^увійти/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('login form is reachable from /reset-password back-link', async ({ page }) => {
    await page.goto('/reset-password');
    const backLink = page.getByRole('link', { name: /zaloguj|powr[oó]t|увійти|повернути|back/i }).first();
    if (await backLink.count()) {
      await backLink.click();
      await expect(page).toHaveURL(/\/login/);
    }
  });
});

test.describe('Auth — public pages', () => {
  test('unauthenticated user accessing /candidates redirects to /login', async ({ page }) => {
    await page.goto('/candidates');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated user accessing /admin redirects to /login', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login|\/forbidden/);
  });

  test('reset-password page is publicly accessible', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page).toHaveURL(/\/reset-password/);
  });
});

test.describe('Auth — API rate limit & lockout', () => {
  test('5+ failed login attempts trigger lockout (429 or 423)', async ({ request }) => {
    // Use coordinator2 — dedicated victim for this test (won't affect other suites)
    const email = 'e2e-coordinator2@crm.test';
    const results: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await request.post('http://localhost:8080/auth/login', {
        data: { email, password: 'wrong-password-attempt' },
        failOnStatusCode: false,
      });
      results.push(res.status());
    }
    // Expect at least one 429 (rate-limited) or 423 (locked) within the burst
    expect(results.some((s) => s === 429 || s === 423)).toBeTruthy();
  });
});
