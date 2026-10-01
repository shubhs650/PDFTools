import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, type PdfObject } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M4-11 (§7.8, M4-Q2, M4-Q8): Insert from File (password, full access, page
// order kept, one undo step), Extract Pages (a new unsaved tab; optionally
// deleted from the document) and Merge Files (order, ranges, one bookmark per
// file, a new unsaved tab).

/** `n` pages of distinct widths from `start` (start, start + 20, …). */
function sized(n: number, start: number): Uint8Array {
  const objs: PdfObject[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const font = 3 + n * 2;
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    kids.push(`${String(3 + i * 2)} 0 R`);
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(start + i * 20)} 600] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      { dict: '<< >>', stream: `BT /F1 24 Tf 40 500 Td (Sheet ${String(start + i * 20)}) Tj ET` },
    );
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(n)} >>`;
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objs);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const widths = async (page: Page, id: string) =>
  ((await cap(page, 'pages', 'info', id)) as { w: number }[]).map((p) => p.w);
const organize = (page: Page) => page.getByRole('toolbar', { name: 'Organize commands' });

async function open(page: Page, bytes: Uint8Array, name = 'sheets.pdf'): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** Each showOpenFilePicker call returns the next list of files. */
async function stubOpenPicker(page: Page, picks: { name: string; b64: string }[][]) {
  await page.evaluate((queue) => {
    const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
    w.showOpenFilePicker = () => {
      const files = queue.shift() ?? [];
      return Promise.resolve(
        files.map((f) => {
          const bin = atob(f.b64);
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          const file = new File([bytes], f.name, { type: 'application/pdf' });
          return { kind: 'file', name: f.name, getFile: () => Promise.resolve(file) };
        }),
      );
    };
  }, picks);
}

const activeId = async (page: Page) => (await cap(page, 'view', 'activeDocId')) as string;
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

test('Insert from File: chosen pages in the given order, after a page; undo', async ({ page }) => {
  const id = await open(page, sized(3, 400));
  await stubOpenPicker(page, [[{ name: 'extra.pdf', b64: b64(sized(2, 700)) }]]);
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Insert from File' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert from File' });
  await dialog.getByRole('button', { name: 'Choose PDF…' }).click();
  await expect(dialog.getByText('extra.pdf: 2 pages')).toBeVisible();
  await dialog.getByLabel('Pages of extra.pdf').fill('2, 1');
  await dialog.getByLabel('After page').check();
  await dialog.getByLabel('Page number').fill('1');
  expect((await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(() => widths(page, id)).toEqual([400, 720, 700, 420, 440]);
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(() => widths(page, id)).toEqual([400, 420, 440]);
});

test('Insert from File: a restricted file needs its owner password', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf makes the encrypted file');
  const id = await open(page, sized(2, 400));
  const locked = qpdfEncrypt(sized(2, 700), USER_PW, OWNER_PW, ['256', '--modify=none']);
  await stubOpenPicker(page, [[{ name: 'locked.pdf', b64: b64(locked) }]]);
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Insert from File' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert from File' });
  await dialog.getByRole('button', { name: 'Choose PDF…' }).click();
  const pw = dialog.getByLabel('Password for locked.pdf');
  await pw.fill(USER_PW);
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByRole('alert')).toContainText("don't allow its pages to be copied");
  await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled();
  await dialog.getByLabel('Password for locked.pdf').fill(OWNER_PW);
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByText('locked.pdf: 2 pages')).toBeVisible();
  await dialog.getByRole('button', { name: 'Insert' }).click();
  // Default position: after the current page (1).
  await expect.poll(() => widths(page, id)).toEqual([400, 700, 720, 420]);
});

test('Extract Pages: a new unsaved tab, and deleted from the document', async ({ page }) => {
  const id = await open(page, sized(4, 400));
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Extract Pages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Extract Pages' });
  await dialog.getByLabel('Pages:').check();
  await dialog.getByLabel('Page range').fill('2-3');
  await dialog.getByLabel('Also delete them from this document').check();
  await dialog.getByRole('button', { name: 'Extract' }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAccessibleName('sheets (pages 2-3).pdf, unsaved changes');
  const extracted = await activeId(page);
  await expect.poll(() => widths(page, extracted)).toEqual([420, 440]);
  await expect.poll(() => widths(page, id)).toEqual([400, 460]);
});

test('Merge Files: order, ranges, one bookmark per file, a new unsaved tab', async ({ page }) => {
  await open(page, sized(1, 300));
  await stubOpenPicker(page, [
    [
      { name: 'a.pdf', b64: b64(sized(2, 400)) },
      { name: 'b.pdf', b64: b64(sized(3, 700)) },
    ],
  ]);
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Merge Files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge Files' });
  await dialog.getByRole('button', { name: 'Add Files…' }).click();
  await expect(dialog.getByText('b.pdf: 3 pages')).toBeVisible();
  // b first (keyboard path), only its pages 3 and 1.
  await dialog.getByRole('button', { name: 'Move b.pdf up' }).click();
  await dialog.getByLabel('Pages of b.pdf').fill('3, 1');
  expect((await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Merge' }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAccessibleName('Merged (4 pages).pdf, unsaved changes');
  const merged = await activeId(page);
  await expect.poll(() => widths(page, merged)).toEqual([740, 700, 400, 420]);
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Bookmarks' })
    .click();
  const tree = page.getByRole('tree');
  await expect(tree.getByRole('treeitem')).toHaveText(['b', 'a']);
});
