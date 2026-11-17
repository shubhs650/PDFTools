import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { accentColour, cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';

// M11-03 (ADR-028 D-50): the file tabs' look (the selected tab filled with the accent),
// the hover card (page 1, full name, source, facts, status) and the + button.

const LONG = 'ASTM-C133_cold-crushing-strength_test-report_rev3.pdf';
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const card = (page: Page) => page.getByTestId('tab-card');
const addButton = (page: Page) =>
  page.locator('.tab-add').getByRole('button', { name: 'Open a file' });

async function openThree(page: Page, pdfs: { simple(n: number): Buffer }): Promise<void> {
  for (const [i, name] of [LONG, 'GA-drawing_pump-house.pdf', 'photos.pdf'].entries())
    await drop(page, [{ name, b64: pdfs.simple(i + 1).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(3);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

/** A token's colour as the browser computes it (rgb()), for comparing with a style. */
const tokenColour = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);

/**
 * Uses the `<input type=file>` path, which Playwright's file chooser drives. A listener
 * from the start turns on Playwright's chooser interception before any click: added
 * just before the click, it can lose the race and the chooser never reaches the test.
 */
async function withoutFsa(page: Page): Promise<void> {
  page.on('filechooser', () => undefined);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
  });
}

for (const [theme, accent] of [
  ['light', 'blue'],
  ['dark', 'indigo'],
] as const) {
  test(`the selected tab is filled with the accent, with its line (${theme}, ${accent}) @smoke`, async ({
    page,
    pdfs,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    if (accent !== 'blue') await accentColour(page, accent);
    await page.goto('/');
    await openThree(page, pdfs);
    const selected = tabs(page).nth(2);
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    const style = (i: number) =>
      tabs(page)
        .nth(i)
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            background: s.backgroundColor,
            color: s.color,
            weight: s.fontWeight,
            shadow: s.boxShadow,
          };
        });
    const brand = await tokenColour(page, '--color-brand');
    const onBrand = await tokenColour(page, '--color-text-on-brand');
    const line = await tokenColour(page, '--color-accent');
    // The CSS-order bug (M11 plan 3.1): the whole tab is filled, not only its ×.
    const s = await style(2);
    expect(s.background).toBe(brand);
    expect(s.color).toBe(onBrand);
    expect(Number(s.weight)).toBeGreaterThanOrEqual(600);
    expect(s.shadow).toContain(line);
    const close = page.locator('.tab-close.tab--active');
    expect(await close.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(brand);
    // The × is drawn in the name's colour (white on the fill), also while another tab
    // is hovered (owner, 2026-11-17: it was the dark icon colour on blue).
    const crossColour = () => close.locator('svg').evaluate((el) => getComputedStyle(el).color);
    expect(await crossColour()).toBe(onBrand);
    // Other tabs: no fill until hovered.
    expect((await style(0)).background).toBe('rgba(0, 0, 0, 0)');
    await tabs(page).nth(0).hover();
    expect((await style(0)).background).toBe(await tokenColour(page, '--color-surface-raised'));
    expect(await crossColour()).toBe(onBrand);
    // An unselected tab's × is its text colour.
    expect(
      await page.locator('.tab-close.tab--hover svg').evaluate((el) => getComputedStyle(el).color),
    ).toBe(await tokenColour(page, '--color-text'));
  });
}

test('the × shows on the selected tab always and on another tab when hovered', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openThree(page, pdfs);
  const closeOf = (name: string) => page.getByRole('button', { name: `Close ${name}` });
  const opacity = (name: string) => closeOf(name).evaluate((el) => getComputedStyle(el).opacity);
  await page.mouse.move(600, 600);
  await expect.poll(() => opacity('photos.pdf')).toBe('1');
  await expect.poll(() => opacity(LONG)).toBe('0');
  await tabs(page).nth(0).hover();
  await expect.poll(() => opacity(LONG)).toBe('1');
  // Still clickable as before: closing a tab that is not selected.
  await closeOf(LONG).click();
  await expect(tabs(page)).toHaveCount(2);
});

test('hovering a tab shows its card: page 1, the full name, the source and facts; Esc closes it @smoke', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openThree(page, pdfs);
  const first = tabs(page).nth(0);
  // The name on the tab is cut; the card has it whole.
  expect(await first.locator('.tab-name').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await first.hover();
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.tab-card-name')).toHaveText(LONG);
  await expect(card(page)).toContainText('Dropped onto Triya PDF');
  await expect(card(page)).toContainText(/1 page · \d+ bytes? · modified /);
  await expect(card(page).locator('img.tab-card-img')).toBeVisible();
  // Never over the tab (WCAG 1.4.13): below it.
  const tabBox = await first.boundingBox();
  const cardBox = await page.locator('.tab-card').boundingBox();
  expect(cardBox?.y ?? 0).toBeGreaterThanOrEqual((tabBox?.y ?? 0) + (tabBox?.height ?? 0));
  // Hoverable: the pointer can move onto the card and it stays.
  await page.locator('.tab-card').hover();
  await page.waitForTimeout(300);
  await expect(card(page)).toBeVisible();
  // Dismissable without moving the pointer.
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  // The same text for screen readers, on the tab itself.
  await expect(first).toHaveAccessibleDescription(/^Dropped onto Triya PDF\. 1 page · /);
});

test('keyboard focus on a tab shows its card after a pause; unsaved shows as a chip', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openThree(page, pdfs);
  await cap(page, 'open', 'markActiveDirty');
  await tabs(page).nth(2).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(tabs(page).nth(2)).toBeFocused();
  // Not at once: arrowing along the tabs stays quiet.
  await page.waitForTimeout(300);
  await expect(card(page)).toHaveCount(0);
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator('.tab-card-status')).toHaveText('Unsaved changes');
  await expect(tabs(page).nth(2)).toHaveAccessibleDescription(/Unsaved changes$/);
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(tabs(page).nth(2)).toBeFocused();
});

test('Save As changes the source to "Saved on this device"', async ({ page, pdfs }) => {
  await page.goto('/');
  await openThree(page, pdfs);
  await stubSavePicker(page);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Shift+s');
  await expect
    .poll(async () => ((await cap(page, 'open', 'facts')) as { source?: string }[])[2]?.source)
    .toBe('saved');
  await expect(tabs(page).nth(2)).toHaveAccessibleDescription(/^Saved on this device\./);
});

test('the + after the last tab opens a file @smoke', async ({ page, pdfs }) => {
  await withoutFsa(page);
  await page.goto('/');
  await drop(page, [{ name: 'one.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(1);
  // Right after the last tab's ×.
  const lastClose = await page.getByRole('button', { name: 'Close one.pdf' }).boundingBox();
  const add = await addButton(page).boundingBox();
  expect(add?.x ?? 0).toBeGreaterThan(lastClose?.x ?? 0);
  expect((add?.x ?? 0) - ((lastClose?.x ?? 0) + (lastClose?.width ?? 0))).toBeLessThan(24);

  await addButton(page).hover();
  await expect(page.getByRole('tooltip', { name: 'Open a file (Ctrl+O)' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await addButton(page).click();
  await (
    await chooser
  ).setFiles([{ name: 'two.pdf', mimeType: 'application/pdf', buffer: pdfs.simple(2) }]);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAccessibleDescription(/^Opened from this device\./);
});

test('a double-click on the empty part of the strip opens a file, as in Chrome', async ({
  page,
  pdfs,
}) => {
  await withoutFsa(page);
  await page.goto('/');
  await drop(page, [{ name: 'one.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(1);
  const strip = await page.locator('.tab-strip').boundingBox();
  if (!strip) throw new Error('no strip');
  const chooser = page.waitForEvent('filechooser');
  await page.mouse.dblclick(strip.x + strip.width - 120, strip.y + strip.height / 2);
  await (
    await chooser
  ).setFiles([{ name: 'two.pdf', mimeType: 'application/pdf', buffer: pdfs.simple(2) }]);
  await expect(tabs(page)).toHaveCount(2);
  // A double-click on a tab does not.
  let opened = false;
  page.once('filechooser', () => {
    opened = true;
  });
  await tabs(page).nth(0).dblclick();
  await page.waitForTimeout(300);
  expect(opened).toBe(false);
});

test('at 1280 px many tabs scroll, the + stays in view and nothing overflows the window', async ({
  page,
  pdfs,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  for (let i = 0; i < 8; i++)
    await drop(page, [
      {
        name: `Sheet ${String(i + 1)} - long drawing title.pdf`,
        b64: pdfs.simple(i + 1).toString('base64'),
      },
    ]);
  await expect(tabs(page)).toHaveCount(8);
  const list = page.locator('.tab-list');
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const add = await addButton(page).boundingBox();
  const end = await page.locator('.tab-strip-end').boundingBox();
  expect((add?.x ?? 0) + (add?.width ?? 0)).toBeLessThanOrEqual(end?.x ?? 0);
  await expect(addButton(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // The selected (last) tab is scrolled into view by its focus, not hidden under the +.
  await tabs(page).nth(7).focus();
  const sel = await tabs(page).nth(7).boundingBox();
  expect((sel?.x ?? 0) + (sel?.width ?? 0)).toBeLessThanOrEqual(add?.x ?? 0);
});

for (const [name, url, dark] of [
  ['light', '/', false],
  ['dark', '/', true],
  ['pseudo-locale', '/?locale=pseudo', false],
] as const) {
  test(
    `axe: the tab strip with a card open (${name})`,
    { tag: '@a11y' },
    async ({ page, pdfs }) => {
      if (dark) await darkTheme(page);
      await page.goto(url);
      for (const [i, n] of ['a.pdf', 'b.pdf'].entries())
        await drop(page, [{ name: n, b64: pdfs.simple(i + 1).toString('base64') }]);
      // By role only: the tablist's name is translated in the pseudo-locale.
      const anyTabs = page.locator('.tab-tablist [role="tab"]');
      await expect(anyTabs).toHaveCount(2);
      await cap(page, 'open', 'markActiveDirty');
      await anyTabs.nth(0).hover();
      await expect(card(page)).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
    },
  );
}
