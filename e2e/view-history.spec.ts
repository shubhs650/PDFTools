import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf, snapSheet } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M13-04 (D-70): Previous View / Next View in the status bar, one view history for the
// window (owner choice P2: tab switches and opened documents are steps), the labelled
// Enable Snapping toggle, the status bar's fold, and a measured distance's open arrows.

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const back = (page: Page) => bar(page).getByRole('button', { name: 'Previous View' });
const forward = (page: Page) => bar(page).getByRole('button', { name: 'Next View' });
const pageBox = (page: Page) => bar(page).getByRole('textbox', { name: 'Page number' });
const docTab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab', { name });

async function openTwo(page: Page): Promise<void> {
  await page.goto('/');
  await drop(page, [
    { name: 'long.pdf', b64: b64(simplePdf(12)) },
    { name: 'short.pdf', b64: b64(simplePdf(5)) },
  ]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await expect(docTab(page, 'short.pdf')).toHaveAttribute('aria-selected', 'true');
}

/**
 * Waits until the active tab's window has settled: a tab just selected lays its pages out
 * and lands its fit zoom over the next frames, and that first layout scrolls to the top.
 */
async function settled(page: Page): Promise<void> {
  const zoom = bar(page).getByRole('textbox', { name: 'Zoom' });
  let last = '';
  await expect
    .poll(async () => {
      const now = await zoom.inputValue();
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

async function goTo(page: Page, n: number): Promise<void> {
  await pageBox(page).fill(String(n));
  await pageBox(page).press('Enter');
  await expect(pageBox(page)).toHaveValue(String(n));
}

test('page box, then Previous View and Next View in the status bar', async ({ page }) => {
  await page.goto('/');
  await drop(page, [{ name: 'long.pdf', b64: b64(simplePdf(12)) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  // Nothing to go to yet: greyed, still reachable, the tooltip names the shortcut.
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeDisabled();
  await expect(back(page)).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');

  await goTo(page, 7);
  await expect(back(page)).toBeEnabled();
  await back(page).click();
  await expect(pageBox(page)).toHaveValue('1');
  await expect(forward(page)).toBeEnabled();
  await forward(page).click();
  await expect(pageBox(page)).toHaveValue('7');

  // Next Page is not a step; a thumbnail is.
  await bar(page).getByRole('button', { name: 'Next Page' }).click();
  await expect(pageBox(page)).toHaveValue('8');
  await page
    .getByRole('listbox', { name: 'Page thumbnails' })
    .getByRole('option', { name: '3', exact: true })
    .click();
  await expect(pageBox(page)).toHaveValue('3');
  await back(page).click();
  await expect(pageBox(page)).toHaveValue('8');
  await back(page).click();
  await expect(pageBox(page)).toHaveValue('1');

  // By keyboard: focus the arrows with Tab, Enter runs them; Alt+Right from the page.
  await forward(page).focus();
  await page.keyboard.press('Enter');
  await expect(pageBox(page)).toHaveValue('8');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pageBox(page)).toHaveValue('1');
});

test('one history for the window: tab switches and opened documents are steps', async ({
  page,
}) => {
  await openTwo(page);
  // Opening short.pdf left long.pdf: one step back.
  await expect(back(page)).toBeEnabled();
  await goTo(page, 4); // short.pdf: 1 → 4
  await docTab(page, 'long.pdf').click();
  await settled(page);
  await goTo(page, 9); // long.pdf: 1 → 9

  await back(page).click();
  await expect(docTab(page, 'long.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(pageBox(page)).toHaveValue('1');
  await back(page).click(); // back to the tab left, where it was left
  await expect(docTab(page, 'short.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(pageBox(page)).toHaveValue('4');
  await back(page).click();
  await expect(pageBox(page)).toHaveValue('1');
  await back(page).click(); // before short.pdf was opened
  await expect(docTab(page, 'long.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(back(page)).toBeDisabled();

  await page.keyboard.press('Alt+ArrowRight');
  await expect(docTab(page, 'short.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(pageBox(page)).toHaveValue('1');
  await forward(page).click();
  await expect(pageBox(page)).toHaveValue('4');
  await forward(page).click();
  await expect(docTab(page, 'long.pdf')).toHaveAttribute('aria-selected', 'true');
  await expect(pageBox(page)).toHaveValue('1');
  await forward(page).click();
  await expect(pageBox(page)).toHaveValue('9');
  await expect(forward(page)).toBeDisabled();

  // Closing a document takes its places away: only long.pdf's own steps are left.
  await page.getByRole('button', { name: 'Close short.pdf' }).click();
  for (let i = 0; i < 4 && (await back(page).getAttribute('aria-disabled')) !== 'true'; i++) {
    await back(page).click();
    await expect(pageBox(page)).toHaveValue('1');
    await expect(docTab(page, 'long.pdf')).toHaveAttribute('aria-selected', 'true');
  }
  await expect(back(page)).toBeDisabled();
});

test('Enable Snapping: icon and words, by mouse and keyboard', async ({ page }) => {
  await page.goto('/');
  await drop(page, [{ name: 'snap.pdf', b64: b64(snapSheet()) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const toggle = bar(page).getByRole('button', { name: 'Enable Snapping' });
  await expect(toggle).toHaveText('Enable Snapping');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(28);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // The Measure tab's button follows.
  await page.getByRole('tab', { name: 'Measure' }).click();
  await expect(
    page
      .getByRole('toolbar', { name: 'Measure commands' })
      .getByRole('button', { name: 'Enable Snapping' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

/**
 * The window never gets narrower than 1280 px (§8); a bar whose parts outgrow it (more
 * toggles, longer words) is played by giving the bar less room than the window.
 */
async function squeeze(page: Page, width: number | null): Promise<void> {
  await bar(page).evaluate((el, w) => {
    (el as HTMLElement).style.width = w === null ? '' : `${String(w)}px`;
  }, width);
}

test('the status bar fits at 1280 px; with less room, the view modes fold before the words', async ({
  page,
}) => {
  await openTwo(page);
  const toggle = bar(page).getByRole('button', { name: 'Enable Snapping' });
  const modes = bar(page).getByRole('group', { name: 'View mode' });
  const menu = bar(page).getByTestId('view-mode-menu');
  for (const width of [1920, 1366, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(bar(page)).toHaveAttribute('data-fold', '0');
    await expect(modes).toBeVisible();
    await expect(menu).toBeHidden();
    await expect(toggle.locator('.status-toggle-label')).toBeVisible();
  }
  // Nothing in the bar overlaps at 1280.
  const parts = await bar(page)
    .locator('.status-bar-slot')
    .evaluateAll((els) =>
      els.map((e) => {
        const kids = [...e.children].filter((k) => k.getBoundingClientRect().width > 0);
        const r = kids.map((k) => k.getBoundingClientRect());
        return r.length
          ? [Math.min(...r.map((x) => x.left)), Math.max(...r.map((x) => x.right))]
          : null;
      }),
    );
  const shown = parts.filter((p): p is number[] => p !== null);
  for (let i = 1; i < shown.length; i++)
    expect(shown[i]?.[0] ?? 0).toBeGreaterThanOrEqual(shown[i - 1]?.[1] ?? 0);

  // With Thin Lines (M13-05) beside Enable Snapping: folds at about 940 px, words at 860.
  await squeeze(page, 900);
  await expect(bar(page)).toHaveAttribute('data-fold', '1');
  await expect(modes).toBeHidden();
  await expect(toggle.locator('.status-toggle-label')).toBeVisible();
  // The folded view modes, as one menu.
  await menu.click();
  await page.getByRole('menuitemradio', { name: 'Single Page' }).click();
  await menu.click();
  await expect(page.getByRole('menuitemradio', { name: 'Single Page' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');

  await squeeze(page, 760);
  await expect(bar(page)).toHaveAttribute('data-fold', '2');
  // The words are hidden, the name stays.
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName('Enable Snapping');

  await squeeze(page, null);
  await expect(bar(page)).toHaveAttribute('data-fold', '0');
});

test('a measured distance has an open arrow at each end (owner, 2026-11-24)', async ({ page }) => {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'snap.pdf', b64: b64(snapSheet()) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  expect(await cap(page, 'annotate', 'toolDefaults', 'measureDistance')).toMatchObject({
    lineEndings: { start: 4, end: 4 },
  });
  // A perimeter keeps plain ends.
  expect(await cap(page, 'annotate', 'toolDefaults', 'measurePerimeter')).toMatchObject({
    lineEndings: { start: 6, end: 6 },
  });
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Distance', exact: true })
    .click();
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      ((await cap(page, 'annotate', 'objects', id)) as { type: number; lineEndings?: unknown }[])
        .filter((o) => o.type === 4)
        .map((o) => o.lineEndings),
    )
    .toEqual([{ start: 4, end: 4 }]);
});

for (const theme of ['light', 'dark'] as const)
  test(`the status bar passes axe, unfolded and folded (${theme}) @a11y`, async ({ page }) => {
    if (theme === 'dark') await darkTheme(page);
    await openTwo(page);
    await bar(page).getByRole('button', { name: 'Enable Snapping' }).click();
    const check = async () => {
      const { violations } = await new AxeBuilder({ page }).include('footer.status-bar').analyze();
      expect(violations).toEqual([]);
    };
    await check();
    await squeeze(page, 680);
    await expect(bar(page)).toHaveAttribute('data-fold', '2');
    await check();
  });
