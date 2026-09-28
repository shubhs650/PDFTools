import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { buildPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-11 (§5, §7.1, M3-Q5): the Comments pane lists every comment, numbered,
// filtered and sorted per document; a row selects its comment and the page's
// selection selects the row; numbers can be shown on the page.

const AP = {
  dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 100 40] >>',
  stream: '1 0 0 RG 2 w 1 1 98 38 re S',
};

/** Two pages: page 1 a square by Ana and a square by Bo (older), page 2 a note by Ana with a reply by Cy. */
function reviewedPdf(): Buffer {
  return Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [5 0 R 6 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [7 0 R 8 0 R] >>',
      '<< /Type /Annot /Subtype /Square /NM (sq-ana) /T (Ana) /Contents (Move the pump\\nand the valve) /CreationDate (D:20260302100000Z) /Rect [100 600 200 640] /C [1 0 0] /AP << /N 9 0 R >> >>',
      '<< /Type /Annot /Subtype /Square /NM (sq-bo) /T (Bo) /Contents (Check clearance) /CreationDate (D:20260301100000Z) /Rect [300 500 400 540] /C [1 0 0] /AP << /N 9 0 R >> >>',
      '<< /Type /Annot /Subtype /Text /NM (note-ana) /T (Ana) /Contents (See detail 4) /CreationDate (D:20260303100000Z) /Rect [100 700 124 724] >>',
      '<< /Type /Annot /Subtype /Text /NM (reply-cy) /T (Cy) /Contents (Agreed) /IRT 7 0 R /CreationDate (D:20260304100000Z) /Rect [100 700 124 724] >>',
      AP,
    ]),
  );
}

const pane = (page: Page) => page.getByTestId('comments-pane');
const rows = (page: Page) => page.getByTestId('comments-list').getByRole('option');

async function open(page: Page): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name: 'reviewed.pdf', b64: reviewedPdf().toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length)
    .toBe(4);
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  return id;
}

test('lists comments by page with numbers (M3-Q5), replies counted, not listed', async ({
  page,
}) => {
  await open(page);
  await expect(pane(page).getByRole('status')).toHaveText('3 of 3 comments');
  await expect(rows(page)).toHaveText([
    /Page 1 · 2 comments/,
    /^1.*Rectangle · Bo.*Check clearance/,
    /^2.*Rectangle · Ana.*Move the pump/,
    /Page 2 · 1 comment/,
    /^3.*Ana.*1 reply.*See detail 4/,
  ]);
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="comments-pane"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('filters combine and are kept per document; sort by author', async ({ page }) => {
  await open(page);
  await pane(page).getByLabel('Author').selectOption('Ana');
  await expect(pane(page).getByRole('status')).toHaveText('2 of 3 comments');
  await pane(page).getByLabel('Type').selectOption({ label: 'Note' });
  await expect(pane(page).getByRole('status')).toHaveText('1 of 3 comments');
  await pane(page).getByLabel('Type').selectOption({ label: 'All' });
  await pane(page).getByLabel('Author').selectOption({ label: 'All' });
  await pane(page).getByLabel('Sort by').selectOption({ label: 'Author' });
  await expect(rows(page)).toHaveText([/Ana.*Move/, /Ana.*See detail/, /Bo.*Check/]);
});

test('Enter selects the comment on its page; the page selection selects the row', async ({
  page,
}) => {
  const id = await open(page);
  const list = pane(page).getByRole('listbox', { name: 'Comments' });
  await list.focus();
  await page.keyboard.press('ArrowDown'); // comment 1 (Bo)
  await page.keyboard.press('Enter');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['sq-bo']);
  await cap(page, 'annotate', 'select', id, 1, 'note-ana');
  await expect(list.locator('[aria-selected="true"]')).toContainText('See detail 4');
});

test('numbers on the page follow the pane’s numbers (comment.autoNumber)', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Comment' }).click();
  const toggle = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Show Numbers on Page' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const badges = page.locator('[data-page="0"] .comment-number-badge');
  await expect(badges).toHaveCount(2);
  expect((await badges.allInnerTexts()).sort()).toEqual(['1', '2']);
});
