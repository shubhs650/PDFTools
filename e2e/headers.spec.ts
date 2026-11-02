import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHeadersFile } from '../scripts/headers.ts';
import { E2E_DIST } from './support/paths.ts';
import { expect, test } from './support/fixtures.ts';

// ARCHITECTURE §10.1, verbatim. If this changes, an ADR must change it first.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; " +
  "connect-src 'self'; img-src 'self' blob: data:; font-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; frame-src blob:; object-src 'none'; base-uri 'none'; " +
  "frame-ancestors 'none'; form-action 'none'";

test('the built _headers carry the §10.1 CSP verbatim plus COOP/COEP', () => {
  const rules = parseHeadersFile(readFileSync(join(E2E_DIST, '_headers'), 'utf8'));
  const all = Object.fromEntries(rules.flatMap((r) => r.headers));
  expect(all['Content-Security-Policy']).toBe(CSP);
  expect(all['Cross-Origin-Opener-Policy']).toBe('same-origin');
  expect(all['Cross-Origin-Embedder-Policy']).toBe('require-corp');
});

test('the document is served with the CSP and is cross-origin isolated @smoke', async ({
  page,
}) => {
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy']).toBe(CSP);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test('the e2e build exposes the test hook', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __pdftoolsTest?: { version: number } }).__pdftoolsTest?.version,
      ),
    )
    .toBe(1);
});
