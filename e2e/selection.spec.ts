import type { BrowserContext, Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, contractPdf, simplePdf } from './fixtures/generate.ts';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-04: text selection and copy (M1-Q5, §8.1, rule 9, ADR-012 decision 1).

const view = (page: Page) => page.getByTestId('document-view');
const selectionRects = (page: Page) =>
  page.locator('[data-page="0"] .page-content div[style*="mix-blend-mode"] > div');
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

async function clipboard(context: BrowserContext, page: Page, set?: string): Promise<string> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (set !== undefined) await page.evaluate((t) => navigator.clipboard.writeText(t), set);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Screen point of a PDF-space point (origin bottom-left) on page 0 at the current zoom. */
async function at(page: Page, x: number, y: number, pageHeight = 842, pageWidth = 595) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / pageWidth;
  return { x: box.x + x * s, y: box.y + (pageHeight - y) * s };
}

async function openDoc(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  await page.goto('/');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

test('dragging over text selects it; Ctrl+C copies it', async ({ page, context }) => {
  await openDoc(page, 'simple.pdf', simplePdf(1)); // "Page 1" at (72, 740), 36 pt
  await clipboard(context, page, 'before');
  const from = await at(page, 66, 752);
  const to = await at(page, 190, 752);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(selectionRects(page).first()).toBeVisible();
  await view(page).focus();
  await page.keyboard.press('Control+C');
  await expect.poll(() => clipboard(context, page)).toBe('Page 1');
});

test('Ctrl+A selects the current page text; Esc clears it', async ({ page, context }) => {
  await openDoc(page, 'contract.pdf', contractPdf(3));
  await clipboard(context, page, 'before');
  await view(page).focus();
  await page.keyboard.press('Control+A');
  await expect(selectionRects(page).first()).toBeVisible();
  await page.keyboard.press('Control+C');
  await expect
    .poll(() => clipboard(context, page))
    .toMatch(/^52\.200-1 Clause 1\. Contractor obligations/);
  await page.keyboard.press('Escape');
  await expect(selectionRects(page)).toHaveCount(0);
});

test('the Hand tool pans and never selects', async ({ page }) => {
  await openDoc(page, 'simple.pdf', simplePdf(1));
  await view(page).focus();
  await page.keyboard.press('h');
  const from = await at(page, 66, 752);
  const to = await at(page, 190, 752);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(selectionRects(page)).toHaveCount(0);
});

test('a rotated page: Ctrl+A copies its text (geometry in the viewer’s page space)', async ({
  page,
  context,
}) => {
  const rotated = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 24 Tf 72 760 Td (Rotated text) Tj ET' },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
  await openDoc(page, 'rotated.pdf', rotated);
  await clipboard(context, page, 'before');
  await view(page).focus();
  await page.keyboard.press('Control+A');
  await expect(selectionRects(page).first()).toBeVisible();
  await page.keyboard.press('Control+C');
  await expect.poll(() => clipboard(context, page)).toBe('Rotated text');
});

test('copying is refused when the document forbids it (rule 9)', async ({ page, context }) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
  const noCopy = qpdfEncrypt(simplePdf(1), '', 'owner', ['256', '--extract=n']);
  await openDoc(page, 'no-copy.pdf', noCopy);
  await expect(page.getByRole('region', { name: 'Document restrictions' })).toContainText(
    'copying',
  );
  await clipboard(context, page, 'before');
  await view(page).focus();
  await page.keyboard.press('Control+A');
  await expect(selectionRects(page).first()).toBeVisible(); // selecting is allowed
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(300);
  expect(await clipboard(context, page)).toBe('before');
});
