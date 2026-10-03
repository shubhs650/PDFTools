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
export const S11_PORT = 4187;
export const S11_FRAME_PORT = 4188;
export const S13_PORT = 4189;
export const S17_PORT = 4190;

// SPIKE=s8|s3|s1|s5|s7|s4|s9|s11|s13|s17 limits which spike gets built and served (default: both).
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
    {
      name: 's11',
      testMatch: ['s11-secure-print/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(S11_PORT)}` },
    },
    {
      name: 's13',
      testMatch: ['s13-stamps-crs/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(S13_PORT)}` },
    },
    {
      name: 's17',
      testMatch: ['s17-ocr/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(S17_PORT)}` },
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
    ...(want('s11')
      ? [
          server('s11', 's11-secure-print', S11_PORT, ' --coi'),
          // The same build with only `frame-src blob:` added to the CSP (ADR-013 proposal).
          {
            command: `npx vite build --config spikes/s11-secure-print/vite.config.ts --outDir dist-frame && node spikes/s11-secure-print/frame-variant.ts && node spikes/shared/serve.ts --root spikes/s11-secure-print/dist-frame --port ${String(S11_FRAME_PORT)} --report --coi`,
            cwd: '..',
            url: `http://localhost:${String(S11_FRAME_PORT)}`,
            reuseExistingServer: false,
            timeout: 180_000,
            name: 's11-frame',
          },
        ]
      : []),
    ...(want('s13') ? [server('s13', 's13-stamps-crs', S13_PORT, ' --coi')] : []),
    ...(want('s17')
      ? [
          server(
            's17',
            's17-ocr',
            S17_PORT,
            ' --coi',
            'node --import ./spikes/shared/ts-ext.ts spikes/s17-ocr/run-node.ts > /dev/null && ',
          ),
        ]
      : []),
  ],
});
