import type { Page } from '@playwright/test';
import { buildPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-15 (§7.4, D-14, ADR-007): page scales — Set Scale and Calibrate write the
// page's /VP with a /Measure RL through the object layer (one Ctrl+S revision);
// /VP from files (ours and viewers') is read back; "Uncalibrated" otherwise.

const indicator = (page: Page) => page.getByTestId('scale-indicator');
const measure = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });

async function open(page: Page, bytes: Uint8Array = simplePdf(2)): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await page.getByRole('tab', { name: 'Measure' }).click();
  return id;
}

async function save(page: Page, id: string, original: Uint8Array) {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(s).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(s.tail, 'base64');
  return { file: Buffer.concat([Buffer.from(original), tail]), tail: tail.toString('latin1') };
}

test('Set Scale 1:100 in metres on all pages: /VP saved, read back after reopening', async ({
  page,
}) => {
  const bytes = simplePdf(2);
  const id = await open(page, bytes);
  await expect(indicator(page)).toHaveText('Uncalibrated');
  await measure(page).getByRole('button', { name: 'Set Scale' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill('100');
  await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
  await dialog.getByLabel('All pages').check();
  await expect(dialog.getByRole('status')).toHaveText('Scale 1 : 100');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(indicator(page)).toHaveText('1 : 100 · Metres');

  const { file, tail } = await save(page, id, bytes);
  expect(tail.match(/\/VP\s*\[/g)).toHaveLength(2);
  expect(tail).toMatch(/\/Subtype\s*\/RL/);
  expect(tail).toMatch(/\/R\s*\(1 m = 100 m\)/);

  await open(page, file);
  await expect(indicator(page)).toHaveText('1 : 100 · Metres');
});

test('Calibrate with typed points (keyboard path) and by picking two points on the page', async ({
  page,
}) => {
  await open(page);
  await measure(page).getByRole('button', { name: 'Calibrate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibrate' });
  // 100 mm apart on paper (283.46 pt), 10 m in reality: 1 : 100.
  await dialog.getByLabel('Point 1 x (pt)').fill('100');
  await dialog.getByLabel('Point 1 y (pt)').fill('100');
  await dialog.getByLabel('Point 2 x (pt)').fill('383.4646');
  await dialog.getByLabel('Point 2 y (pt)').fill('100');
  await expect(dialog).toContainText('Distance on the page: 100 mm');
  await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
  await dialog.getByLabel('Real length').fill('10');
  await expect(dialog.getByRole('status')).toHaveText('Scale 1 : 100');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(indicator(page)).toHaveText('1 : 100 · Metres');

  // Picking: the dialog closes, two clicks on the page, and it comes back with the points.
  await measure(page).getByRole('button', { name: 'Calibrate' }).click();
  await dialog.getByRole('button', { name: 'Pick two points on the page' }).click();
  await expect(dialog).toBeHidden();
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  await page.mouse.click(box.x + 100 * s, box.y + 100 * s);
  await page.mouse.click(box.x + 300 * s, box.y + 100 * s);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Point 2 x (pt)')).toHaveValue(/^(299|300)/);
  await dialog.getByLabel('Units').selectOption({ label: 'Feet and inches' });
  await dialog.getByLabel(/Real length/).fill(`23'-2"`);
  await expect(dialog.getByRole('status')).toHaveText(/Scale 1 : 1\d\d/);
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(indicator(page)).toHaveText(/1 : 1\d\d · Feet and inches/);
});

test('a /VP made by another viewer is read (1:50 in mm)', async ({ page }) => {
  // X converts points to millimetres at 1:50: 25.4 / 72 × 50.
  const c = ((25.4 / 72) * 50).toFixed(8);
  const vp = `/VP [<< /Type /Viewport /BBox [0 0 595 842] /Name (Plan) /Measure << /Type /Measure /Subtype /RL /R (1 mm = 50 mm) /X [<< /Type /NumberFormat /U (mm) /C ${c} /D 10 >>] /D [<< /U (mm) /C 1 >>] /A [<< /U (sq mm) /C 1 >>] >> >>]`;
  const bytes = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ${vp} >>`,
  ]);
  await open(page, bytes);
  await expect(indicator(page)).toHaveText('1 : 50 · Millimetres');
});
