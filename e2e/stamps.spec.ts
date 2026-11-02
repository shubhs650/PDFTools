import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-14 (§7.3, ADR-015 d1, M3-Q4): dynamic stamps from the active status
// scheme, drawn in a worker into a PNG that PDFium writes as the appearance;
// image stamps from PNG, JPG or a PDF page (whose permissions are honoured).

interface Listed {
  id: string;
  type: number;
  author: string | null;
  contents: string | null;
}
const STAMP = 13;

const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];
const ribbon = (page: Page) => page.getByRole('toolbar', { name: 'Comment commands' });

async function open(page: Page, bytes: Uint8Array = simplePdf(1)): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Comment' }).click();
  return id;
}

async function clickPage(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  await page.mouse.click(box.x + x * s, box.y + y * s);
}

async function savedTail(page: Page, id: string): Promise<string> {
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(saved.mode).toBe('narrow');
  return Buffer.from(saved.tail, 'base64').toString('latin1');
}

test('dynamic stamp: code, reviewer, date, document number; saved with /Subj, /Contents and an appearance @smoke', async ({
  page,
}) => {
  const id = await open(page);
  await ribbon(page).getByRole('button', { name: 'Stamp', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stamp' });
  await dialog.getByLabel('Revise & Resubmit').check();
  await dialog.getByLabel('Document number').fill('P-1001');
  await dialog.getByLabel('Revision').fill('C');
  await dialog.getByRole('button', { name: 'Place stamp' }).click();
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'dynamicStamp');
  await clickPage(page, 300, 150);
  await expect.poll(async () => (await list(page, id)).map((a) => a.type)).toEqual([STAMP]);
  const [stamp] = await list(page, id);
  expect(stamp?.author).toBe('Ana de Vries');
  expect(stamp?.contents).toMatch(/^RR Revise & Resubmit\nAna de Vries · .+\nP-1001 · Rev\. C$/);

  const tail = await savedTail(page, id);
  expect(tail).toMatch(/\/Subtype\s*\/Stamp/);
  expect(tail).toMatch(/\/Subj\s*\(RR Revise & Resubmit\)/);
  expect(tail).toMatch(/\/AP\s*<<\s*\/N/);
  expect(tail).toMatch(/\/Subtype\s*\/Image/); // the PNG, as an image XObject
  expect(tail).toMatch(/\/T\s*\(Ana de Vries\)/);
});

test('keyboard: Stamp → Enter in the dialog → Enter on the page places it at the centre (M3-Q6)', async ({
  page,
}) => {
  const id = await open(page);
  await ribbon(page).getByRole('button', { name: 'Stamp', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stamp' });
  await dialog.getByLabel('Document number').fill('K-7');
  await dialog.getByLabel('Document number').press('Enter');
  await expect(dialog).toBeHidden();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await list(page, id)).map((a) => a.contents?.split('\n')[0]))
    .toEqual(['AP Approved']);
  // The document number was asked once and is kept for this document.
  await ribbon(page).getByRole('button', { name: 'Stamp', exact: true }).click(); // tool off
  await ribbon(page).getByRole('button', { name: 'Stamp', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Stamp' }).getByLabel('Document number'),
  ).toHaveValue('K-7');
});

test('image stamps: PNG, JPG and a PDF page; a PDF that forbids copying is refused', async ({
  page,
}) => {
  const id = await open(page, simplePdf(1));
  const png = await page.locator('[data-page="0"] .page-content').screenshot({ type: 'png' });
  const jpg = await page.locator('[data-page="0"] .page-content').screenshot({ type: 'jpeg' });
  const files = [
    { name: 'logo.png', mimeType: 'image/png', buffer: png },
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpg },
    { name: 'detail.pdf', mimeType: 'application/pdf', buffer: Buffer.from(simplePdf(1)) },
  ];
  for (const [i, f] of files.entries()) {
    await ribbon(page).getByRole('button', { name: 'Image Stamp' }).click();
    const dialog = page.getByRole('dialog', { name: 'Image stamp' });
    await dialog.getByLabel('Choose an image or PDF').setInputFiles(f);
    await expect(dialog).toBeHidden();
    await clickPage(page, 150 + i * 150, 200);
    await expect.poll(async () => (await list(page, id)).length).toBe(i + 1);
    await ribbon(page).getByRole('button', { name: 'Image Stamp' }).click(); // tool off
  }
  expect((await list(page, id)).map((a) => a.contents)).toEqual([
    'logo.png',
    'photo.jpg',
    'detail.pdf',
  ]);
  const tail = await savedTail(page, id);
  expect(tail.match(/\/Subtype\s*\/Stamp/g)).toHaveLength(3);
  expect(tail).toMatch(/\/Filter\s*\/DCTDecode/); // the JPG kept as JPEG

  if (!hasQpdf()) return;
  await ribbon(page).getByRole('button', { name: 'Image Stamp' }).click();
  const dialog = page.getByRole('dialog', { name: 'Image stamp' });
  await dialog.getByLabel('Choose an image or PDF').setInputFiles({
    name: 'nocopy.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(qpdfEncrypt(simplePdf(1), '', 'owner', ['256', '--extract=n'])),
  });
  await expect(dialog.getByRole('alert')).toHaveText("That PDF doesn't allow copying its content.");
});
