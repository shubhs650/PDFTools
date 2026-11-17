import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { buildPdf, type PdfObject } from './fixtures/generate.ts';
import { cap, darkTheme, drop, type DropFile } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-08·O8 (D-55, §7.8): Images to PDF and Insert from Image. JPG and PNG
// files that are dropped or opened wait in the dialog's list; the Work worker
// builds one page per image (fit, A4 or Letter, turned to suit each image);
// a new document opens as an unsaved tab, and inserted pages are one undo step.

const DIR = join(import.meta.dirname, 'fixtures/self-made/images');
const image = (name: string, type?: string): DropFile => ({
  name,
  b64: readFileSync(join(DIR, name)).toString('base64'),
  type: type ?? (name.endsWith('.png') ? 'image/png' : 'image/jpeg'),
});
const PHOTO = 'site-photo-1.jpg';
const TURNED = 'site-photo-2-exif6.jpg';
const SCAN = 'scan-100dpi.png';
const LOGO = 'logo-alpha.png';

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const newDialog = (page: Page) => page.getByRole('dialog', { name: 'Images to PDF' });
const insertDialog = (page: Page) => page.getByRole('dialog', { name: 'Insert from Image' });
const organize = (page: Page) => page.getByRole('toolbar', { name: 'Organize commands' });
const activeId = async (page: Page) => (await cap(page, 'view', 'activeDocId')) as string;
const sizes = async (page: Page) =>
  ((await cap(page, 'pages', 'info', await activeId(page))) as { w: number; h: number }[]).map(
    (p) => `${String(Math.round(p.w))}x${String(Math.round(p.h))}`,
  );
const names = (page: Page) =>
  newDialog(page).or(insertDialog(page)).getByTestId('images-list').locator('.images-name');

/** Each showOpenFilePicker call returns the next list of files. */
async function stubOpenPicker(page: Page, picks: DropFile[][]) {
  await page.evaluate((queue) => {
    const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
    w.showOpenFilePicker = () => {
      const files = queue.shift() ?? [];
      return Promise.resolve(
        files.map((f) => {
          const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
          const file = new File([bytes], f.name, { type: f.type ?? 'application/pdf' });
          return { kind: 'file', name: f.name, getFile: () => Promise.resolve(file) };
        }),
      );
    };
  }, picks);
}

/** `n` pages of distinct widths from `start`. */
function sheets(n: number, start: number): Uint8Array {
  const objs: PdfObject[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    kids.push(`${String(3 + i)} 0 R`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(start + i * 20)} 600] >>`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(n)} >>`;
  return buildPdf(objs);
}

for (const theme of ['light', 'dark'] as const)
  test(`drop photos and a scan on the start screen: ordered, A4 turned per image (${theme}) @smoke`, async ({
    page,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    await page.goto('/');
    await drop(page, [image(PHOTO), image(TURNED), image(SCAN)]);

    const d = newDialog(page);
    await expect(d).toBeVisible();
    await expect(names(page)).toHaveText([PHOTO, TURNED, SCAN]);
    // The turned photo is listed as it shows (the camera's orientation applied).
    await expect(d.getByTestId('images-list').locator('.images-size')).toHaveText([
      '640 × 480 px',
      '640 × 480 px',
      '425 × 600 px',
    ]);
    await expect(d.getByTestId('images-count')).toHaveText('3 images');
    await expect(d.getByRole('radio', { name: 'Fit each page to its image' })).toBeChecked();
    await expect(d.getByRole('checkbox', { name: /10 mm margin/ })).toBeDisabled();
    await expect(d.getByTestId('images-summary')).toHaveText('3 pages, each the size of its image');
    await expect(d.getByRole('button', { name: 'Help for this dialog' })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations.map((v) => v.id),
    ).toEqual([]);

    // The scan first (keyboard path: Move up twice), then A4.
    await d.getByRole('button', { name: `Move ${SCAN} up` }).click();
    await d.getByRole('button', { name: `Move ${SCAN} up` }).click();
    await expect(names(page)).toHaveText([SCAN, PHOTO, TURNED]);
    await d.getByRole('radio', { name: 'A4, turned to suit each image' }).check();
    await expect(d.getByRole('checkbox', { name: /10 mm margin/ })).toBeChecked();
    await expect(d.getByTestId('images-summary')).toHaveText('3 A4 pages');
    await d.getByRole('button', { name: 'Create' }).click();

    await expect(d).toBeHidden();
    await expect(tabs(page)).toHaveCount(1);
    await expect(tabs(page).first()).toHaveAccessibleName('Images (3 pages).pdf, unsaved changes');
    await expect.poll(() => sizes(page)).toEqual(['595x842', '842x595', '842x595']);
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  });

test('one image, page fitted to it, named after it; a second drop adds to the open list', async ({
  page,
}) => {
  await page.goto('/');
  await drop(page, [image(LOGO)]);
  const d = newDialog(page);
  await expect(names(page)).toHaveText([LOGO]);
  // More files dropped while the dialog is open join the list.
  await drop(page, [image(PHOTO)]);
  await expect(names(page)).toHaveText([LOGO, PHOTO]);
  await d.getByRole('button', { name: `Remove ${PHOTO}` }).click();
  await expect(names(page)).toHaveText([LOGO]);
  await expect(d.getByTestId('images-summary')).toHaveText('1 page, the size of the image');
  await d.getByRole('button', { name: 'Create' }).click();
  await expect(tabs(page).first()).toHaveAccessibleName('logo-alpha.pdf, unsaved changes');
  // 200 × 120 px with no stated resolution: 96 dpi, so 150 × 90 pt.
  await expect.poll(() => sizes(page)).toEqual(['150x90']);
});

test('a dropped PDF opens, its pictures go to the list, and other pictures are named as left out', async ({
  page,
}) => {
  await page.goto('/');
  await drop(page, [
    { name: 'sheets.pdf', b64: Buffer.from(sheets(2, 400)).toString('base64') },
    image(PHOTO),
    {
      name: 'drawing.gif',
      b64: Buffer.from('GIF89a, not ours').toString('base64'),
      type: 'image/gif',
    },
    { name: 'broken.jpg', b64: Buffer.from('not a jpeg at all').toString('base64') },
  ]);
  const d = newDialog(page);
  await expect(names(page)).toHaveText([PHOTO]);
  await expect(d.getByRole('alert')).toContainText(
    "Left out because they aren't JPG or PNG images: drawing.gif and broken.jpg.",
  );
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(d.getByRole('alert')).toBeHidden();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  // The PDF opened as usual.
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAccessibleName('sheets.pdf');
});

test('File › Open offers images too; Organize › Images to PDF and File › New start an empty list', async ({
  page,
}) => {
  await page.goto('/');
  await stubOpenPicker(page, [[image(TURNED)], [image(PHOTO), image(SCAN)]]);
  await page.keyboard.press('Control+o');
  const d = newDialog(page);
  await expect(names(page)).toHaveText([TURNED]);
  // Add Images… picks more (JPG and PNG only).
  await d.getByRole('button', { name: 'Add Images…' }).click();
  await expect(names(page)).toHaveText([TURNED, PHOTO, SCAN]);
  await d.getByRole('radio', { name: 'Letter, turned to suit each image' }).check();
  await d.getByRole('checkbox', { name: /10 mm margin/ }).uncheck();
  await d.getByRole('button', { name: 'Create' }).click();
  await expect(tabs(page).first()).toHaveAccessibleName('Images (3 pages).pdf, unsaved changes');
  await expect.poll(() => sizes(page)).toEqual(['792x612', '792x612', '612x792']);

  // Organize › Images to PDF opens an empty list; Create waits for an image.
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Images to PDF' }).click();
  await expect(d.getByText('No images yet.', { exact: false })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Create' })).toBeDisabled();
  // The last choices are kept for this session.
  await expect(d.getByRole('radio', { name: 'Letter, turned to suit each image' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  // File › New shows Images to PDF beside Create Blank PDF.
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await expect(backstage.getByRole('button', { name: 'Images to PDF' })).toBeVisible();
  await backstage.getByRole('button', { name: 'Images to PDF' }).click();
  await expect(d).toBeVisible();
});

test('Organize › Insert from Image: before a page, in order, one undo step', async ({ page }) => {
  await page.goto('/');
  await drop(page, [{ name: 'sheets.pdf', b64: Buffer.from(sheets(3, 400)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = await activeId(page);
  await stubOpenPicker(page, [[image(PHOTO, 'image/jpeg'), image(LOGO)]]);
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Insert from Image' }).click();
  const d = insertDialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole('button', { name: 'Insert' })).toBeDisabled();
  await d.getByRole('button', { name: 'Add Images…' }).click();
  await expect(names(page)).toHaveText([PHOTO, LOGO]);
  await d.getByLabel('Before page').check();
  await d.getByLabel('Page number').fill('2');
  expect(
    (await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations.map((v) => v.id),
  ).toEqual([]);
  await d.getByRole('button', { name: 'Insert' }).click();
  await expect(d).toBeHidden();
  await expect
    .poll(() => sizes(page))
    .toEqual(['400x600', '640x480', '150x90', '420x600', '440x600']);
  expect(await activeId(page)).toBe(id);
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(() => sizes(page)).toEqual(['400x600', '420x600', '440x600']);
});
