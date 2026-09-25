import { defineConfig, devices } from '@playwright/test';

// Playwright config for the M0 spikes only (not part of `npm run e2e`).
// Each spike is built with Vite and served by spikes/shared/serve.ts, which
// applies spikes/shared/public/_headers like Cloudflare Pages does.

const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const launchOptions = executablePath ? { executablePath } : {};

export const S8_PORT = 4180;
export const S3_PORT = 4181;
export const S1_PORT = 4182;
export const S5_PORT = 4183;
export const S7_PORT = 4184;
export const S4_PORT = 4185;
export const S9_PORT = 4186;

// SPIKE=s8|s3|s1|s5|s7|s4|s9 limits which spike gets built and served (default: both).
const only = process.env.SPIKE;
const want = (name: string): boolean => !only || only === name;

const server = (name: string, dir: string, port: number, extra = '', pre = '') => ({
  command: `${pre}npx vite build --config spikes/${dir}/vite.config.ts && node spikes/shared/serve.ts --root spikes/${dir}/dist --port ${String(port)} --report${extra}`,
  cwd: '..',
  url: `http://localhost:${String(port)}`,
  reuseExistingServer: false,
  timeout: 120_000,
  name,
});

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.spec.ts'],
  retries: 0,
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure', launchOptions },
  projects: [
    {
      name: 's8',
      testMatch: ['s8-csp/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(S8_PORT)}` },
    },
    {
      name: 's3',
      testMatch: ['s3-two-engines/**/*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${String(S3_PORT)}`,
        viewport: { width: 1600, height: 1000 },
      },
    },
    {
      name: 's1',
      testMatch: ['s1-save/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(S1_PORT)}` },
    },
    {
      name: 's5',
      testMatch: ['s5-search/**/*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${String(S5_PORT)}`,
        viewport: { width: 1400, height: 1000 },
      },
    },
    {
      name: 's7',
      testMatch: ['s7-snap/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(S7_PORT)}` },
    },
    {
      name: 's4',
      testMatch: ['s4-oxide/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(S4_PORT)}` },
    },
    {
      name: 's9',
      testMatch: ['s9-plugins/**/*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${String(S9_PORT)}`,
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
  webServer: [
    ...(want('s8') ? [server('s8', 's8-csp', S8_PORT)] : []),
    ...(want('s3') ? [server('s3', 's3-two-engines', S3_PORT, ' --corpus corpus')] : []),
    ...(want('s1')
      ? [
          server(
            's1',
            's1-save',
            S1_PORT,
            ' --corpus corpus',
            'node spikes/s1-save/make-fixtures.ts && ',
          ),
        ]
      : []),
    ...(want('s5')
      ? [
          server(
            's5',
            's5-search',
            S5_PORT,
            ' --corpus corpus',
            'node spikes/s5-search/make-contract.ts && ',
          ),
        ]
      : []),
    ...(want('s7')
      ? [
          server(
            's7',
            's7-snap',
            S7_PORT,
            ' --corpus corpus',
            'node spikes/s7-snap/make-fixtures.ts && ',
          ),
        ]
      : []),
    ...(want('s4')
      ? [server('s4', 's4-oxide', S4_PORT, '', 'node spikes/s5-search/make-contract.ts && ')]
      : []),
    ...(want('s9')
      ? [
          server(
            's9',
            's9-plugins',
            S9_PORT,
            ' --corpus spikes/s9-plugins/out',
            'node spikes/s9-plugins/make-fixtures.ts && ',
          ),
        ]
      : []),
  ],
});
