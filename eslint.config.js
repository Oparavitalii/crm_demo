import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import hooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // TypeScript itself handles undefined-name checks; no-undef produces
      // false positives for DOM type aliases (HeadersInit, etc.) in .ts files.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/api/**/*.{ts,tsx}', 'apps/api/drizzle.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['apps/web/**/*.tsx'],
    plugins: { react: reactPlugin, 'react-hooks': hooksPlugin },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...hooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Test/seed/e2e files: console output is intentional (assertions, fixtures,
    // visible progress when seeding), not a code-quality issue.
    files: [
      'apps/*/src/__tests__/**/*.{ts,tsx}',
      'apps/api/src/db/seed*.ts',
      'apps/web/e2e/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/.vite/**',
      '**/coverage/**',
      // Dev/CLI scripts naturally use console.log and have own conventions —
      // not part of the production codebase, exclude from lint gate.
      'scripts/**',
      'apps/*/scripts/**',
      // Generated artifacts from Playwright / E2E runs (minified bundles).
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.playwright-mcp/**',
      // Playwright e2e specs run in their own Node runner with its own
      // conventions (console, dynamic fixtures) — not part of unit-lint gate.
      'apps/web/e2e/**',
      // Ad-hoc debug scripts in tmp/ are throwaway, not production code.
      'tmp/**',
      // Service worker has its own runtime context (self, caches, Response).
      'apps/web/public/sw.js',
    ],
  },
];
