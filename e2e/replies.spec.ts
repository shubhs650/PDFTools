import type { Page } from '@playwright/test';
import { buildPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-12 (§7.1, M3-Q3): replies (/IRT) and review states (/StateModel /Review)
// as standard Text annotations; viewer-made ones are read; a comment with
// replies asks before deleting them. Since M6-05 the thread is the comment's
// card in the Comments pane: replies inside it, an inline reply editor.

/** A note by Ana with a reply by Cy and a Rejected state set by Bo in another viewer. */
function threadPdf(): Buffer {
  return Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R 5 0 R 6 0 R] >>',
      '<< /Type /Annot /Subtype /Text /NM (note) /T (Ana) /Contents (See detail 4) /CreationDate (D:20260303100000Z) /Rect [100 700 124 724] >>',
      '<< /Type /Annot /Subtype /Text /NM (reply-cy) /T (Cy) /Contents (Agreed) /IRT 4 0 R /CreationDate (D:20260304100000Z) /Rect [100 700 124 724] >>',
      '<< /Type /Annot /Subtype /Text /NM (state-bo) /T (Bo) /Contents (Rejected set by Bo) /IRT 4 0 R /State (Rejected) /StateModel (Review) /F 30 /CreationDate (D:20260305100000Z) /Rect [100 700 124 724] >>',
    ]),
  );
}

const pane = (page: Page) => page.getByTestId('comments-pane');
const rows = (page: Page) => page.getByTestId('comments-list').getByRole('option');
const card = (page: Page) => page.getByTestId('comments-list').locator('[data-comment="note"]');
const editor = (page: Page) => pane(page).getByTestId('comment-editor');
const list = (page: Page, id: string) =>
  cap(page, 'annotate', 'list', id) as Promise<{ id: string; contents: string | null }[] | null>;

async function open(page: Page, bytes: Buffer = threadPdf()): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana');
  await drop(page, [{ name: 'thread.pdf', b64: bytes.toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await list(page, id))?.length).toBe(3);
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  await card(page).click();
  await expect(card(page)).toHaveAttribute('aria-selected', 'true');
  return id;
}

async function saved(page: Page, id: string): Promise<{ file: Buffer; tail: string }> {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  const tail = Buffer.from(s.tail, 'base64');
  return { file: Buffer.concat([threadPdf(), tail]), tail: tail.toString('latin1') };
}

test('viewer-made reply and state are shown; reply and status are added and saved', async ({
  page,
}) => {
  const id = await open(page);
  await expect(rows(page)).toContainText([/See detail 4.*Rejected — Bo/, /Reply by.*Cy.*Agreed/]);

  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click();
  await editor(page).getByRole('textbox', { name: 'Reply' }).fill('Detail 4 is superseded');
  await editor(page).getByRole('button', { name: 'Post reply' }).click();
  await expect(rows(page)).toContainText([/See detail 4/, /Agreed/, /Detail 4 is superseded/]);
  await pane(page).getByRole('button', { name: 'Set Status' }).click();
  await page.getByRole('menuitem', { name: 'Accepted' }).click();
  await expect(card(page)).toContainText('Accepted — Ana');
  await expect(card(page)).toContainText('Rejected — Bo');

  const { file, tail } = await saved(page, id);
  expect(tail).toMatch(/\/Contents\s*\(Detail 4 is superseded\)/);
  expect(tail).toMatch(/\/IRT\s+4 0 R/);
  expect(tail).toMatch(/\/State\s*\(Accepted\)|\/State\s*\/Accepted/);
  expect(tail).toMatch(/\/StateModel\s*\(Review\)|\/StateModel\s*\/Review/);

  // Reopened: both come back from the file.
  await page.goto('/');
  await drop(page, [{ name: 'saved.pdf', b64: file.toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  await expect(rows(page)).toContainText([/Detail 4 is superseded/]);
  await expect(card(page)).toContainText('Accepted — Ana');
});

test('own replies can be edited and deleted, others’ cannot', async ({ page }) => {
  const id = await open(page);
  const reply = (text: string) => rows(page).filter({ hasText: text });
  await expect(reply('Agreed').locator('[data-action]')).toHaveCount(0);
  // F2 on someone else's reply edits nothing.
  await reply('Agreed').click();
  await page.getByTestId('comments-list').press('F2');
  await expect(editor(page)).toHaveCount(0);

  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click();
  await editor(page).getByRole('textbox', { name: 'Reply' }).fill('Typo here');
  await editor(page).getByRole('textbox', { name: 'Reply' }).press('Enter');
  await expect(reply('Typo here')).toHaveCount(1);
  await reply('Typo here').locator('[data-action="edit"]').click();
  const box = editor(page).getByRole('textbox', { name: 'Edit text' });
  await expect(box).toHaveValue('Typo here');
  await box.fill('Fixed text');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(reply('Fixed text')).toHaveCount(1);
  // Delete on your own reply (keyboard) deletes that reply only.
  await reply('Fixed text').click();
  await page.getByTestId('comments-list').press('Delete');
  await expect(reply('Fixed text')).toHaveCount(0);
  await expect.poll(async () => (await list(page, id))?.length).toBe(3);
  // And from its editor.
  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click();
  await editor(page).getByRole('textbox', { name: 'Reply' }).fill('Second try');
  await editor(page).getByRole('textbox', { name: 'Reply' }).press('Enter');
  await reply('Second try').dblclick();
  await editor(page).getByRole('button', { name: 'Delete reply' }).click();
  await expect(reply('Second try')).toHaveCount(0);
  await expect.poll(async () => (await list(page, id))?.length).toBe(3);
});

test('deleting a comment with replies asks first; undo brings the thread back', async ({
  page,
}) => {
  const id = await open(page);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete comments and their replies?' });
  await expect(dialog).toContainText('2 replies and statuses');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await list(page, id))?.length).toBe(0);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await list(page, id))?.length).toBe(3);
});

// Preview review USR01/OBS01: deleting is reachable from the Comments pane
// (Delete key and its toolbar's button) and the comment menu, not only from the
// page's Delete key (the ribbon's button moved to the menus in M6-08, B7a).

test('the pane’s Delete removes the selected comment; disabled without a selection', async ({
  page,
}) => {
  const id = await open(page);
  const del = pane(page).getByRole('button', { name: 'Delete Selected Comments' });
  await expect(del).not.toHaveAttribute('aria-disabled', 'true');
  await del.click();
  const dialog = page.getByRole('dialog', { name: 'Delete comments and their replies?' });
  await expect(dialog).toBeVisible();
  // A destructive confirmation starts on Cancel: Enter right away deletes nothing (UI02).
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expect((await list(page, id))?.length).toBe(3);
  await del.click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await list(page, id))?.length).toBe(0);
  await expect(del).toHaveAttribute('aria-disabled', 'true');
  await expect(del).toHaveAccessibleDescription(/Select a comment first/);
});

test('Delete in the Comments pane list and the pane’s Delete button', async ({ page }) => {
  const id = await open(page);
  // The card is selected (open() clicked it): Delete in the list deletes it.
  await page.getByTestId('comments-list').focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete comments and their replies?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await list(page, id))?.length).toBe(0);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await list(page, id))?.length).toBe(3);

  await card(page).click();
  await pane(page).getByRole('button', { name: 'Delete Selected Comments' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => (await list(page, id))?.length).toBe(0);
  await expect(card(page)).toHaveCount(0);
});
