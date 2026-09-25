// Builds the app once per Playwright run in the `e2e` mode (test hook
// included, M1-Q3) into dist-e2e/. Set E2E_SKIP_BUILD=1 to reuse an existing
// build while iterating on tests.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_DIST } from './paths.ts';

export default function globalSetup(): void {
  if (process.env.E2E_SKIP_BUILD === '1' && existsSync(join(E2E_DIST, 'index.html'))) return;
  execFileSync('npx', ['vite', 'build', '--mode', 'e2e', '--outDir', E2E_DIST, '--emptyOutDir'], {
    stdio: 'inherit',
  });
}
