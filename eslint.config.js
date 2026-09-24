import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
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
      i18next,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // CLAUDE.md rule 11: no hardcoded user-visible strings in JSX
      'i18next/no-literal-string': ['error', { mode: 'jsx-only' }],
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
