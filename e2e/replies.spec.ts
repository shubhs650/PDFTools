import type { Page } from '@playwright/test';
import { buildPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-12 (§7.1, M3-Q3): replies (/IRT) and review states (/StateModel /Review)
// as standard Text annotations; viewer-made ones are read; a comment with
// replies asks before deleting them.

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

const thread = (page: Page) => page.getByTestId('comment-thread');
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
  await page
    .getByTestId('comments-list')
    .getByRole('option', { name: /See detail 4/ })
    .click();
  await expect(thread(page)).toBeVisible();
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
  await expect(thread(page)).toContainText('Agreed');
  await expect(thread(page).getByRole('list', { name: 'Status by reviewer' })).toContainText(
    'Rejected — Bo',
  );

  await thread(page).getByLabel('Reply', { exact: true }).fill('Detail 4 is superseded');
  await thread(page).getByRole('button', { name: 'Post reply' }).click();
  await expect(thread(page).getByRole('list', { name: 'Replies' })).toContainText(
    'Detail 4 is superseded',
  );
  await thread(page).getByLabel('Set status').selectOption({ label: 'Accepted' });
  await expect(thread(page).getByRole('list', { name: 'Status by reviewer' })).toContainText(
    'Accepted — Ana',
  );
  await expect(page.getByTestId('comments-list')).toContainText('Accepted');

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
  await page
    .getByTestId('comments-list')
    .getByRole('option', { name: /See detail 4/ })
    .click();
  await expect(thread(page)).toContainText('Detail 4 is superseded');
  await expect(thread(page).getByRole('list', { name: 'Status by reviewer' })).toContainText(
    'Accepted — Ana',
  );
});

test('own replies can be edited and deleted, others’ cannot', async ({ page }) => {
  const id = await open(page);
  const replies = thread(page).getByRole('list', { name: 'Replies' });
  await expect(
    replies.getByRole('listitem').filter({ hasText: 'Agreed' }).getByRole('button'),
  ).toHaveCount(0);
  await thread(page).getByLabel('Reply', { exact: true }).fill('Typo here');
  await thread(page).getByRole('button', { name: 'Post reply' }).click();
  // Its text changes while editing, so address it by position (the newest reply).
  const mine = replies.getByRole('listitem').last();
  await expect(mine).toContainText('Typo here');
  await mine.getByRole('button', { name: 'Edit reply' }).click();
  await mine.getByLabel('Edit reply').fill('Fixed text');
  await mine.getByRole('button', { name: 'Save' }).click();
  await expect(replies).toContainText('Fixed text');
  await replies
    .getByRole('listitem')
    .filter({ hasText: 'Fixed text' })
    .getByRole('button', { name: 'Delete reply' })
    .click();
  await expect(replies).not.toContainText('Fixed text');
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
