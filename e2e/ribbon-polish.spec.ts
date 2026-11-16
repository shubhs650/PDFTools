import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { openSample, skipReviewerPrompt } from './support/shots.ts';

// M10-04 (ADR-027 D-47; review R4, R7, R17, R18): the ribbon and top bar polish.
// File is a pill; the active tab is semibold brand text over a short bar that slides
// between tabs without shifting the row; the panel is a framed card with inset group
// dividers; a pressed toggle is a borderless brand tint with brand text and icon; top
// bar and Quick Access buttons are 28 px; the open pane's rail button has an accent pill.

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** A token's value as the browser resolves it on an element (rgb(...)). */
const resolved = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

const look = (el: Locator) =>
  el.evaluate((b) => {
    const s = getComputedStyle(b);
    const icon = b.querySelector('svg');
    return {
      bg: s.backgroundColor,
      color: s.color,
      border: s.borderTopColor,
      icon: icon ? getComputedStyle(icon).color : null,
      weight: s.fontWeight,
    };
  });

const indicatorCentre = (page: Page) =>
  page.locator('.ribbon-tab-indicator').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  });

/** How far the bar's centre is from a tab's, in CSS px (the bar sits on whole pixels). */
const offCentre = async (page: Page, tab: Locator) =>
  Math.abs((await indicatorCentre(page)) - (await centreOf(tab)));

const centreOf = async (el: Locator) => {
  const b = await el.boundingBox();
  if (!b) throw new Error('not laid out');
  return b.x + b.width / 2;
};

for (const theme of ['light', 'dark'] as const)
  test(`pressed toggles, the active tab and the rail pill use the brand tint (${theme}) @smoke`, async ({
    page,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    await page.goto('/');
    await skipReviewerPrompt(page);
    await openSample(page, 2);
    const selected = await resolved(page, '--color-selected');
    const selectedText = await resolved(page, '--color-selected-text');

    // A pressed comment tool: tint, no border, brand text and icon; its arrow joins the tint.
    await page.getByRole('tab', { name: 'Comment', exact: true }).click();
    const bar = page.getByRole('toolbar', { name: 'Comment commands' });
    const rect = bar.getByRole('button', { name: 'Rectangle', exact: true });
    await rect.click();
    await expect(rect).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(600, 600);
    await expect.poll(async () => (await look(rect)).bg).toBe(selected);
    const pressed = await look(rect);
    expect(pressed.icon).toBe(selectedText);
    expect(pressed.border).toBe('rgba(0, 0, 0, 0)');
    const arrow = page.locator('[data-split="comment.rectangle"] .ribbon-split-arrow');
    await expect.poll(async () => (await look(arrow)).bg).toBe(selected);

    // The active tab: semibold brand text.
    const tab = page.getByRole('tab', { name: 'Comment', exact: true });
    await expect.poll(async () => (await look(tab)).color).toBe(selectedText);
    expect(Number((await look(tab)).weight)).toBeGreaterThanOrEqual(600);

    // The open pane's rail button: tint and an accent pill at the rail's edge.
    const rail = page.locator('[data-rail="rail.thumbnails"]');
    await expect(rail.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await look(rail.getByRole('button'))).bg).toBe(selected);
    const pill = await rail.evaluate((el) => {
      const s = getComputedStyle(el, '::before');
      return { content: s.content, height: s.height, width: s.borderLeftWidth };
    });
    expect(pill).toEqual({ content: '""', height: '16px', width: '3px' });

    const { violations } = await new AxeBuilder({ page })
      .include('[role="region"][aria-label="Ribbon"]')
      .include('.left-rail-icons')
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });

test('the tab bar slides under the active tab and the row never shifts @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Ribbon tabs' });
  const home = page.getByRole('tab', { name: 'Home', exact: true });
  const measure = page.getByRole('tab', { name: 'Measure', exact: true });
  await expect.poll(() => offCentre(page, home)).toBeLessThanOrEqual(1);
  const before = await tabs.boundingBox();
  const homeWidth = (await home.boundingBox())?.width;

  await measure.click();
  await expect.poll(() => offCentre(page, measure)).toBeLessThanOrEqual(1);
  // The bar slides (a transform transition) instead of jumping.
  const slide = await page
    .locator('.ribbon-tab-indicator')
    .evaluate((el) => [getComputedStyle(el).transitionProperty, el.hasAttribute('data-ready')]);
  expect(slide).toEqual(['transform', true]);
  // A semibold active label never changes a tab's width or the row's.
  expect((await home.boundingBox())?.width).toBe(homeWidth);
  expect(await tabs.boundingBox()).toEqual(before);

  // The keyboard moves it too, and every tab keeps its plain name.
  await measure.focus();
  await page.keyboard.press('ArrowRight');
  const organize = page.getByRole('tab', { name: 'Organize', exact: true });
  await expect(organize).toBeFocused();
  await expect(organize).toHaveAccessibleName('Organize');
  await expect.poll(() => offCentre(page, organize)).toBeLessThanOrEqual(1);
});

test('reduced motion: the tab bar moves at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  const duration = await page
    .locator('.ribbon-tab-indicator')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe('0s');
});

test('top bar and Quick Access buttons are 28 px; File is a pill; the panel is a card @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const sizes = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.quick-access button, .top-bar-actions > *, .ribbon-tabs-end > .ui-button',
      ),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      return `${String(Math.round(r.width))}x${String(Math.round(r.height))}`;
    }),
  );
  expect(sizes.length).toBeGreaterThanOrEqual(10);
  expect(new Set(sizes)).toEqual(new Set(['28x28']));

  const file = await page.getByTestId('file-tab').evaluate((el) => {
    const s = getComputedStyle(el);
    return { radius: parseFloat(s.borderTopLeftRadius), height: el.getBoundingClientRect().height };
  });
  expect(file.radius).toBeGreaterThanOrEqual(file.height / 2);

  const card = await page.locator('.ribbon-panel').evaluate((el) => {
    const s = getComputedStyle(el);
    return { radius: s.borderTopLeftRadius, shadow: s.boxShadow !== 'none', bg: s.backgroundColor };
  });
  expect(card.radius).toBe(await token(page, '--radius-l'));
  expect(card.shadow).toBe(true);
  expect(card.bg).toBe(await resolved(page, '--color-surface'));
  // Inset dividers: between groups, shorter than the group, none after the last.
  const dividers = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.ribbon-toolbar > .ribbon-group')].map((g) => {
      const s = getComputedStyle(g, '::after');
      return s.content === 'none' ? null : parseFloat(s.top);
    }),
  );
  expect(dividers.at(-1)).toBeNull();
  expect(dividers.slice(0, -1).every((t) => t !== null && t > 0)).toBe(true);
});

test('forced-colors: the active tab, pressed toggles and the rail pill stay visible', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  await skipReviewerPrompt(page);
  await openSample(page, 1);
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  const rect = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Rectangle', exact: true });
  await rect.click();
  await page.mouse.move(600, 600);
  const tab = await look(page.getByRole('tab', { name: 'Comment', exact: true }));
  const row = await page
    .locator('.ribbon-tabs')
    .evaluate((el) => getComputedStyle(el.closest('.app-banner') ?? el).backgroundColor);
  expect(tab.color).not.toBe(row);
  const pressed = await rect.evaluate((el) => {
    const s = getComputedStyle(el);
    return { adjust: s.forcedColorAdjust, bg: s.backgroundColor, color: s.color };
  });
  expect(pressed.adjust).toBe('none');
  expect(pressed.color).not.toBe(pressed.bg);
  const pill = await page
    .locator('[data-rail="rail.thumbnails"]')
    .evaluate((el) => getComputedStyle(el, '::before').borderLeftStyle);
  expect(pill).toBe('solid');
});
