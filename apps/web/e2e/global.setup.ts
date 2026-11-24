import { test as setup, expect } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const ROLES = [
  { name: 'admin', email: 'e2e-admin@opushr.test' },
  { name: 'recruiter', email: 'e2e-recruiter@opushr.test' },
  { name: 'coordinator', email: 'e2e-coordinator@opushr.test' },
  { name: 'readonly', email: 'e2e-readonly@opushr.test' },
];

const PASSWORD = 'E2E-Test-Pass-2026!';
// Refresh-token cookie is 7-day TTL; reuse storageState if fresh enough to avoid
// burning loginRateLimiter quota (5/15min/IP).
const STORAGE_TTL_MS = 6 * 24 * 60 * 60 * 1000;

async function isStorageFresh(file: string): Promise<boolean> {
  try {
    const s = await stat(file);
    return Date.now() - s.mtimeMs < STORAGE_TTL_MS;
  } catch {
    return false;
  }
}

for (const role of ROLES) {
  setup(`authenticate as ${role.name}`, async ({ page }) => {
    const authFile = `e2e/.auth/${role.name}.json`;
    await mkdir(dirname(authFile), { recursive: true });

    if (await isStorageFresh(authFile)) {
      // Trust existing storageState — skip UI login to spare rate limit.
      return;
    }

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(role.email);
    await page.getByLabel(/has[lł]o|пароль|password/i).first().fill(PASSWORD);
    await page.getByRole('button', { name: /^zaloguj|^увійти|^log in|^sign in/i }).click();

    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/login/);

    await page.context().storageState({ path: authFile });
  });
}
