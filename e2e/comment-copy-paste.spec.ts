import type { Page } from '@playwright/test';
import { reviewSourcePdf } from './fixtures/comments.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M4-21 (§7.1, ADR-018 decisions 5 and 8): comments copied from the Comments
// pane (multi-select by keyboard) or the page, pasted into another tab onto
// their own pages or onto the current page (10 pt right and down on the page
// they came from); new /NMs, the reply follows its copy; one undo step; saved
// and reopened; the in-app clipboard only.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

interface Obj {
  id: string;
  pageIndex: number;
  author?: string;
  inReplyToId?: string;
  contents?: string;
  rect: { origin: { x: number; y: number } };
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

test('three comments with a reply from tab A’s Comments pane into tab B, by keyboard; undo; saved and reopened', async ({
  page,
}) => {
  await page.goto('/');
  const a = await open(page, reviewSourcePdf(), 'rev-a.pdf');
  await expect.poll(async () => (await objects(page, a)).length).toBe(5);
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  const list = page.getByRole('listbox', { name: 'Comments' });
  await list.focus();
  // Every comment: Home, then Shift+ArrowDown to the end (page rows are skipped).
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'selected', a)) as string[]).sort())
    .toEqual(['src-note', 'src-oval', 'src-square']);
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByRole('status').filter({ hasText: '3 comments copied.' })).toBeVisible();

  const b = await open(page, simplePdf(3), 'rev-b.pdf');
  // Paste to Original Pages: the page menu (out of the ribbon since M6-08, B7a).
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+F10');
  const toOriginal = page
    .getByRole('menu', { name: 'Page' })
    .getByRole('menuitem', { name: 'Paste to Original Pages' });
  await expect(toOriginal).not.toHaveAttribute('aria-disabled', 'true');
  await toOriginal.click();
  await expect.poll(async () => (await objects(page, b)).length).toBe(5);
  const pasted = await objects(page, b);
  // New /NMs; each comment on the page it came from; the reply and the state follow the copy.
  expect(pasted.some((o) => o.id.startsWith('src-'))).toBe(false);
  expect(pasted.map((o) => o.pageIndex).sort()).toEqual([0, 0, 0, 1, 2]);
  const square = pasted.find((o) => o.contents === 'Check weld size');
  const reply = pasted.find((o) => o.contents === 'Upgraded to 6 mm');
  expect(reply?.inReplyToId).toBe(square?.id);
  await expect(page.getByRole('status').filter({ hasText: '3 comments pasted.' })).toBeVisible();

  // One undo step.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(async () => (await objects(page, b)).length).toBe(0);
  await page.getByRole('button', { name: 'Redo' }).first().click();
  await expect.poll(async () => (await objects(page, b)).length).toBe(5);

  const saved = (await cap(page, 'save', 'verifiedSave', b)) as { mode: string; tail: string };
  expect(saved.mode).toBe('narrow');
  const file = Buffer.concat([Buffer.from(simplePdf(3)), Buffer.from(saved.tail, 'base64')]);
  const [again] = (await cap(page, 'open', 'openHandles', [
    { name: 'saved.pdf', b64: file.toString('base64') },
  ])) as string[];
  if (!again) throw new Error('not reopened');
  await expect
    .poll(async () => (await objects(page, again)).map((o) => o.author ?? '').sort())
    .toEqual(['Ana', 'Ana', 'Ana', 'Bo', 'Bo']);
});

test('within one document: copied on the page, pasted 10 pt right and down; paste needs a copy', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, reviewSourcePdf(), 'rev-a.pdf');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  // Nothing copied yet: the page menu's pastes say so.
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+F10');
  const pageMenu = page.getByRole('menu', { name: 'Page' });
  for (const name of ['Paste', 'Paste to Original Pages'])
    await expect(pageMenu.getByRole('menuitem', { name, exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  await page.keyboard.press('Escape');

  await cap(page, 'annotate', 'select', id, 0, 'src-square');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByRole('status').filter({ hasText: '1 comment copied.' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await objects(page, id)).length).toBe(8);
  const all = await objects(page, id);
  const src = all.find((o) => o.id === 'src-square');
  const copy = all.find((o) => o.contents === 'Check weld size' && o.id !== 'src-square');
  expect(copy?.pageIndex).toBe(0);
  expect(copy?.rect.origin.x).toBeCloseTo((src?.rect.origin.x ?? 0) + 10, 1);
  expect(copy?.rect.origin.y).toBeCloseTo((src?.rect.origin.y ?? 0) + 10, 1);
  // The Comments pane numbers the copy too.
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  await expect(page.getByTestId('comments-list').getByRole('option')).toContainText([
    'Check weld size',
    'Check weld size',
  ]);
});
