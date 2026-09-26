import { defineConfig, devices } from '@playwright/test';

// The app is built once (e2e/support/global-setup.ts) and each worker serves it
// with scripts/serve.ts and the production `_headers` (e2e/support/fixtures.ts).
// Tests import `test`/`expect` from e2e/support/fixtures.ts.

// Optional override for environments with a pre-installed browser that doesn't
// match this Playwright version (e.g. cloud dev containers). CI uses the
// browser installed by `npx playwright install`.
//
// @playwright/test is pinned to 1.62.1 (Chromium 151): Chromium/Chrome 153 in
// headless mode crashes the whole browser when a FileSystemFileHandle is read
// back from IndexedDB, which the recent-files list does (M1-18). Headed Chrome
// and Edge 154 are fine. Re-test before bumping (docs/PROGRESS.md open issues).
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/support/global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    launchOptions,
  },
  projects: [
    {
      name: 'e2e',
      testIgnore: ['perf/**'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'perf',
      testMatch: ['perf/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
