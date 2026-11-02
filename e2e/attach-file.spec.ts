import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M6-10 (ADR-021 D-38 d, ADR-022 decision 1; beta review B7c; rules 6, 7, 9, 12):
// Comment → Note → Attach File, a click on the page picks the file; a
// standard /FileAttachment comment with a paperclip, written by the Render
// worker with direct PDFium calls. Listed in the Comments and Attachments
// panes, Save Attachment… from the comment menu, moved by its own Render
// call, one undo step, saved by Ctrl+S (narrow, verified) and reopened.
// Files over 25 MB are refused with a message; a restricted file disables it.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const FILE_ATTACHMENT = 17;
const CSV = 'a,b\n1,2\n';

interface Obj {
  id: string;
  type: number;
  pageIndex: number;
  contents?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const attachments = async (page: Page, id: string) =>
  (((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? []).filter(
    (o) => o.type === FILE_ATTACHMENT,
  );

const toolbar = (page: Page, tab: string) => page.getByRole('toolbar', { name: `${tab} commands` });
const rail = (page: Page) => page.getByRole('complementary', { name: 'Navigation panes' });

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** The next showOpenFilePicker calls return this file (made in the page: no big transfer). */
async function stubPicker(page: Page, name: string, text: string, size?: number) {
  await page.evaluate(
    ([n, t, s]) => {
      const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
      w.showOpenFilePicker = () => {
        const body = s === null ? new TextEncoder().encode(t) : new Uint8Array(s);
        const file = new File([body], n);
        return Promise.resolve([{ kind: 'file', name: n, getFile: () => Promise.resolve(file) }]);
      };
    },
    [name, text, size ?? null] as const,
  );
}

/** The on-screen position of a page point (top-left origin). */
async function screenPoint(page: Page, pageIndex: number, x: number, y: number) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error(`page ${String(pageIndex)} not laid out`);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

test('Attach File: click on the page, listed in both panes, Save Attachment…, moved, undo, saved and reopened @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const source = simplePdf(2);
  const id = await open(page, source, 'attach.pdf');
  await stubPicker(page, 'calc-sheet.csv', CSV);

  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  const tool = toolbar(page, 'Comment').getByRole('button', { name: 'Attach File', exact: true });
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  const at = await screenPoint(page, 0, 300, 200);
  await page.mouse.click(at.x, at.y);

  await expect.poll(async () => (await attachments(page, id)).length).toBe(1);
  const [made] = await attachments(page, id);
  expect(made).toMatchObject({ pageIndex: 0, contents: 'calc-sheet.csv' });
  // Centred on the click, a 20 pt paperclip.
  expect(made?.rect.origin.x).toBeCloseTo(290, 0);
  expect(made?.rect.origin.y).toBeCloseTo(190, 0);
  expect(made?.rect.size.width).toBeCloseTo(20, 0);
  // The tool stays on (like the note tool) and the new comment is selected.
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  expect(await cap(page, 'annotate', 'errors', 'attachFile')).toEqual([]);

  // The Comments pane lists it as a file attachment.
  await rail(page).getByRole('button', { name: 'Comments' }).click();
  await expect(page.getByTestId('comments-list')).toContainText('File attachment');
  await expect(page.getByTestId('comments-list')).toContainText('calc-sheet.csv');

  // The Attachments pane lists the unsaved file, with its size.
  await rail(page).getByRole('button', { name: 'Attachments' }).click();
  const list = page.getByRole('list', { name: 'Embedded files' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('calc-sheet.csv');
  await expect(list).toContainText('On page 1');

  // Save Attachment… from the comment menu writes the file.
  await stubSavePicker(page);
  if (!made) throw new Error('not made');
  await cap(page, 'annotate', 'select', id, 0, made.id);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu).toHaveAccessibleName('Comment');
  await menu.getByRole('menuitem', { name: 'Save Attachment…' }).click();
  await expect
    .poll(() => savedFiles(page))
    .toEqual([{ name: 'calc-sheet.csv', bytes: CSV.length }]);

  // Moved (its own Render call): Shift+Right nudges the selected comment 10 pt.
  await cap(page, 'annotate', 'select', id, 0, made.id);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => (await attachments(page, id))[0]?.rect.origin.x ?? 0)
    .toBeCloseTo(made.rect.origin.x + 10, 1);
  await expect
    .poll(async () => {
      const list = (await cap(page, 'annotate', 'list', id)) as { commit: string }[] | null;
      return list?.every((a) => a.commit === 'synced') ?? false;
    })
    .toBe(true);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);

  // Ctrl+S: one narrow, verified revision; the file reopens with the attachment.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const file = Buffer.concat([Buffer.from(source), Buffer.from(saved.tail, 'base64')]);
  const again = await open(page, new Uint8Array(file), 'saved.pdf');
  await expect.poll(async () => (await attachments(page, again)).length).toBe(1);
  const [back] = await attachments(page, again);
  expect(back?.contents).toBe('calc-sheet.csv');
  expect(back?.rect.origin.x ?? 0).toBeCloseTo(made.rect.origin.x + 10, 0);
  // The Attachments pane is still the one shown: it lists the reopened file's attachment.
  await expect(page.getByRole('list', { name: 'Embedded files' })).toContainText('calc-sheet.csv');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // Undo the moves, then the attach: it is gone; redo brings it back, file and all.
  await page.getByRole('tab', { name: 'attach.pdf' }).click();
  for (let i = 0; i < 10 && (await cap(page, 'annotate', 'canUndo', id)); i++)
    await cap(page, 'annotate', 'undo', id);
  await expect.poll(async () => (await attachments(page, id)).length).toBe(0);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ControlOrMeta+y');
  await expect.poll(async () => (await attachments(page, id)).length).toBe(1);
  await expect(page.getByRole('list', { name: 'Embedded files' })).toContainText('calc-sheet.csv');
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);
});

test('Attach File from the keyboard goes to the middle of the page; a file over 25 MB is refused', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1), 'attach.pdf');
  // No pointer at all: the command knows it came from the keyboard.
  await page.getByRole('tab', { name: 'Comment', exact: true }).focus();
  await page.keyboard.press('Enter');
  const tool = toolbar(page, 'Comment').getByRole('button', { name: 'Attach File', exact: true });

  // Too large: a message, nothing attached.
  await stubPicker(page, 'model.bin', '', 25_000_001);
  await tool.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('snapshot-toast')).toHaveText(
    'This file is too large to attach. Files up to 25 MB can be attached.',
  );
  expect(await attachments(page, id)).toEqual([]);

  // From the keyboard: picked right away, placed in the middle of the current page.
  await stubPicker(page, 'notes.txt', 'hello');
  await tool.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await attachments(page, id)).length).toBe(1);
  const [made] = await attachments(page, id);
  expect((made?.rect.origin.x ?? 0) + 10).toBeCloseTo(595 / 2, 0);
  expect((made?.rect.origin.y ?? 0) + 10).toBeCloseTo(842 / 2, 0);
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  expect(await cap(page, 'annotate', 'selected', id)).toEqual([made?.id]);
});

test('a document that forbids adding comments disables Attach File (rule 9)', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  const locked = qpdfEncrypt(simplePdf(1), USER_PW, OWNER_PW, ['256', '--annotate=n']);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  await page
    .getByRole('dialog', { name: 'Password required' })
    .getByLabel('Password')
    .fill(USER_PW);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await expect(
    toolbar(page, 'Comment').getByRole('button', { name: 'Attach File', exact: true }),
  ).toBeDisabled();
});
