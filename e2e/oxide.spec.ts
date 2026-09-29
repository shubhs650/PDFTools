import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { encryptedVariants, hasQpdf, USER_PW } from './fixtures/encrypted.ts';
import { contractPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M4-04 (ADR-009, §7.6): PDF Oxide in the Work worker — lazy, from our own
// origin by an explicit URL, under the §10.1 CSP (the fixture's guard fails any
// third-party request or CSP violation); PDFium's permission check before any
// Oxide call (rule 9); cancel between pages (rule 2); and the export dialog.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function open(page: Page, name: string, bytes: Uint8Array): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

interface RunResult {
  ok: boolean;
  text?: string;
  pages?: number;
  steps?: number;
  code?: string;
}

test('Oxide loads lazily from our origin, warms up, and extracts the chosen pages', async ({
  page,
  appServer,
}) => {
  const wasm: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.wasm')) wasm.push(r.url());
  });
  const id = await open(page, 'five.pdf', simplePdf(5));
  const warm = (await cap(page, 'extract', 'warm')) as { warmUpMs: number; oxideBytes: number };
  expect(warm.warmUpMs).toBeGreaterThan(0);
  expect(warm.oxideBytes).toBeGreaterThan(0);
  const oxide = wasm.filter((u) => u.includes('pdf_oxide'));
  expect(oxide).toHaveLength(1);
  expect(oxide[0]).toMatch(new RegExp(`^${appServer}/assets/pdf_oxide_bg-[\\w-]+\\.wasm$`));

  const r = (await cap(page, 'extract', 'run', id, [1, 3])) as RunResult;
  expect(r.ok).toBe(true);
  expect(r.pages).toBe(2);
  expect(r.steps).toBeGreaterThanOrEqual(1); // progress is throttled by the RPC layer
  expect(
    (r.text ?? '')
      .split('\f')
      .map((s) => s.trim())
      .filter(Boolean),
  ).toEqual(['Page 2', 'Page 4']);
});

test('a document that denies copying never reaches Oxide (rule 9)', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
  const v = encryptedVariants(simplePdf(2)).find((x) => x.name === 'R6-aes-256');
  if (!v) throw new Error('fixture');
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(v.bytes) }]);
  const dialog = page.getByRole('dialog', { name: 'Password required' });
  await dialog.getByLabel('Password').fill(USER_PW);
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  const r = (await cap(page, 'extract', 'run', id, [0])) as RunResult;
  expect(r).toEqual({ ok: false, code: 'permission-denied:copy' });

  // The dialog says why, in the banner's words, and saves nothing.
  await stubSavePicker(page);
  await cap(page, 'extract', 'openDialog', id, 'text');
  const exp = page.getByRole('dialog', { name: 'Export as Text' });
  await exp.getByRole('button', { name: 'Export' }).click();
  await expect(exp.getByRole('alert')).toHaveText(
    "This document's security settings don't allow copying text and images.",
  );
  expect(await savedFiles(page)).toEqual([]);
});

test('an extraction of 2,000 pages stops promptly when cancelled (rule 2)', async ({ page }) => {
  const id = await open(page, 'contract.pdf', contractPdf(2000));
  await cap(page, 'extract', 'warm');
  const r = (await cap(page, 'extract', 'cancelAfter', id, [...Array(2000).keys()], 400)) as {
    outcome: string;
    stopMs: number;
    done: number;
  };
  expect(r.outcome).toBe('cancelled');
  expect(r.done).toBeLessThan(2000);
  expect(r.stopMs).toBeLessThan(500);
});

test('export dialog: a page range, progress, then the file is saved', async ({ page }) => {
  const id = await open(page, 'report.pdf', simplePdf(6));
  await stubSavePicker(page);
  await cap(page, 'extract', 'openDialog', id, 'text');
  const dialog = page.getByRole('dialog', { name: 'Export as Text' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const range = dialog.getByLabel('Page range');
  await range.fill('9');
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Some pages are not in this document.');
  await range.fill('5-6, 2');
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  expect(await savedFiles(page)).toEqual([
    expect.objectContaining({ name: 'report.txt' }) as unknown,
  ]);
  const last = (await cap(page, 'extract', 'lastExport')) as { text: string };
  expect(
    last.text
      .split('\f')
      .map((s) => s.trim())
      .filter(Boolean),
  ).toEqual(['Page 2', 'Page 5', 'Page 6']);
});
