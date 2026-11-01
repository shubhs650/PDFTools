import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M1-07: the hosted Render worker, the encoder worker and the engine factory,
// driven through the e2e-only engine probe (src/testing/engineProbe.ts).

type Mode = 'local' | 'none' | 'cdn-negative-control';
interface ProbeResult {
  pageCount: number;
  permissions: number;
  signatureCount: number;
  ink: number;
  pngBytes: number;
  pngType: string;
}
interface Probe {
  openAndRender(
    b64: string,
    mode: Mode,
    password?: string,
  ): Promise<ProbeResult | { error: string }>;
  createWithUndefinedFonts(): string;
}

async function probe(page: Page, bytes: Buffer, mode: Mode, password?: string) {
  await page.waitForFunction(() => {
    const h = (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
      .__pdftoolsTest;
    return Boolean(h?.capabilities.engine);
  });
  return page.evaluate(
    ([b64, m, pw]) => {
      const p = (window as unknown as { __pdftoolsTest: { capabilities: { engine: Probe } } })
        .__pdftoolsTest.capabilities.engine;
      return p.openAndRender(b64, m, pw ?? undefined);
    },
    [bytes.toString('base64'), mode, password ?? null] as const,
  );
}

const S1 = 'e2e/fixtures/self-made/s1-interop';

test('CJK text renders with the self-hosted fallback fonts, from our origin', async ({
  page,
  pdfs,
}) => {
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/fonts/')) fontRequests.push(new URL(r.url()).pathname);
  });
  await page.goto('/');
  const local = await probe(page, pdfs.cjk(), 'local');
  const none = await probe(page, pdfs.cjk(), 'none');
  if ('error' in local || 'error' in none) throw new Error(JSON.stringify({ local, none }));
  // S8 reference: ~5.7k dark pixels with the font, ~0.5k (Latin line only) without.
  expect(local.ink).toBeGreaterThan(3 * none.ink);
  expect(fontRequests).toContain('/fonts/sc/NotoSansHans-Regular.otf');
});

test('negative control: EmbedPDF’s default CDN fonts are blocked by the CSP (ADR-003) @smoke', async ({
  page,
  pdfs,
  guard,
}) => {
  await page.goto('/');
  await probe(page, pdfs.cjk(), 'cdn-negative-control');
  // The fetch happens inside the Render worker, so only the Report-Only endpoint sees it.
  await expect
    .poll(async () => JSON.stringify(await guard.reportedCspViolations()))
    .toContain('cdn.jsdelivr.net');
  await guard.acknowledge();
});

test('createRenderEngine refuses an undefined fontFallback', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
        .__pdftoolsTest?.capabilities.engine,
    ),
  );
  const out = await page.evaluate(() =>
    (
      window as unknown as { __pdftoolsTest: { capabilities: { engine: Probe } } }
    ).__pdftoolsTest.capabilities.engine.createWithUndefinedFonts(),
  );
  expect(out).toBe('rejected');
});

test('permission flags and signature count come with the document (rule 9, D-06)', async ({
  page,
}) => {
  await page.goto('/');
  const read = (f: string) => readFileSync(join(S1, f));
  const plain = await probe(page, read('original__plain.pdf'), 'none');
  const noAnnot = await probe(page, read('original__encrypted-noannotate.pdf'), 'none');
  const signed = await probe(page, read('original__signed.pdf'), 'none');
  if ('error' in plain || 'error' in noAnnot || 'error' in signed) throw new Error('open failed');
  expect(plain.permissions >>> 0).toBe(0xffffffff);
  expect(noAnnot.permissions & (1 << 5)).toBe(0);
  expect(signed.signatureCount).toBe(1);
  // Images are encoded in the encoder worker and come back as PNG blobs.
  expect(plain.pngType).toBe('image/png');
  expect(plain.pngBytes).toBeGreaterThan(100);
});

test('a file with an open password reports needs-password; the right password opens it', async ({
  page,
  pdfs,
}) => {
  let qpdf = true;
  try {
    execFileSync('qpdf', ['--version']);
  } catch {
    qpdf = false;
  }
  test.skip(!qpdf, 'qpdf is needed to make the encrypted fixture');
  const dir = mkdtempSync(join(tmpdir(), 'pdftools-pw-'));
  writeFileSync(join(dir, 'in.pdf'), pdfs.simple(2));
  execFileSync('qpdf', [
    '--encrypt',
    'user-pw',
    'owner-pw',
    '256',
    '--',
    join(dir, 'in.pdf'),
    join(dir, 'out.pdf'),
  ]);
  const locked = readFileSync(join(dir, 'out.pdf'));
  await page.goto('/');
  expect(await probe(page, locked, 'none')).toEqual({ error: 'needs-password' });
  const opened = await probe(page, locked, 'none', 'user-pw');
  expect('pageCount' in opened && opened.pageCount).toBe(2);
});

test('both engines load the one self-hosted pdfium.wasm (ADR-004 decision 6)', async ({
  page,
  pdfs,
}) => {
  const wasm: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.wasm')) wasm.push(new URL(r.url()).pathname);
  });
  await page.goto('/');
  await probe(page, pdfs.simple(), 'none');
  await probe(page, pdfs.simple(), 'local');
  expect(new Set(wasm).size).toBe(1);
  expect([...new Set(wasm)][0]).toMatch(/^\/assets\/pdfium-[\w-]+\.wasm$/);
});
