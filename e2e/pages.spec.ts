import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, type PdfObject } from './fixtures/generate.ts';
import { makeSigner, signedPdf } from './fixtures/signed.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M4-09 (§7.8, ADR-016): Organize → Rotate, Delete Pages and Insert Blank Page
// on the thumbnail selection; undo and redo in the same timeline as markups;
// Ctrl+S one narrow, verified revision; annotations and comments follow;
// disabled without the assemble permission (rule 9).

/** `n` pages of distinct widths (400, 420, …): the order is visible in the page sizes. */
function sizedPdf(n = 6): Uint8Array {
  const objs: PdfObject[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const font = 3 + n * 2;
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    kids.push(`${String(3 + i * 2)} 0 R`);
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(400 + i * 20)} 600] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      { dict: '<< >>', stream: `BT /F1 24 Tf 40 500 Td (Sheet ${String(i + 1)}) Tj ET` },
    );
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(n)} >>`;
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objs);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const widths = async (page: Page, id: string) =>
  ((await cap(page, 'pages', 'info', id)) as { w: number; rot: number }[]).map((p) => p.w);
const info = (page: Page, id: string) =>
  cap(page, 'pages', 'info', id) as Promise<{ w: number; h: number; rot: number }[]>;

async function open(page: Page, bytes: Uint8Array, name = 'sheets.pdf'): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

const organize = (page: Page) => page.getByRole('toolbar', { name: 'Organize commands' });
const list = (page: Page) => page.getByRole('listbox', { name: 'Page thumbnails' });
const thumb = (page: Page, label: string) =>
  list(page).getByRole('option', { name: label, exact: true });

async function undo(page: Page) {
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
}

test('rotate, delete and insert from the Organize tab, undo and redo, save verified @smoke', async ({
  page,
}) => {
  const original = sizedPdf(6);
  const id = await open(page, original);
  await page.getByRole('tab', { name: 'Organize' }).click();

  // Rotate the current page (page 1).
  await organize(page).getByRole('button', { name: 'Rotate Clockwise' }).click();
  await expect.poll(async () => (await info(page, id))[0]?.rot).toBe(1);

  // Select pages 2 and 4 in the thumbnails, delete them.
  await thumb(page, '2').click();
  await thumb(page, '4').click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([1, 3]);
  await organize(page).getByRole('button', { name: 'Delete Pages' }).click();
  const del = page.getByRole('dialog', { name: 'Delete Pages' });
  await expect(del.getByLabel('Selected pages (2)')).toBeChecked();
  await del.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => widths(page, id)).toEqual([400, 440, 480, 500]);
  await expect(list(page).getByRole('option')).toHaveCount(4);

  // Insert two A4 pages before page 1.
  await organize(page).getByRole('button', { name: 'Insert Blank Page' }).click();
  const ins = page.getByRole('dialog', { name: 'Insert Blank Page' });
  await ins.getByLabel('Before page').check();
  await ins.getByLabel('Page number').fill('1');
  await ins.getByLabel('Number of pages').fill('2');
  await ins.getByLabel('A4 (210 × 297 mm)').check();
  await ins.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(() => widths(page, id)).toEqual([595, 595, 400, 440, 480, 500]);

  // Undo the insert, then the delete; redo the delete.
  await undo(page);
  await expect.poll(() => widths(page, id)).toEqual([400, 440, 480, 500]);
  await undo(page);
  await expect.poll(() => widths(page, id)).toEqual([400, 420, 440, 460, 480, 500]);
  await page.getByRole('button', { name: 'Redo' }).first().click();
  await expect.poll(() => widths(page, id)).toEqual([400, 440, 480, 500]);
  expect((await info(page, id))[0]?.rot).toBe(1);

  // A markup after the page operations, then Ctrl+S (the verified flow).
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved.mode).toBe('narrow');
  expect(saved.fellBack).toBe(false);
  const file = Buffer.concat([Buffer.from(original), Buffer.from(saved.tail, 'base64')]);
  expect(
    file
      .subarray(original.length)
      .toString('latin1')
      .match(/startxref/g),
  ).toHaveLength(1);
  if (hasQpdf()) {
    const f = join(mkdtempSync(join(tmpdir(), 'pages-e2e-')), 'saved.pdf');
    writeFileSync(f, file);
    expect(spawnSync('qpdf', ['--check', f]).status).toBe(0);
  }

  // Reopened in a new tab: the same pages in the same order, rotation kept.
  const [again] = (await cap(page, 'open', 'openHandles', [
    { name: 'saved.pdf', b64: file.toString('base64') },
  ])) as string[];
  if (!again) throw new Error('not reopened');
  await expect
    .poll(async () => (await info(page, again)).map((p) => [p.w, p.rot]))
    .toEqual([
      [400, 1],
      [440, 0],
      [480, 0],
      [500, 0],
    ]);
});

test('annotations and comments follow their page through a delete and its undo', async ({
  page,
}) => {
  const id = await open(page, sizedPdf(4));
  await cap(page, 'annotate', 'setProfile', 'Pages Reviewer');
  const sq = (await cap(page, 'annotate', 'createSquare', id, 2, 50, 50)) as string;
  await expect
    .poll(async () =>
      ((await cap(page, 'annotate', 'list', id)) as { id: string; page: number }[]).map((a) => [
        a.id,
        a.page,
      ]),
    )
    .toEqual([[sq, 2]]);
  await page.getByRole('tab', { name: 'Organize' }).click();
  // Delete page 1 (the current page): the markup moves from page 3 to page 2.
  await organize(page).getByRole('button', { name: 'Delete Pages' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Pages' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect
    .poll(async () =>
      ((await cap(page, 'annotate', 'list', id)) as { id: string; page: number }[]).map((a) => [
        a.id,
        a.page,
      ]),
    )
    .toEqual([[sq, 1]]);
  // The Comments pane numbers it on its new page.
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  await expect(page.getByRole('region', { name: 'Comments' }).getByText('Page 2')).toBeVisible();
  await undo(page);
  await expect
    .poll(async () =>
      ((await cap(page, 'annotate', 'list', id)) as { id: string; page: number }[]).map((a) => [
        a.id,
        a.page,
      ]),
    )
    .toEqual([[sq, 2]]);
  // Undo again removes the markup made before the page operation.
  await undo(page);
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[]).length)
    .toBe(0);
});

test('the thumbnail context menu and keyboard selection', async ({ page }) => {
  const id = await open(page, sizedPdf(5));
  await thumb(page, '1').click();
  await thumb(page, '1').press('Shift+ArrowDown');
  await thumb(page, '2').press('Shift+ArrowDown');
  await expect.poll(() => cap(page, 'pages', 'selection', id)).toEqual([0, 1, 2]);
  await thumb(page, '3').press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Page actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Rotate Counterclockwise' }).click();
  await expect.poll(async () => (await info(page, id)).map((p) => p.rot)).toEqual([3, 3, 3, 0, 0]);
});

test('without the assemble permission the page commands are disabled', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the restricted fixture');
  const bytes = qpdfEncrypt(sizedPdf(3), USER_PW, OWNER_PW, ['256', '--modify=none']);
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(bytes) }]);
  const pw = page.getByRole('dialog', { name: 'Password required' });
  await pw.getByLabel('Password').fill(USER_PW);
  await pw.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page.getByRole('tab', { name: 'Organize' }).click();
  for (const name of [
    'Rotate Clockwise',
    'Rotate Counterclockwise',
    'Delete Pages',
    'Insert Blank Page',
  ])
    await expect(organize(page).getByRole('button', { name })).toBeDisabled();
});

test('Quick Find after a delete: the hit is on the page as it is now', async ({ page }) => {
  await open(page, sizedPdf(5));
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Delete Pages' }).click();
  const del = page.getByRole('dialog', { name: 'Delete Pages' });
  await del.getByLabel('Pages:').check();
  await del.getByLabel('Page range').fill('1-2');
  await del.getByRole('button', { name: 'Delete' }).click();
  await expect(list(page).getByRole('option')).toHaveCount(3);
  await page.keyboard.press('Control+f');
  const field = page.getByRole('region', { name: 'Find in document' }).getByRole('searchbox', {
    name: 'Find',
  });
  await field.fill('Sheet 4');
  await field.press('Enter');
  // "Sheet 4" was page 4; after deleting pages 1–2 it is page 2 (index 1).
  await expect(page.locator('[data-page="1"] .find-hit--current')).toBeVisible();
});

test('a long operation shows progress; Cancel leaves the document as it was', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  const all = Array.from({ length: 2000 }, (_, i) => i);
  const run = cap(page, 'pages', 'run', id, { kind: 'rotate', pages: all, quarter: 1 });
  const progress = page.getByRole('dialog', { name: 'Changing pages' });
  await expect(progress).toBeVisible();
  await progress.getByRole('button', { name: 'Cancel' }).click();
  expect(await run).toBe(false);
  await expect(progress).toBeHidden();
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
  const rot = ((await info(page, id)) as { rot: number }[]).map((p) => p.rot);
  expect(rot.every((r) => r === 0)).toBe(true);
  expect(await cap(page, 'pages', 'error')).toBeNull();
});

test('a signed document asks first; recovery restores a page operation', async ({ page }) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
  const signed = await signedPdf(await makeSigner('Organize Signer'));
  const id = await open(page, signed, 'signed.pdf');
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Insert Blank Page' }).click();
  await page
    .getByRole('dialog', { name: 'Insert Blank Page' })
    .getByRole('button', { name: 'Insert' })
    .click();
  const ask = page.getByRole('dialog', { name: 'Change the pages of a signed document?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Change pages' }).click();
  await expect.poll(async () => (await info(page, id)).length).toBe(2);

  // The snapshot (~5 s after the edit) holds the new page; reload stands in for a crash.
  await expect
    .poll(async () => ((await cap(page, 'storage', 'list')) as unknown[]).length, {
      timeout: 15_000,
    })
    .toBe(1);
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved changes?' });
  await dialog.getByRole('button', { name: 'Recover signed.pdf' }).click();
  await expect(dialog).toBeHidden();
  const rid = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await info(page, rid)).length).toBe(2);
});

test('the Organize dialogs have no accessibility violations', async ({ page }) => {
  await open(page, sizedPdf(3));
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Insert Blank Page' }).click();
  const ins = page.getByRole('dialog', { name: 'Insert Blank Page' });
  await expect(ins).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations).toEqual([]);
  await ins.getByRole('button', { name: 'Cancel' }).click();
  await organize(page).getByRole('button', { name: 'Delete Pages' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Pages' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations).toEqual([]);
});

test('undo after a save: the next save writes the pages back', async ({ page }) => {
  const original = sizedPdf(4);
  const id = await open(page, original);
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Delete Pages' }).click();
  await page
    .getByRole('dialog', { name: 'Delete Pages' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect.poll(() => widths(page, id)).toEqual([420, 440, 460]);
  const first = (await cap(page, 'save', 'verifiedSave', id)) as { tail: string };
  const saved = Buffer.concat([Buffer.from(original), Buffer.from(first.tail, 'base64')]);
  await undo(page);
  await expect.poll(() => widths(page, id)).toEqual([400, 420, 440, 460]);
  const second = (await cap(page, 'save', 'verifiedSave', id)) as {
    tail: string;
    fellBack: boolean;
  };
  expect(second.fellBack).toBe(false);
  const file = Buffer.concat([saved, Buffer.from(second.tail, 'base64')]);
  const [again] = (await cap(page, 'open', 'openHandles', [
    { name: 'again.pdf', b64: file.toString('base64') },
  ])) as string[];
  if (!again) throw new Error('not reopened');
  await expect.poll(() => widths(page, again)).toEqual([400, 420, 440, 460]);
});

test('reorder: drag a thumbnail, Alt+arrows with an announcement, the Move Pages dialog', async ({
  page,
}) => {
  const original = sizedPdf(5);
  const id = await open(page, original);
  // Drag page 5 above page 1: the list scrolls up while the pointer is held near its top edge.
  await thumb(page, '5').scrollIntoViewIfNeeded();
  const from = await thumb(page, '5').boundingBox();
  const box = await list(page).boundingBox();
  if (!from || !box) throw new Error('no thumbnails');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, box.y + 8, { steps: 10 });
  await expect.poll(() => list(page).evaluate((el) => el.scrollTop)).toBe(0);
  await page.mouse.move(from.x + from.width / 2, box.y + 6);
  await expect(page.locator('.thumb-drop-marker')).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => widths(page, id)).toEqual([480, 400, 420, 440, 460]);
  await undo(page);
  await expect.poll(() => widths(page, id)).toEqual([400, 420, 440, 460, 480]);

  // Alt+↓ twice on page 1; the new position is announced.
  await thumb(page, '1').click();
  await thumb(page, '1').press('Alt+ArrowDown');
  await expect.poll(() => widths(page, id)).toEqual([420, 400, 440, 460, 480]);
  await expect(page.getByRole('status').filter({ hasText: 'Page moved to page 2.' })).toHaveCount(
    1,
  );
  await thumb(page, '2').press('Alt+ArrowDown');
  await expect.poll(() => widths(page, id)).toEqual([420, 440, 400, 460, 480]);

  // Move Pages dialog: pages 1–2 after page 5.
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Move Pages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move Pages' });
  await dialog.getByLabel('Pages:').check();
  await dialog.getByLabel('Page range').fill('1-2');
  await dialog.getByLabel('After page').check();
  await dialog.getByLabel('Page number').fill('5');
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect.poll(() => widths(page, id)).toEqual([400, 460, 480, 420, 440]);

  // Saved and reopened: the same order.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    tail: string;
    fellBack: boolean;
  };
  expect(saved.fellBack).toBe(false);
  const file = Buffer.concat([Buffer.from(original), Buffer.from(saved.tail, 'base64')]);
  const [again] = (await cap(page, 'open', 'openHandles', [
    { name: 'moved.pdf', b64: file.toString('base64') },
  ])) as string[];
  if (!again) throw new Error('not reopened');
  await expect.poll(() => widths(page, again)).toEqual([400, 460, 480, 420, 440]);
});
