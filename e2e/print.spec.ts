import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { printPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { printCalls, stubFramePrint } from './support/printStub.ts';

// M2-15 (D-25, §7.13): our print dialog renders pages in the Work worker and
// prints them from a hidden same-origin frame. Headless Chromium has no print
// dialog, so the frame's print() is replaced by a counter and the print
// document is inspected instead.

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Print' });

interface Sheet {
  landscape: boolean;
  width: string;
  bands: { w: number; h: number }[];
}

/** The print document: each page's orientation, sheet width and band image sizes. */
const printDocument = (page: Page): Promise<Sheet[]> =>
  page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe.print-frame');
    const doc = frame?.contentDocument;
    if (!doc) return [];
    return [...doc.querySelectorAll<HTMLElement>('.page')].map((p) => ({
      landscape: p.classList.contains('landscape'),
      width: p.querySelector<HTMLElement>('.sheet')?.style.width ?? '',
      bands: [...p.querySelectorAll('img')].map((i) => ({ w: i.naturalWidth, h: i.naturalHeight })),
    }));
  });

/** RGBA of a pixel of page `p`'s first band. */
const pixel = (page: Page, p: number, x: number, y: number): Promise<number[]> =>
  page.evaluate(
    ([p, x, y]) => {
      const doc = document.querySelector<HTMLIFrameElement>('iframe.print-frame')?.contentDocument;
      const img = doc?.querySelectorAll('.page')[p]?.querySelector('img');
      if (!img) return [];
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data];
    },
    [p, x, y] as const,
  );

async function openPrintFixture(page: Page, bytes = printPdf(), name = 'print.pdf'): Promise<void> {
  await stubFramePrint(page);
  await page.goto('/');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
}

test('Ctrl+P: all pages at standard quality, orientation per page, then print()', async ({
  page,
}) => {
  await openPrintFixture(page);
  await page.keyboard.press('Control+P');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByTestId('print-count')).toHaveText('3 pages will print.');
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await d.getByRole('button', { name: 'Print', exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(1);
  await expect(d).toHaveCount(0);
  const sheets = await printDocument(page);
  // A4 at 150 DPI: 1240 × 1754 px in two bands (1,024 + 730 rows).
  expect(sheets[0]).toEqual({
    landscape: false,
    width: expect.stringContaining('min(100vw') as unknown as string,
    bands: [
      { w: 1240, h: 1024 },
      { w: 1240, h: 730 },
    ],
  });
  expect(sheets.map((s) => s.landscape)).toEqual([false, true, true]); // /Rotate 90 prints landscape
  expect(sheets[2]?.bands[0]?.w).toBe(1754);
  // The printable square is red; the screen-only one isn't printed (x 450, y 740 pt).
  expect(await pixel(page, 0, Math.round((100 * 150) / 72), Math.round((90 * 150) / 72))).toEqual([
    255, 0, 0, 255,
  ]);
  expect(
    await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('iframe.print-frame')?.contentDocument;
      return doc?.querySelectorAll('.page')[0]?.querySelectorAll('img').length;
    }),
  ).toBe(2);
});

test('custom range and scale are validated; markups only; actual size; unsaved edits print', async ({
  page,
}) => {
  await openPrintFixture(page);
  const id = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  // An unsaved annotation: a red-bordered square at x 20–40, y 20–40 pt on page 1.
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();

  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Print' }).first().click();
  await backstage.getByRole('region').getByRole('button', { name: 'Print' }).click();
  const d = dialog(page);
  await d.getByRole('radio', { name: 'Pages:' }).check();
  const range = d.getByRole('textbox', { name: 'Page range' });
  await range.fill('x');
  await expect(d.getByRole('alert')).toHaveText('Use page numbers and ranges, e.g. 1-3, 8.');
  await expect(d.getByRole('button', { name: 'Print', exact: true })).toBeDisabled();
  await range.fill('4');
  await expect(d.getByRole('alert')).toHaveText('Some pages are not in this document.');
  await range.fill('1');
  await expect(d.getByTestId('print-count')).toHaveText('1 page will print.');

  await d.getByRole('radio', { name: 'Custom scale' }).check();
  const pct = d.getByRole('spinbutton', { name: 'Scale (%)' });
  await pct.fill('5');
  await expect(d.getByRole('alert')).toHaveText('Enter a scale from 10 to 400 %.');
  await d.getByRole('radio', { name: 'Actual size' }).check();
  await d.getByRole('radio', { name: 'Markups only' }).check();
  await d.getByRole('button', { name: 'Print', exact: true }).click();
  await expect.poll(() => printCalls(page)).toBe(1);

  const [sheet] = await printDocument(page);
  expect(sheet?.width).toBe('595pt');
  const px = (x: number, y: number) =>
    pixel(page, 0, Math.round((x * 150) / 72), Math.round((y * 150) / 72));
  expect(await px(100, 90)).toEqual([255, 0, 0, 255]); // markup kept
  expect(await px(100, 220)).toEqual([255, 255, 255, 255]); // page content dropped
  const edge = await px(21, 30); // the unsaved square's border
  expect(edge.slice(0, 3)).not.toEqual([255, 255, 255]);
});

test('cancel stops rendering: no print, no error, the dialog stays', async ({ page, pdfs }) => {
  await stubFramePrint(page);
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(200).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.keyboard.press('Control+P');
  const d = dialog(page);
  await d.getByRole('radio', { name: 'High, for drawings (300 DPI)' }).check();
  await d.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(d.getByRole('progressbar', { name: 'Preparing pages for printing' })).toBeVisible();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d.getByRole('progressbar')).toHaveCount(0);
  await expect(d.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
  await expect(d.getByRole('alert')).toHaveCount(0);
  expect(await printCalls(page)).toBe(0);
  await expect(page.locator('iframe.print-frame')).toHaveCount(0);
});

test('printing forbidden: the commands are disabled; low-quality only: high DPI is off (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixtures');
  const none = qpdfEncrypt(printPdf(), '', 'owner-pw', ['256', '--print=none']);
  await openPrintFixture(page, none, 'noprint.pdf');
  await page.keyboard.press('Control+P');
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('toolbar', { name: 'Quick access' }).getByRole('button', { name: 'Print' }),
  ).toHaveAttribute('aria-disabled', 'true');

  const low = qpdfEncrypt(printPdf(), '', 'owner-pw', ['256', '--print=low']);
  await drop(page, [{ name: 'lowprint.pdf', b64: b64(low) }]);
  await expect(page.getByRole('tab', { name: 'lowprint.pdf' })).toBeVisible();
  await page.keyboard.press('Control+P');
  const d = dialog(page);
  await expect(d.getByRole('radio', { name: 'High, for drawings (300 DPI)' })).toBeDisabled();
  await expect(d.getByRole('radio', { name: 'Standard (150 DPI)' })).toBeChecked();
  await expect(d).toContainText('allow standard quality only');
});
