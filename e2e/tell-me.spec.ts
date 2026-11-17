import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';
import { openSample, skipReviewerPrompt, startShots } from './support/shots.ts';

// M10-08·O2 (ADR-027): Tell me. Alt+Q (Ctrl+Q off macOS) or the top bar's lightbulb opens
// a small search box under the header. It finds any command by name, shows its tab and
// group and its shortcut, and runs it. The search runs on Enter or the Search button,
// never while typing (rule 3); Enter on the same query runs the chosen result. Nothing
// in the layout moves: the box floats over the page.

const box = (page: Page) => page.getByRole('combobox', { name: 'Tell me what you want to do' });
const panel = (page: Page) => page.getByTestId('tell-me');
const options = (page: Page) => panel(page).getByRole('option');

async function search(page: Page, query: string): Promise<void> {
  await box(page).fill(query);
  await box(page).press('Enter');
}

test('Alt+Q opens Tell me; it searches on Enter only, then Enter runs the chosen command @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
  const header = await page.locator('.ribbon-tabs').boundingBox();

  await page.keyboard.press('Alt+q');
  await expect(box(page)).toBeFocused();
  await expect(panel(page).getByRole('status')).toHaveText(/press Enter/);
  // Typing alone never searches (rule 3).
  await box(page).pressSequentially('dark the');
  await expect(options(page)).toHaveCount(0);
  await expect(panel(page).getByRole('status')).toHaveText('Press Enter to search.');
  await box(page).press('Enter');
  const first = options(page).first();
  await expect(first).toContainText('Dark Theme');
  await expect(first).toContainText('View › Window');
  await expect(first).toContainText('Ctrl+Shift+D');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(box(page)).toHaveAttribute(
    'aria-activedescendant',
    (await first.getAttribute('id')) ?? '',
  );
  await expect(panel(page).getByRole('status')).toHaveText(/^\d+ commands?\./);

  // Enter on the same query runs the chosen one; the box closes and focus goes back.
  await box(page).press('Enter');
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // The header did not move (the box floats).
  expect(await page.locator('.ribbon-tabs').boundingBox()).toEqual(header);

  // Ctrl+Q too (not on macOS, where Cmd+Q quits the browser).
  await page.keyboard.press('Control+q');
  await expect(box(page)).toBeFocused();
  // Each opening starts empty.
  await expect(box(page)).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
});

test('without a document, document commands are listed but disabled with the reason', async ({
  page,
}) => {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await page.keyboard.press('Alt+q');
  await search(page, 'highlight');
  const hl = panel(page)
    .getByRole('option', { name: /^Highlight\b/ })
    .first();
  await expect(hl).toHaveAttribute('aria-disabled', 'true');
  await expect(hl).toContainText('Comment › Text Markup');
  await expect(hl).toContainText('Open a document');
  // Enter does nothing on a disabled command; the box stays open.
  await box(page).press('Enter');
  await expect(panel(page)).toBeVisible();
  await hl.click({ force: true });
  await expect(panel(page)).toBeVisible();
  // No match: says so.
  await search(page, 'qwertyuiop');
  await expect(options(page)).toHaveCount(0);
  await expect(panel(page).getByRole('status')).toHaveText(/No commands match “qwertyuiop”/);
});

test('the arrow keys choose, a click runs, a dialog it opens gets focus and gives it back @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await openSample(page);
  const button = page.getByRole('button', { name: 'Tell Me' });
  await button.click();
  await expect(box(page)).toBeFocused();
  await search(page, 'rotate');
  const all = options(page);
  expect(await all.count()).toBeGreaterThanOrEqual(4);
  await box(page).press('ArrowDown');
  await expect(all.nth(1)).toHaveAttribute('aria-selected', 'true');
  await box(page).press('ArrowUp');
  await box(page).press('ArrowUp'); // wraps to the last
  await expect(all.last()).toHaveAttribute('aria-selected', 'true');

  // A command that opens a dialog: Print. Focus moves into it; closing returns to the button.
  await search(page, 'print');
  await panel(page)
    .getByRole('option', { name: /^Print\b/ })
    .first()
    .click();
  const print = page.getByRole('dialog', { name: 'Print' });
  await expect(print).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await expect(print.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(print).toBeHidden();
  await expect(button).toBeFocused();
});

test('File pages open the backstage at that page', async ({ page }) => {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await page.keyboard.press('Alt+q');
  await search(page, 'about');
  await expect(options(page).first()).toContainText('File');
  await box(page).press('Enter');
  const backstage = page.getByTestId('backstage');
  await expect(backstage).toBeVisible();
  await expect(backstage.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
  await expect(backstage.getByRole('button', { name: 'About' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('Tell me is listed with its keys, and passes axe in light and dark', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await startShots(page, theme, 1280);
    const button = page.getByRole('button', { name: 'Tell Me' });
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'Alt+Q');
    await button.click();
    await search(page, 'comment');
    await expect(options(page).first()).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="tell-me"]')
      .analyze();
    expect(
      violations.map((v) => v.id),
      theme,
    ).toEqual([]);
    // Fits the window at 1280 px, under the header.
    const b = await panel(page).boundingBox();
    const header = await page.locator('.ribbon-tabs').boundingBox();
    expect(b && header && b.y >= header.y + header.height).toBe(true);
    expect(b && b.x >= 0 && b.x + b.width <= 1280).toBe(true);
    await page.keyboard.press('Escape');
  }
});
