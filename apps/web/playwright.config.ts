import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium-admin',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
      testIgnore: /\.recruiter\.spec\.ts|\.coordinator\.spec\.ts|\.readonly\.spec\.ts|\.public\.spec\.ts|\.unauth\.spec\.ts/,
    },
    {
      name: 'chromium-recruiter',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/recruiter.json' },
      dependencies: ['setup'],
      testMatch: /\.recruiter\.spec\.ts/,
    },
    {
      name: 'chromium-coordinator',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/coordinator.json' },
      dependencies: ['setup'],
      testMatch: /\.coordinator\.spec\.ts/,
    },
    {
      name: 'chromium-readonly',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/readonly.json' },
      dependencies: ['setup'],
      testMatch: /\.readonly\.spec\.ts/,
    },
    {
      name: 'chromium-unauth',
      use: { ...devices['Desktop Chrome'] },
      // Not for the storageState — for ordering. loginRateLimiter allows 5
      // POST /auth/login per 15 min per client IP, and on a CI runner every
      // request shares one key. setup spends 4 of them; auth.unauth.spec then
      // deliberately burns the rest (wrong password, unknown email, 8-attempt
      // lockout burst). Run in parallel, the burst could land first and
      // 429 the role logins, failing every authenticated project.
      dependencies: ['setup'],
      testMatch: /\.(public|unauth)\.spec\.ts/,
    },
  ],
});
