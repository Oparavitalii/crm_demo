import { defineConfig } from 'vitest/config';

// Integration tests run against a real PostgreSQL (Neon branch).
// `TEST_DATABASE_URL` MUST be set — we fail fast at config load rather than
// silently skip, because if you opted into `test:integration` you meant it.
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set.\n' +
      'Point it at a disposable Neon branch (e.g. `neondb-test`) and ensure\n' +
      'migrations have been applied there:\n' +
      '  TEST_DATABASE_URL=$NEON_TEST_URL npm run db:migrate -w @crm/api\n' +
      'Then re-run: npm run test:integration -w @crm/api',
  );
}

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.test.ts'],
    setupFiles: ['./src/__tests__/integration/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Serial execution: a single test database can't be torn apart safely
    // by parallel workers. TRUNCATE between tests assumes one writer.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Worker env. The shared `env.ts` reads these at module load time, so the
    // service / repo layer sees the test branch the moment it imports `db`.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDbUrl,
      DATABASE_URL_DIRECT: testDbUrl,
      JWT_SECRET: 'integration-tests-jwt-secret-padding-32+',
      JWT_REFRESH_SECRET: 'integration-tests-refresh-secret-padding-32+',
      R2_ENDPOINT: 'https://example.com',
      R2_ACCESS_KEY: 'x',
      R2_SECRET_KEY: 'x',
      R2_BUCKET: 'x',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  },
});
