import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import i18next from 'eslint-plugin-i18next';
import prettier from 'eslint-config-prettier';

export default defineConfig(
  {
    ignores: [
      'dist',
      'coverage',
      'test-results',
      'playwright-report',
      'node_modules',
      'corpus/files',
      'spikes/**/dist',
      'spikes/**/out',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Application code (browser + workers)
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
      i18next,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // CLAUDE.md rule 12: keyboard-reachable controls with accessible names
      ...jsxA11y.flatConfigs.strict.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // CLAUDE.md rule 11: no hardcoded user-visible strings in JSX
      'i18next/no-literal-string': ['error', { mode: 'jsx-only' }],
    },
  },
  // M0 spike code (throwaway; browser, workers and Node tooling)
  {
    files: ['spikes/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker, ...globals.node },
    },
  },
  // Tooling, tests and config files (Node)
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'e2e/**/*.ts', '*.config.{ts,js}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
