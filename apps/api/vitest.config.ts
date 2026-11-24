import { defineConfig } from 'vitest/config';

// Default config: unit tests only. Integration tests live under
// `src/__tests__/integration/**` and need a real Neon branch; they run under
// `vitest.integration.config.ts` via `npm run test:integration`.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/__tests__/integration/**',
    ],
    // MSW lifecycle: see `src/__tests__/_msw/setup.ts` for the rationale on
    // `onUnhandledRequest: 'warn'` vs 'error'.
    setupFiles: ['./src/__tests__/_msw/setup.ts'],
    // 15s default. bcrypt + v8 coverage instrumentation pushes login/2FA tests
    // past the 5s vitest default on slower runners. Individual tests can still
    // override with the third arg to it().
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/db/migrations/**',
        'src/db/seed*.ts',
        'src/scripts/**',
        'src/__tests__/**',
        'src/index.ts',
      ],
      // Gate against regression — NOT a push-higher target. Floors sit a few
      // points below the 2026-06-15 baseline so CI does not flap on noise.
      // Per-directory thresholds protect critical layers (services, middleware)
      // where every uncovered branch is a security/RODO concern.
      thresholds: {
        autoUpdate: false,
        lines: 48,
        branches: 73,
        functions: 44,
        statements: 48,
        'src/services/**': {
          lines: 60,
          branches: 75,
          functions: 55,
          statements: 60,
        },
        'src/middleware/**': {
          lines: 80,
          branches: 90,
          // Functions floor stays low — middleware files export many small
          // helpers (e.g. role guards, error mappers) that share lines but
          // aren't all hit per-test. Lines + branches do the real gating.
          functions: 35,
          statements: 80,
        },
      },
    },
  },
});
