import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { buildPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-11 (§5, §7.1, M3-Q5), redesigned in M6-05 (ADR-021 D-38 a, beta review
// B1 B2 B3b): the Comments pane lists every comment as a card, numbered,
// grouped under collapsible headers; the Options menu holds sort, group and
// the filters; Find runs on Enter; the list's selection is the page's, both
// ways; cards have the comment menu and an inline reply / text editor.

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
      '<< /Type /Annot /Subtype /Square /NM (sq-bo) /T (Bo) /Contents (Check clearance) /CreationDate (D:20260301100000Z) /Rect [300 500 400 540] /C [1 0 0] /F 132 /AP << /N 9 0 R >> >>',
      '<< /Type /Annot /Subtype /Text /NM (note-ana) /T (Ana) /Contents (See detail 4) /CreationDate (D:20260303100000Z) /Rect [100 700 124 724] >>',
      '<< /Type /Annot /Subtype /Text /NM (reply-cy) /T (Cy) /Contents (Agreed) /IRT 7 0 R /CreationDate (D:20260304100000Z) /Rect [100 700 124 724] >>',
      AP,
    ]),
  );
}

/** One page with `n` squares, each with a line of text. */
function manyPdf(n: number): Buffer {
  const annots = Array.from({ length: n }, (_, i) => `${String(5 + i)} 0 R`).join(' ');
  return Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [${annots}] >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ...Array.from(
        { length: n },
        (_, i) =>
          `<< /Type /Annot /Subtype /Square /NM (sq-${String(i)}) /T (Ana) /Contents (Item ${String(i + 1)}: check the weld size) /CreationDate (D:202603${String(10 + i).padStart(2, '0')}100000Z) /Rect [100 ${String(700 - i * 20)} 200 ${String(715 - i * 20)}] /C [1 0 0] >>`,
      ),
    ]),
  );
}

const pane = (page: Page) => page.getByTestId('comments-pane');
const list = (page: Page) => page.getByTestId('comments-list');
const rows = (page: Page) => list(page).getByRole('option');
const card = (page: Page, text: RegExp | string) =>
  list(page).locator('[data-comment]').filter({ hasText: text });
const status = (page: Page) => pane(page).getByRole('status');

async function open(page: Page, bytes: Buffer = reviewedPdf(), count = 4): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana');
  await drop(page, [{ name: 'reviewed.pdf', b64: bytes.toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length)
    .toBe(count);
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  return id;
}

/** Opens Options and clicks the path of (sub)menu items. */
async function choose(page: Page, ...path: string[]): Promise<void> {
  await pane(page).getByRole('button', { name: 'Options' }).click();
  const last = path.pop() ?? '';
  for (const name of path) await page.getByRole('menuitem', { name, exact: true }).last().click();
  await page
    .locator('[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]')
    .filter({ hasText: new RegExp(`^${last}$`) })
    .last()
    .click();
}

test('@smoke cards by page with numbers, the reply inside its card; one toolbar row; axe clean', async ({
  page,
}) => {
  await open(page);
  await expect(status(page)).toHaveText('3 of 3 comments');
  await expect(rows(page)).toHaveText([
    /^Page 1 · 2 comments$/,
    /1.*Rectangle.*Locked.*Bo.*Check clearance/,
    /2.*Rectangle.*Ana.*Move the pump\s+and the valve/,
    /^Page 2 · 1 comment$/,
    /3.*Note.*Ana.*See detail 4/,
    /Reply by.*Cy.*Agreed/,
  ]);
  // The old five stacked fields are gone; one toolbar and Find.
  await expect(pane(page).getByRole('combobox')).toHaveCount(0);
  const toolbar = pane(page).getByRole('toolbar', { name: 'Comment tools' });
  await expect(toolbar.getByRole('button')).toHaveCount(6);
  await expect(pane(page).getByRole('searchbox', { name: 'Find in comments' })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="comments-pane"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('at 1366 × 768 at least four cards are in view with the pane open', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await open(page, manyPdf(12), 12);
  await expect(status(page)).toHaveText('12 of 12 comments');
  const box = await list(page).boundingBox();
  const cards = await list(page).locator('[data-comment]').all();
  let inView = 0;
  for (const c of cards) {
    const b = await c.boundingBox();
    if (b && box && b.y >= box.y - 1 && b.y + b.height <= box.y + box.height + 1) inView++;
  }
  expect(inView).toBeGreaterThanOrEqual(4);
});

test('every old filter and sort is in Options; chips show and clear them', async ({ page }) => {
  await open(page);
  await choose(page, 'Show', 'Author', 'Ana');
  await page.keyboard.press('Escape');
  await expect(status(page)).toHaveText('2 of 3 comments');
  const chips = pane(page).getByRole('group', { name: 'Active filters' });
  await expect(chips.getByRole('button', { name: 'Remove filter Author: Ana' })).toBeVisible();
  await choose(page, 'Show', 'Type', 'Note');
  await page.keyboard.press('Escape');
  await expect(status(page)).toHaveText('1 of 3 comments');
  await chips.getByRole('button', { name: 'Remove filter Type: Note' }).click();
  await expect(status(page)).toHaveText('2 of 3 comments');
  await choose(page, 'Show', 'Status', 'No status');
  await page.keyboard.press('Escape');
  await expect(status(page)).toHaveText('2 of 3 comments');
  await chips.getByRole('button', { name: 'Clear all' }).click();
  await expect(status(page)).toHaveText('3 of 3 comments');
  await expect(chips).toHaveCount(0);

  await choose(page, 'Show', 'Current page only');
  await page.keyboard.press('Escape');
  await expect(status(page)).toHaveText('2 of 3 comments');
  await expect(
    chips.getByRole('button', { name: 'Remove filter Current page only' }),
  ).toBeVisible();
  await chips.getByRole('button', { name: 'Remove filter Current page only' }).click();

  await choose(page, 'Sort by', 'Author');
  await choose(page, 'Group by', 'None');
  await expect(list(page).locator('[data-comment]')).toHaveText([
    /Ana.*Move/,
    /Ana.*See detail/,
    /Bo.*Check/,
  ]);
  await choose(page, 'Group by', 'Author');
  await expect(list(page).locator('.comment-group')).toHaveText([
    'Ana · 2 comments',
    'Bo · 1 comment',
  ]);
});

test('Find filters on Enter only (rule 3); Esc clears it', async ({ page }) => {
  await open(page);
  const find = pane(page).getByRole('searchbox', { name: 'Find in comments' });
  await find.fill('pump');
  await expect(status(page)).toHaveText('3 of 3 comments'); // not as you type
  await find.press('Enter');
  await expect(status(page)).toHaveText('1 of 3 comments');
  await expect(pane(page).getByRole('button', { name: 'Remove filter “pump”' })).toBeVisible();
  // Replies count: "agreed" finds the note through Cy's reply.
  await find.fill('agreed');
  await pane(page).getByRole('button', { name: 'Find', exact: true }).click();
  await expect(list(page).locator('[data-comment]')).toHaveText([/See detail 4/]);
  await find.press('Escape');
  await expect(status(page)).toHaveText('3 of 3 comments');
  await expect(find).toHaveValue('');
});

test('@smoke selection both ways: card ↔ page, multi-select, footer count', async ({ page }) => {
  const id = await open(page);
  await card(page, 'Check clearance').click();
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['sq-bo']);
  await expect(card(page, 'Check clearance')).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, 'Check clearance')).toHaveClass(/is-selected/);
  await card(page, 'Move the pump').click({ modifiers: ['ControlOrMeta'] });
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'selected', id)) as string[]).sort())
    .toEqual(['sq-ana', 'sq-bo']);
  await expect(status(page)).toHaveText('3 of 3 comments · 2 selected');

  // Selected on the page (page 2): its card is selected and scrolled into view.
  await cap(page, 'annotate', 'select', id, 1, 'note-ana');
  await expect(list(page).locator('[aria-selected="true"]')).toHaveText([/See detail 4/]);
  await expect(card(page, 'See detail 4')).toBeInViewport();
  await expect(status(page)).toHaveText('3 of 3 comments · 1 selected');
});

test('keyboard: one tab stop, arrows, Enter selects, Enter on a header collapses; Previous / Next', async ({
  page,
}) => {
  const id = await open(page);
  await list(page).focus();
  await page.keyboard.press('ArrowDown'); // the first card (Bo)
  await page.keyboard.press('Enter');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['sq-bo']);
  await page.keyboard.press('Home'); // the "Page 1" header
  await page.keyboard.press('Enter');
  await expect(rows(page).first()).toHaveText(/Page 1 · 2 comments\s*collapsed/);
  await expect(list(page).locator('[data-comment]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(list(page).locator('[data-comment]')).toHaveCount(3);

  await choose(page, 'Collapse all');
  await expect(list(page).locator('.comment-group.is-collapsed')).toHaveCount(2);
  // Next opens the next comment's group.
  await pane(page).getByRole('button', { name: 'Next comment' }).click();
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['sq-ana']);
  await expect(card(page, 'Move the pump')).toBeVisible();
  await pane(page).getByRole('button', { name: 'Next comment' }).click();
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['note-ana']);
  await expect(pane(page).getByRole('button', { name: 'Next comment' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await pane(page).getByRole('button', { name: 'Previous comment' }).click();
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['sq-ana']);
  // Next / Previous opened both groups again.
  await expect(list(page).locator('.comment-group.is-collapsed')).toHaveCount(0);
  await choose(page, 'Collapse all');
  await expect(list(page).locator('[data-comment]')).toHaveCount(0);
  await choose(page, 'Expand all');
  await expect(list(page).locator('[data-comment]')).toHaveCount(3);
});

test('@smoke right-click on a card: the comment menu; Shift+F10 opens it from the list', async ({
  page,
}) => {
  const id = await open(page);
  await card(page, 'Check clearance').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Comment' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toContainText([
    'Cut',
    'Copy',
    'Paste',
    'Delete Selected Comments',
    'Reply',
    'Set Status',
    'Copy Style',
    'Apply Style',
    'Properties',
  ]);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['sq-bo']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(list(page)).toBeFocused();

  await page.keyboard.press('ArrowDown'); // Ana's square
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete Selected Comments' }).click();
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[]).length)
    .toBe(3);
  await expect(card(page, 'Move the pump')).toHaveCount(0);
  // A header has no menu.
  await rows(page).first().click({ button: 'right' });
  await expect(menu).toBeHidden();
});

test('inline reply: Reply on the card, Enter posts, Esc cancels; F2 edits the text', async ({
  page,
}) => {
  const id = await open(page);
  const objects = async () =>
    (await cap(page, 'annotate', 'objects', id)) as {
      id: string;
      contents?: string;
      inReplyToId?: string;
    }[];
  await card(page, 'Check clearance').click();
  await card(page, 'Check clearance').locator('[data-action="reply"]').click();
  const editor = pane(page).getByTestId('comment-editor');
  const box = editor.getByRole('textbox', { name: 'Reply' });
  await expect(box).toBeFocused();
  await box.fill('Needs 50 mm more');
  await box.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(rows(page)).toContainText([/Check clearance/, /Reply by.*Ana.*Needs 50 mm more/]);
  await expect
    .poll(async () => (await objects()).find((o) => o.contents === 'Needs 50 mm more')?.inReplyToId)
    .toBe('sq-bo');
  await expect(list(page)).toBeFocused();

  // The toolbar's Reply opens the same editor; Esc cancels and posts nothing.
  await pane(page).getByRole('button', { name: 'Reply' }).click();
  await expect(box).toBeFocused();
  await box.fill('Never mind');
  await box.press('Escape');
  await expect(editor).toHaveCount(0);
  expect((await objects()).some((o) => o.contents === 'Never mind')).toBe(false);

  // F2 edits the active card's text.
  await list(page).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown'); // Bo's square
  await page.keyboard.press('ArrowDown'); // its new reply
  await page.keyboard.press('ArrowDown'); // Ana's square
  await page.keyboard.press('F2');
  const text = editor.getByRole('textbox', { name: 'Edit text' });
  await expect(text).toHaveValue('Move the pump\nand the valve');
  await text.fill('Move the pump');
  await text.press('Enter');
  await expect
    .poll(async () => (await objects()).find((o) => o.id === 'sq-ana')?.contents)
    .toBe('Move the pump');
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
  // The same switch is in Options.
  await choose(page, 'Show Numbers on Page');
  await expect(badges).toHaveCount(0);
});
