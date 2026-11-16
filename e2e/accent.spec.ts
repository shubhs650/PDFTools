import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { ACCENT_KEY, accentColour, cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M10 O7 (ADR-027 D-47): File → Settings → Appearance → Accent colour: Blue (default),
// Teal, Indigo, Graphite, drawn as swatches. Stored on this device next to the theme,
// applied before the first paint, listed on the Privacy page, reset by Clear all local
// data. Comment colours, highlight and sticky-note yellow and white pages never follow
// it; forced-colors keeps the system colours whatever the accent.

const html = (page: Page) => page.locator('html');
const backstage = (page: Page) => page.getByTestId('backstage');
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), ACCENT_KEY);
const fileTabBg = (page: Page) =>
  page.getByTestId('file-tab').evaluate((el) => getComputedStyle(el).backgroundColor);
const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

const BLUE = 'rgb(37, 99, 235)';
const TEAL = 'rgb(15, 118, 110)';
const INDIGO = 'rgb(79, 70, 229)';
const GRAPHITE = 'rgb(71, 85, 105)';

async function appearance(page: Page) {
  if (!(await backstage(page).isVisible())) await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  const section = backstage(page).getByTestId('appearance-section');
  await expect(section).toBeVisible();
  return section
    .getByRole('radiogroup', { name: 'Accent colour' })
    .or(section.getByRole('group', { name: 'Accent colour' }));
}

test('Settings → Appearance: pick an accent, it applies at once and survives a reload @smoke', async ({
  page,
}) => {
  await page.goto('/');
  expect(await fileTabBg(page)).toBe(BLUE);
  const group = await appearance(page);
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(4);
  await expect(group.getByRole('radio', { name: 'Blue' })).toBeChecked();
  expect(await stored(page)).toBeNull();

  await group.getByRole('radio', { name: 'Teal' }).check();
  await expect(html(page)).toHaveAttribute('data-accent', 'teal');
  expect(await stored(page)).toBe('teal');
  expect(await fileTabBg(page)).toBe(TEAL);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f766e');

  // Keyboard: the arrows move between the swatches and pick, as radio buttons do.
  await group.getByRole('radio', { name: 'Teal' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Indigo' })).toBeFocused();
  await expect(group.getByRole('radio', { name: 'Indigo' })).toBeChecked();
  expect(await fileTabBg(page)).toBe(INDIGO);
  // The focused swatch shows the focus ring; the current one the ring.
  const swatch = group.locator(
    '.appearance-accent-input:focus-visible + .appearance-accent-swatch',
  );
  await expect(swatch).toHaveCount(1);
  expect(await swatch.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');

  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Graphite' })).toBeChecked();
  expect(await fileTabBg(page)).toBe(GRAPHITE);

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // Before the first paint after a reload (the boot script), then the module agrees.
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-accent', 'graphite');
  expect(await fileTabBg(page)).toBe(GRAPHITE);
  await expect((await appearance(page)).getByRole('radio', { name: 'Graphite' })).toBeChecked();

  // Blue again: back to the default, nothing stored.
  await (await appearance(page)).getByRole('radio', { name: 'Blue' }).check();
  await expect(html(page)).not.toHaveAttribute('data-accent', /.*/);
  expect(await stored(page)).toBeNull();
  expect(await fileTabBg(page)).toBe(BLUE);
});

test('a stored accent is there from the first paint, in dark too', async ({ page }) => {
  await accentColour(page, 'indigo');
  await darkTheme(page);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __firstAccent: string | null }).__firstAccent =
        document.documentElement.getAttribute('data-accent');
    });
  });
  await page.goto('/');
  expect(
    await page.evaluate(
      () => (window as unknown as { __firstAccent: string | null }).__firstAccent,
    ),
  ).toBe('indigo');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  expect(await fileTabBg(page)).toBe(INDIGO);
  // Lines and the focus ring use indigo's dark set; the title bar stays the app background.
  expect(await token(page, '--color-accent')).toBe('#818cf8');
  expect(await token(page, '--color-focus')).toBe('#a5b4fc');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b1120');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('comment colours, find hits and the white page never follow the accent', async ({ page }) => {
  await accentColour(page, 'teal');
  await darkTheme(page);
  await page.goto('/');
  await drop(page, [{ name: 'a.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const look = await page.locator('[data-page="0"]').evaluate((el) => {
    const s = getComputedStyle(el);
    const v = (n: string) => s.getPropertyValue(n).trim();
    return {
      bg: s.backgroundColor,
      focus: v('--color-focus'),
      findHit: v('--color-find-hit'),
      // The build's CSS minifier may shorten #ffffff.
      notePaper: v('--color-note-paper').replace(/^#fff$/, '#ffffff'),
      formField: v('--color-form-field'),
    };
  });
  // On the white page in dark, teal's light set (as Blue keeps its light set there).
  expect(look).toEqual({
    bg: 'rgb(255, 255, 255)',
    focus: '#0f766e',
    findHit: '#ffe27a',
    notePaper: '#ffffff',
    formField: '#e3ecfa',
  });
  // The shipped Highlight and Sticky Note colours are still yellow (toolDefaults.ts).
  type Style = { color?: string; strokeColor?: string } | null;
  const style = async (tool: string) => (await cap(page, 'annotate', 'styleOf', tool)) as Style;
  await expect.poll(async () => (await style('highlight'))?.color?.toLowerCase()).toBe('#ffe14d');
  await expect
    .poll(async () => (await style('textComment'))?.strokeColor?.toLowerCase())
    .toBe('#ffcd45');
});

test('Privacy lists the accent, and Clear all local data goes back to Blue', async ({ page }) => {
  await accentColour(page, 'graphite');
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-accent', 'graphite');
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Privacy', exact: true }).click();
  const row = backstage(page).getByRole('row', { name: /Accent colour/ });
  await expect(row).toContainText('Local storage');
  await expect(row).toContainText(ACCENT_KEY);
  await expect(row).toContainText('Yes');

  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await backstage(page).getByRole('button', { name: 'Clear all local data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await expect(confirm).toContainText('accent colour');
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(confirm).toBeHidden();
  await expect(html(page)).not.toHaveAttribute('data-accent', /.*/);
  expect(await stored(page)).toBeNull();
  expect(await fileTabBg(page)).toBe(BLUE);
  await expect(
    backstage(page).getByTestId('appearance-section').getByRole('radio', { name: 'Blue' }),
  ).toBeChecked();
});

test('forced-colors: system colours win over the accent; the swatches keep their colours', async ({
  page,
}) => {
  await accentColour(page, 'teal');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-accent', 'teal');
  expect(await token(page, '--color-brand')).toBe('Highlight');
  expect(await token(page, '--color-focus')).toBe('Highlight');
  expect(await fileTabBg(page)).not.toBe(TEAL);
  const group = await appearance(page);
  const swatch = group.locator('.appearance-accent-swatch').nth(1);
  const look = await swatch.evaluate((el) => {
    const s = getComputedStyle(el);
    return { adjust: s.forcedColorAdjust, bg: s.backgroundColor };
  });
  expect(look).toEqual({ adjust: 'none', bg: TEAL });
  // The current one still has its ring.
  const current = group.locator('.appearance-accent-input:checked + .appearance-accent-swatch');
  expect(await current.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
});

test('in dark with forced-colors, the File tab takes the system pair too', async ({ page }) => {
  await darkTheme(page);
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  expect(await token(page, '--color-brand')).toBe('Highlight');
  expect(await fileTabBg(page)).not.toBe(BLUE);
});
