import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { deflateSync } from 'node:zlib';
import { imagesPdf } from './fixtures/extraction.ts';
import { buildPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M11-08·O6 (ADR-028, plan O6): a right click on a picture of the page content
// adds Copy Image and Save Image As… at the top of the page menu. Copy puts a
// PNG of the image at its own resolution on the clipboard; Save writes it to
// the file the user picks. The image is found where it is now (after a page
// operation too) and at any view rotation. Elsewhere the page menu is as
// before. Rule 9: both are disabled where the document forbids copying.

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const menu = (page: Page) => page.getByRole('menu');
const copyItem = (page: Page) => menu(page).getByRole('menuitem', { name: 'Copy Image' });
const saveItem = (page: Page) => menu(page).getByRole('menuitem', { name: 'Save Image As…' });

async function open(page: Page, bytes = imagesPdf(), name = 'pics.pdf'): Promise<string> {
  await skipReviewerPrompt(page);
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** Screen point of a PDF user-space point (origin bottom-left) on a 612 × 792 page, scrolled into view. */
async function at(page: Page, pageIndex: number, x: number, y: number, turned = false) {
  const el = page.locator(`[data-page="${String(pageIndex)}"] .page-content`);
  const point = async () => {
    const box = await el.boundingBox();
    if (!box) throw new Error('page not laid out');
    const s = (turned ? box.height : box.width) / 612;
    // Turned 90° clockwise, the page's top edge is on the right.
    return turned
      ? { x: box.x + box.width - (792 - y) * s, y: box.y + x * s }
      : { x: box.x + x * s, y: box.y + (792 - y) * s };
  };
  const p = await point();
  if (p.y < 200 || p.y > 650) {
    const v = await page.getByTestId('document-view').boundingBox();
    if (!v) throw new Error('no view');
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.wheel(0, p.y - 400);
    await expect.poll(async () => Math.abs((await point()).y - 400) < 40).toBe(true);
  }
  return point();
}

async function rightClick(page: Page, pageIndex: number, x: number, y: number): Promise<void> {
  const p = await at(page, pageIndex, x, y);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
}

/** The PNG on the clipboard: its size and a pixel's RGBA. */
async function clipboardImage(context: BrowserContext, page: Page, px: [number, number]) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(async ([x, y]) => {
    const [item] = await navigator.clipboard.read();
    if (!item?.types.includes('image/png')) return null;
    const bmp = await createImageBitmap(await item.getType('image/png'), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(bmp, 0, 0);
    return { width: bmp.width, height: bmp.height, px: [...g.getImageData(x, y, 1, 1).data] };
  }, px);
}

test('Copy Image: the picture under the pointer goes to the clipboard as a PNG at its own size @smoke', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await open(page);
  // The 40 × 20 gradient image, drawn 160 × 80 points at (200, 600).
  await rightClick(page, 0, 280, 640);
  await expect(menu(page)).toHaveAccessibleName('Page');
  await expect(copyItem(page)).toBeVisible();
  // The image's items come first, then the page menu as before.
  const names = await menu(page).getByRole('menuitem').allTextContents();
  expect(names.slice(0, 3).map((n) => n.replace(/\s+/g, ' ').trim())).toEqual([
    'Copy Image',
    'Save Image As…',
    expect.stringMatching(/^Paste/),
  ]);
  await copyItem(page).click();
  await expect(menu(page)).toBeHidden();
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Image copied');
  await expect(page.getByRole('status').filter({ hasText: 'Image copied' })).toBeVisible();
  // The fixture's gradient: pixel (x, y) is (5x, 7y, 128).
  const img = await clipboardImage(context, page, [20, 10]);
  expect(img).toEqual({ width: 40, height: 20, px: [100, 70, 128, 255] });
});

test('the page background and a picture below the size limit keep the plain page menu', async ({
  page,
}) => {
  await page.goto('/');
  await open(page);
  await rightClick(page, 0, 500, 720);
  await expect(
    menu(page)
      .getByRole('menuitem', { name: /^Paste/ })
      .first(),
  ).toBeVisible();
  // The hit test has had its time: the items never came.
  await page.waitForTimeout(300);
  await expect(copyItem(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The 4 × 4 dot at (400, 600), drawn 8 points wide.
  await rightClick(page, 0, 404, 604);
  await page.waitForTimeout(300);
  await expect(copyItem(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('Save Image As…: the image is written as a PNG named after the document and page @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await open(page);
  await stubSavePicker(page);
  // The JPEG, drawn 96 points square at (50, 600).
  await rightClick(page, 0, 98, 648);
  await saveItem(page).click();
  await expect.poll(() => savedFiles(page)).toHaveLength(1);
  const [file] = await savedFiles(page);
  expect(file?.name).toBe('pics-page-1-image.png');
  expect(file?.bytes).toBeGreaterThan(100);
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Image saved');
});

test('a soft-masked picture keeps its transparency, at its own resolution', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await open(page);
  // Page 2: a 20 × 20 image with a soft mask, drawn 80 points square at (200, 600).
  await rightClick(page, 1, 240, 640);
  await copyItem(page).click();
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Image copied');
  // The mask's pixel 50 (x 10, y 2) is 150; the gradient there is (50, 14, 128).
  const img = await clipboardImage(context, page, [10, 2]);
  expect(img?.width).toBe(20);
  expect(img?.height).toBe(20);
  expect(img?.px[3]).toBe(150);
});

test('an image inside a form, with the view rotated, and after a page is deleted', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const id = await open(page);
  // Delete page 1: page 3's form image is now on the second page.
  expect(await cap(page, 'pages', 'run', id, { kind: 'delete', pages: [0] })).toBe(true);
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
  // The view turned a quarter: the page point under the pointer follows.
  await page.getByRole('tab', { name: 'View' }).click();
  await page
    .getByRole('toolbar', { name: 'View' })
    .getByRole('button', { name: 'Rotate View Clockwise' })
    .click();
  await expect
    .poll(async () => {
      const b = await page.locator('[data-page="1"] .page-content').boundingBox();
      return b ? b.width > b.height : false;
    })
    .toBe(true);
  // The form's 30 × 30 image: user space x 100–220, y 500–560; its middle (160, 530).
  const p = await at(page, 1, 160, 530, true);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await copyItem(page).click();
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Image copied');
  const img = await clipboardImage(context, page, [0, 0]);
  expect([img?.width, img?.height]).toEqual([30, 30]);
});

/** One 612 × 792 page with /Rotate 90 and a `px` × `px` gray image drawn 200 points square at (100, 400). */
function onePicturePdf(px: number, rotate = 0): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${String(rotate)} /Resources << /XObject << /I 5 0 R >> >> /Contents 4 0 R >>`,
    { dict: '<< >>', stream: 'q 200 0 0 200 100 400 cm /I Do Q' },
    {
      dict: `<< /Type /XObject /Subtype /Image /Width ${String(px)} /Height ${String(px)} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`,
      stream: deflateSync(Buffer.alloc(px * px, 90)).toString('latin1'),
    },
  ]);
}

test('a page turned by its own /Rotate: the picture is found where it is shown', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await open(page, onePicturePdf(32, 90), 'turned.pdf');
  // The image's middle (200, 500), on a page shown 90° clockwise.
  const p = await at(page, 0, 200, 500, true);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await copyItem(page).click();
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Image copied');
  const img = await clipboardImage(context, page, [3, 3]);
  expect(img).toEqual({ width: 32, height: 32, px: [90, 90, 90, 255] });
});

test('a large picture shows its progress after 300 ms, and Cancel stops the save (rule 2)', async ({
  page,
}) => {
  await page.goto('/');
  // 5000 × 5000 pixels: decoding it and making the PNG takes well over 300 ms.
  await open(page, onePicturePdf(5000), 'big.pdf');
  await stubSavePicker(page);
  await rightClick(page, 0, 200, 500);
  await saveItem(page).click();
  const dialog = page.getByRole('dialog', { name: 'Saving image' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('progressbar', { name: 'Image progress' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(500);
  expect(await savedFiles(page)).toEqual([]);
  await expect(page.getByTestId('snapshot-toast')).toHaveCount(0);
});

test('the page menu with the image items passes axe', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await rightClick(page, 0, 280, 640);
  await expect(copyItem(page)).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).include('.ui-context-menu').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
});

test('a document that forbids copying: the items are disabled and say why (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  const locked = qpdfEncrypt(imagesPdf(), USER_PW, OWNER_PW, ['256', '--extract=n']);
  await skipReviewerPrompt(page);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  await page
    .getByRole('dialog', { name: 'Password required' })
    .getByLabel('Password')
    .fill(USER_PW);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await rightClick(page, 0, 280, 640);
  for (const item of [copyItem(page), saveItem(page)]) {
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAccessibleDescription(
      "Not allowed by this document's security settings",
    );
  }
  await page.keyboard.press('Escape');
});
