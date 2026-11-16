import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { accentColour, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M10-03 (ADR-027 D-47): one styled set of form controls. Check boxes and radio
// buttons are drawn by us (appearance: none, our own tick and dot), selects get our
// chevron, fields are 32 px; they stay native inputs, so the keyboard and screen
// readers work as before. In forced-colors mode the browser draws its own controls.

const BRAND = 'rgb(37, 99, 235)';
const LIGHT_ACCENT = 'rgb(37, 99, 235)';
const DARK_ACCENT = 'rgb(96, 165, 250)';
const TEAL = 'rgb(15, 118, 110)';

async function openDoc(page: Page): Promise<void> {
  await page.goto('/');
  await drop(page, [{ name: 'a.pdf', b64: Buffer.from(simplePdf(2)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').last()).toBeVisible();
}

async function searchPane(page: Page): Promise<Locator> {
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Shift+F');
  const pane = page.getByRole('search');
  await expect(pane).toBeVisible();
  return pane;
}

async function setScale(page: Page): Promise<Locator> {
  await page
    .getByRole('tablist', { name: 'Ribbon tabs' })
    .getByRole('tab', { name: 'Measure', exact: true })
    .click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Set Scale' })
    .click();
  const d = page.getByRole('dialog', { name: 'Set scale' });
  await expect(d).toBeVisible();
  return d;
}

const style = (l: Locator) =>
  l.evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      appearance: s.appearance,
      width: r.width,
      height: r.height,
      bg: s.backgroundColor,
      border: s.borderTopColor,
      image: s.backgroundImage,
      radius: s.borderTopLeftRadius,
      transition: s.transitionDuration,
    };
  });

test('check boxes, radio buttons, fields and selects share one style, and keep the keyboard @smoke', async ({
  page,
}) => {
  await openDoc(page);
  const pane = await searchPane(page);

  // The search box: a 32 px field, as in every dialog.
  const box = pane.getByRole('searchbox', { name: 'Search for' });
  expect((await style(box)).height).toBe(32);

  // A check box: ours, 16 px, still a native check box that Space toggles.
  const matchCase = pane.getByRole('checkbox', { name: 'Match Case' });
  const off = await style(matchCase);
  expect(off.appearance).toBe('none');
  expect([off.width, off.height]).toEqual([16, 16]);
  expect(off.image).toBe('none');
  await matchCase.focus();
  await page.keyboard.press('Space');
  await expect(matchCase).toBeChecked();
  // (after the 120 ms colour transition)
  await expect.poll(async () => (await style(matchCase)).bg).toBe(BRAND);
  const on = await style(matchCase);
  expect(on.border).toBe(LIGHT_ACCENT);
  expect(on.image).toContain('data:image/svg+xml');
  // The focus ring and its halo show on keyboard focus.
  expect(await matchCase.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await matchCase.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Space');
  await expect(matchCase).not.toBeChecked();

  // Radio buttons: round, a dot when on, the arrows move and pick.
  const current = pane.getByRole('radio', { name: 'Current document' });
  const all = pane.getByRole('radio', { name: 'All open documents' });
  await expect(current).toBeChecked();
  const dot = await style(current);
  expect(dot.appearance).toBe('none');
  expect(dot.radius).toBe('999px');
  expect(dot.image).toContain('radial-gradient');
  await current.focus();
  await page.keyboard.press('ArrowDown');
  await expect(all).toBeFocused();
  await expect(all).toBeChecked();

  const pageAxe = await new AxeBuilder({ page }).include('.search-pane').analyze();
  expect(pageAxe.violations.map((v) => v.id)).toEqual([]);

  // A dialog: 32 px fields and selects with our chevron.
  const d = await setScale(page);
  const units = d.getByLabel('Units');
  const select = await style(units);
  expect(select.appearance).toBe('none');
  expect(select.height).toBe(32);
  expect(select.image).toContain('data:image/svg+xml');
  await units.selectOption({ label: 'Metres' });
  await expect(units).toHaveValue('m');
  expect((await style(d.getByLabel('Real'))).height).toBe(32);
  await expect(d.getByRole('radio', { name: 'This page' })).toBeChecked();
  const dialogAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(dialogAxe.violations.map((v) => v.id)).toEqual([]);
});

test('dark theme: the edge of an on box is the light accent; the chevron follows the theme', async ({
  page,
}) => {
  await darkTheme(page);
  await openDoc(page);
  const pane = await searchPane(page);
  const radio = pane.getByRole('radio', { name: 'Current document' });
  await expect.poll(async () => (await style(radio)).bg).toBe(BRAND);
  expect((await style(radio)).border).toBe(DARK_ACCENT);
  const d = await setScale(page);
  const darkChevron = (await style(d.getByLabel('Units'))).image;
  // The dark chevron is drawn in the dark icon colour (#e2e8f0), not the light one.
  expect(darkChevron).toContain('e2e8f0');
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('an accent colour fills the on boxes too', async ({ page }) => {
  await accentColour(page, 'teal');
  await openDoc(page);
  const pane = await searchPane(page);
  const radio = pane.getByRole('radio', { name: 'Current document' });
  await expect.poll(async () => (await style(radio)).bg).toBe(TEAL);
  expect((await style(radio)).border).toBe(TEAL);
});

test('forced-colors: the browser draws its own check boxes, radio buttons and selects', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openDoc(page);
  const pane = await searchPane(page);
  expect((await style(pane.getByRole('checkbox', { name: 'Match Case' }))).appearance).toBe('auto');
  expect((await style(pane.getByRole('radio', { name: 'Current document' }))).appearance).toBe(
    'auto',
  );
  const d = await setScale(page);
  expect((await style(d.getByLabel('Units'))).appearance).toBe('auto');
  // A filled button keeps its system pair, so its label is not hidden by the backplate.
  const apply = d.getByRole('button', { name: 'Apply' });
  expect(await apply.evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe('none');
});

test('reduced motion: the controls change state without a transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDoc(page);
  const pane = await searchPane(page);
  const box = await style(pane.getByRole('checkbox', { name: 'Match Case' }));
  expect(box.transition.split(', ').every((t) => t === '0s')).toBe(true);
});
