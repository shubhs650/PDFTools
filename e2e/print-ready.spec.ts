import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { fullFormPdf, printPdf } from './fixtures/generate.ts';
import { makeSigner, signedPdf } from './fixtures/signed.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M2-16 (D-25, §7.13, ADR-013 decisions 6–7): Export Print-Ready PDF flattens
// a copy in the Work worker (the open document stays as it is) and saves it as
// a new file; the print dialog can print that copy through the browser's PDF
// viewer in a blob: frame (§10.1 `frame-src blob:`).

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export Print-Ready PDF' });
const latin1 = (u: Uint8Array) => Buffer.from(u).toString('latin1');

/** qpdf --check status, and the file with streams uncompressed (null without qpdf). */
function qpdf(bytes: Uint8Array): { check: number | null; qdf: string } | null {
  if (!hasQpdf()) return null;
  const dir = mkdtempSync(join(tmpdir(), 'pdftools-pr-'));
  const f = join(dir, 'out.pdf');
  writeFileSync(f, bytes);
  const check = spawnSync('qpdf', ['--check', f]).status;
  const qdf = spawnSync('qpdf', ['--qdf', '--object-streams=disable', f, '-']).stdout;
  return { check, qdf: latin1(qdf) };
}

async function openExport(page: Page): Promise<void> {
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Export Print-Ready PDF' }).first().click();
  await backstage
    .getByRole('region')
    .getByRole('button', { name: 'Export Print-Ready PDF' })
    .click();
  await expect(exportDialog(page)).toBeVisible();
}

test('a filled form with an unsaved markup exports flattened (download path); the tab is untouched', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.goto('/');
  await drop(page, [{ name: 'form.pdf', b64: b64(fullFormPdf()) }]);
  const name = page.getByRole('textbox', { name: 'name field' });
  await name.fill('Changed');
  await name.press('Enter');
  const id = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await expect(tabs(page).first()).toHaveAccessibleName(/unsaved/);

  await openExport(page);
  const d = exportDialog(page);
  await expect(d.getByTestId('print-ready-signed')).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const download = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Export…' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('form (print-ready).pdf');
  await expect(d).toHaveCount(0);
  const bytes = new Uint8Array(readFileSync(await file.path()));

  const text = latin1(bytes);
  expect(text).not.toContain('/AcroForm');
  expect(text).not.toContain('/Annots');
  expect(text).not.toMatch(/\/Subtype\s*\/Image/); // vector
  const q = qpdf(bytes);
  if (q) {
    expect(q.check).toBe(0);
    expect(q.qdf).toContain('(Changed)'); // the unsaved value, burned in
    expect(q.qdf).not.toContain('(Initial)'); // the old value's field object is gone
  }
  // The open document is as it was: its unsaved changes still there.
  await expect(tabs(page).first()).toHaveAccessibleName(/unsaved/);
  await expect(name).toHaveValue('Changed');
});

test('save picker path: a clean document stays clean; a signed one warns', async ({ page }) => {
  await page.goto('/');
  await stubSavePicker(page);
  await drop(page, [{ name: 'print.pdf', b64: b64(printPdf()) }]);
  await expect(page.getByRole('tab', { name: 'print.pdf', exact: true })).toBeVisible();
  await openExport(page);
  await exportDialog(page).getByRole('button', { name: 'Export…' }).click();
  await expect(exportDialog(page)).toHaveCount(0);
  const saved = await savedFiles(page);
  expect(saved.map((s) => s.name)).toEqual(['print (print-ready).pdf']);
  expect(saved[0]?.bytes).toBeGreaterThan(500);
  await expect(page.getByRole('tab', { name: 'print.pdf', exact: true })).toBeVisible();

  const signed = await signedPdf(await makeSigner('Print Ready Test'));
  await drop(page, [{ name: 'signed.pdf', b64: b64(signed) }]);
  await expect(page.getByRole('tab', { name: 'signed.pdf', exact: true })).toBeVisible();
  await openExport(page);
  await expect(exportDialog(page).getByTestId('print-ready-signed')).toHaveText(
    'This document is digitally signed. The copy carries no valid signature.',
  );
  await exportDialog(page).getByRole('button', { name: 'Close' }).first().click();
  await expect(exportDialog(page)).toHaveCount(0);
});

test('print via the browser PDF viewer: the print-ready copy in a blob: frame, no CSP violation', async ({
  page,
  guard,
}) => {
  // Record the blobs made for frames, and count print() in the viewer frame
  // (init scripts also run in child frames).
  await page.addInitScript(() => {
    const w = window as unknown as { pdfBlobs?: Blob[]; viewerPrints?: number };
    if (window.top === window) {
      w.pdfBlobs = [];
      w.viewerPrints = 0;
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource) => {
        if (o instanceof Blob && o.type === 'application/pdf') w.pdfBlobs?.push(o);
        return create(o);
      };
    } else if (location.protocol === 'blob:') {
      window.print = () => {
        const top = window.top as unknown as { viewerPrints: number };
        top.viewerPrints++;
      };
    }
  });
  await page.goto('/');
  await drop(page, [{ name: 'print.pdf', b64: b64(printPdf()) }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.keyboard.press('Control+P');
  const d = page.getByRole('dialog', { name: 'Print' });
  await d.getByRole('radio', { name: 'Pages:' }).check();
  await d.getByRole('textbox', { name: 'Page range' }).fill('3, 1');
  await d.getByRole('radio', { name: /browser's PDF viewer/ }).check();
  await expect(d.getByRole('radio', { name: 'Fit to paper' })).toBeDisabled();
  await expect(d).toContainText("your browser's own print dialog");
  await d.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(d).toHaveCount(0);

  const frame = page.locator('iframe.print-viewer-frame');
  await expect(frame).toHaveCount(1);
  expect(await frame.getAttribute('src')).toMatch(/^blob:/);
  const bytes = new Uint8Array(
    await page.evaluate(async () => {
      const blobs = (window as unknown as { pdfBlobs: Blob[] }).pdfBlobs;
      const last = blobs[blobs.length - 1];
      return last ? [...new Uint8Array(await last.arrayBuffer())] : [];
    }),
  );
  const text = latin1(bytes);
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toMatch(/\/Count 2\b/); // pages 1 and 3, in document order
  expect(text).not.toContain('/Annots');
  if (hasQpdf()) expect(qpdf(bytes)?.check).toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { viewerPrints: number }).viewerPrints))
    .toBe(1);
  // The frame loaded under the CSP: the fixture's guard fails the test on any violation.
  expect(await guard.documentCspViolations()).toEqual([]);
});

test('rule 9: print denied disables the export; standard-quality only disables the viewer route', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixtures');
  await page.goto('/');
  const none = qpdfEncrypt(printPdf(), '', 'owner-pw', ['256', '--print=none']);
  await drop(page, [{ name: 'noprint.pdf', b64: b64(none) }]);
  await expect(page.getByRole('tab', { name: 'noprint.pdf' })).toBeVisible();
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Export Print-Ready PDF' }).first().click();
  await expect(
    backstage.getByRole('region').getByRole('button', { name: 'Export Print-Ready PDF' }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  const low = qpdfEncrypt(printPdf(), '', 'owner-pw', ['256', '--print=low']);
  await drop(page, [{ name: 'lowprint.pdf', b64: b64(low) }]);
  await expect(page.getByRole('tab', { name: 'lowprint.pdf' })).toBeVisible();
  await page.keyboard.press('Control+P');
  const d = page.getByRole('dialog', { name: 'Print' });
  await expect(d.getByRole('radio', { name: /browser's PDF viewer/ })).toBeDisabled();
  await expect(d.getByRole('radio', { name: /This app/ })).toBeChecked();
  await expect(d).toContainText("the browser's PDF viewer isn't used");
});
