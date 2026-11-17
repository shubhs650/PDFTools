import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-10 (ADR-028 D-56): the Properties pane is resizable like the left pane, and an
// arrow on each pane's inner edge hides or shows it through the same commands as the
// ribbon and the rail.

const leftArrow = (page: Page) => page.getByTestId('pane-edge-left').getByRole('button');
const rightArrow = (page: Page) => page.getByTestId('pane-edge-right').getByRole('button');
const pageBox = (page: Page) =>
  page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });
const viewTab = (page: Page) => page.getByRole('tab', { name: 'View' });
const ribbonPanes = (page: Page) => page.getByRole('button', { name: 'Panes', exact: true });
const ribbonProperties = (page: Page) =>
  page.getByRole('button', { name: 'Properties Pane', exact: true });

async function openStandIn(page: Page, pdfs: { contract(n: number): Buffer }) {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
}

test('the Properties pane resizes with the keys and the pointer, within 160–480 px @smoke', async ({
  page,
  pdfs,
}) => {
  await openStandIn(page, pdfs);
  await rightArrow(page).click();
  const pane = page.getByTestId('properties-pane');
  await expect(pane).toBeVisible();
  const splitter = page.getByRole('separator', { name: 'Resize the Properties pane' });
  await expect(splitter).toHaveAttribute('aria-valuenow', '260');
  await expect(splitter).toHaveAttribute('aria-valuemin', '160');
  await expect(splitter).toHaveAttribute('aria-valuemax', '480');

  // The splitter is on the pane's left edge: ArrowLeft moves it left and widens the pane.
  await splitter.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(splitter).toHaveAttribute('aria-valuenow', '276');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '244');
  await page.keyboard.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '480');
  expect(Math.round((await pane.boundingBox())?.width ?? 0)).toBe(480);
  await page.keyboard.press('ArrowLeft');
  await expect(splitter).toHaveAttribute('aria-valuenow', '480');
  await page.keyboard.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '160');
  expect(Math.round((await pane.boundingBox())?.width ?? 0)).toBe(160);

  // The pointer: dragging left widens it (away from the arrow in the middle).
  const box = await splitter.boundingBox();
  if (!box) throw new Error('no splitter');
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 90, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect(splitter).toHaveAttribute('aria-valuenow', '250');
  expect(Math.round((await pane.boundingBox())?.width ?? 0)).toBe(250);

  // The width is kept while the pane is hidden and shown again.
  await rightArrow(page).click();
  await expect(pane).toBeHidden();
  await rightArrow(page).click();
  await expect(splitter).toHaveAttribute('aria-valuenow', '250');

  // The left pane's splitter still works the other way round.
  const left = page.getByRole('separator', { name: 'Resize the navigation pane' });
  await left.focus();
  await page.keyboard.press('ArrowRight');
  await expect(left).toHaveAttribute('aria-valuenow', '276');
});

test('the left arrow hides and shows the pane, keeps focus and agrees with the rail and ribbon @smoke', async ({
  page,
  pdfs,
}) => {
  await openStandIn(page, pdfs);
  const arrow = leftArrow(page);
  const railToggle = page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: /navigation panes$/ });
  await expect(arrow).toHaveAccessibleName('Hide left pane');
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  await expect(arrow).toHaveAttribute('aria-controls', 'left-pane');
  await expect(page.locator('#left-pane')).toBeVisible();

  // Keyboard: Tab reaches it, Enter hides, focus stays on it.
  await arrow.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('left-pane')).toBeHidden();
  await expect(arrow).toBeFocused();
  await expect(arrow).toHaveAccessibleName('Show left pane');
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await expect(railToggle).toHaveAttribute('aria-pressed', 'false');
  await viewTab(page).click();
  await expect(ribbonPanes(page)).toHaveAttribute('aria-pressed', 'false');

  // Shown again from the arrow: the ribbon and rail follow.
  await arrow.click();
  await expect(page.getByTestId('left-pane')).toBeVisible();
  await expect(arrow).toBeFocused();
  await expect(ribbonPanes(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(railToggle).toHaveAttribute('aria-pressed', 'true');

  // The ribbon hides it: the arrow follows.
  await ribbonPanes(page).click();
  await expect(page.getByTestId('left-pane')).toBeHidden();
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');

  // The arrow reopens the last pane shown, not always Thumbnails.
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Bookmarks' })
    .click();
  await expect(page.locator('#left-pane-title')).toHaveText('Bookmarks');
  await arrow.click();
  await expect(page.getByTestId('left-pane')).toBeHidden();
  await arrow.click();
  await expect(page.locator('#left-pane-title')).toHaveText('Bookmarks');
});

test('the right arrow hides and shows the Properties pane and agrees with the ribbon @smoke', async ({
  page,
  pdfs,
}) => {
  await openStandIn(page, pdfs);
  const arrow = rightArrow(page);
  await expect(arrow).toHaveAccessibleName('Show Properties pane');
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await expect(arrow).not.toHaveAttribute('aria-controls', /./);
  await expect(page.getByTestId('properties-pane')).toBeHidden();

  await arrow.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('properties-pane')).toBeVisible();
  await expect(arrow).toBeFocused();
  await expect(arrow).toHaveAccessibleName('Hide Properties pane');
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  await expect(arrow).toHaveAttribute('aria-controls', 'properties-pane');
  await viewTab(page).click();
  await expect(ribbonProperties(page)).toHaveAttribute('aria-pressed', 'true');

  await ribbonProperties(page).click();
  await expect(page.getByTestId('properties-pane')).toBeHidden();
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await ribbonProperties(page).click();
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');

  // The pane's close button hands focus to the arrow that brings it back.
  await page.getByRole('button', { name: 'Close the Properties pane' }).click();
  await expect(page.getByTestId('properties-pane')).toBeHidden();
  await expect(arrow).toBeFocused();
  await expect(ribbonProperties(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the document stays on its page while the panes hide, show and change width', async ({
  page,
  pdfs,
}) => {
  await openStandIn(page, pdfs);
  await pageBox(page).fill('25');
  await pageBox(page).press('Enter');
  await expect(pageBox(page)).toHaveValue('25');
  await cap(page, 'view', 'settle');

  await leftArrow(page).click();
  await cap(page, 'view', 'settle');
  await expect(pageBox(page)).toHaveValue('25');
  await rightArrow(page).click();
  await cap(page, 'view', 'settle');
  await expect(pageBox(page)).toHaveValue('25');
  await page.getByRole('separator', { name: 'Resize the Properties pane' }).focus();
  await page.keyboard.press('End');
  await cap(page, 'view', 'settle');
  await expect(pageBox(page)).toHaveValue('25');
  await leftArrow(page).click();
  await page.getByRole('separator', { name: 'Resize the navigation pane' }).focus();
  await page.keyboard.press('End');
  await cap(page, 'view', 'settle');
  await expect(pageBox(page)).toHaveValue('25');
  await expect(page.locator('[data-page="24"]')).toBeInViewport();
});

test('1280 px with both panes open at their widest: nothing scrolls sideways, the arrows are visible @smoke', async ({
  page,
  pdfs,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openStandIn(page, pdfs);
  await rightArrow(page).click();
  await page.getByRole('separator', { name: 'Resize the Properties pane' }).focus();
  await page.keyboard.press('End');
  await page.getByRole('separator', { name: 'Resize the navigation pane' }).focus();
  await page.keyboard.press('End');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  for (const arrow of [leftArrow(page), rightArrow(page)]) {
    await expect(arrow).toBeInViewport();
    const box = await arrow.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(48);
  }
  // The arrows have their own column: neither covers the document area.
  const doc = await page.getByRole('main', { name: 'Document area' }).boundingBox();
  const l = await leftArrow(page).boundingBox();
  const r = await rightArrow(page).boundingBox();
  if (!doc || !l || !r) throw new Error('no boxes');
  expect(l.x + l.width).toBeLessThanOrEqual(doc.x);
  expect(r.x).toBeGreaterThanOrEqual(doc.x + doc.width);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds no violations with both panes open and both hidden (${theme}) @smoke`, async ({
    page,
    pdfs,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    await openStandIn(page, pdfs);
    await rightArrow(page).click();
    await expect(page.getByTestId('properties-pane')).toBeVisible();
    await expect(page.locator('.thumb-img').first()).toBeVisible();
    let { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);

    await leftArrow(page).click();
    await rightArrow(page).click();
    await expect(page.getByTestId('left-pane')).toBeHidden();
    await expect(page.getByTestId('properties-pane')).toBeHidden();
    ({ violations } = await new AxeBuilder({ page }).analyze());
    expect(violations.map((v) => v.id)).toEqual([]);
  });
}
