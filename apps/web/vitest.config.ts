import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Vitest defaults pick up every *.spec.ts under the project root, which sweeps
// in our Playwright e2e specs (apps/web/e2e/**) — they then crash trying to
// run inside vitest. Restrict vitest to unit-test paths only.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json-summary'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/__tests__/**',
          'src/main.tsx',
          'src/vite-env.d.ts',
        ],
        // Web baseline is intentionally narrow — page-level UI is covered by
        // Playwright. These floors gate regression on the *unit-tested* slice
        // (lib/, stores/, hooks/, isolated components) so a new test deletion
        // breaks CI rather than slipping in silently. Bumps go to
        // Testing_Strategy.md as a baseline date update.
        thresholds: {
          autoUpdate: false,
          lines: 9,
          branches: 50,
          functions: 23,
          statements: 9,
        },
      },
    },
  }),
);
