import { defineConfig, devices } from '@playwright/test';

const PORT = '4173';

// Optional override for environments with a pre-installed browser that doesn't
// match this Playwright version (e.g. cloud dev containers). CI uses the
// browser installed by `npx playwright install`.
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
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
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
