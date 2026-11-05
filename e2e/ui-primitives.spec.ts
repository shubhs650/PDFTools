import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { THEME_KEY } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-05: UI primitives on the e2e-only gallery page (src/testing/Gallery.tsx).

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).include('[data-testid="gallery"]').analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

/** Outline or box-shadow on the focused element: the visible focus ring. */
async function focusRing(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      tag: el.tagName,
      outline: s.outlineStyle,
      width: s.outlineWidth,
      name: el.getAttribute('aria-label') ?? el.textContent,
    };
  });
}

test('the gallery passes an axe scan in light, dark and pseudo-locale', async ({ page }) => {
  test.setTimeout(60_000); // three loads, each one reloaded for its theme
  for (const [q, theme] of [
    ['?gallery', 'light'],
    ['?gallery', 'dark'],
    ['?gallery&locale=pseudo', 'light'],
  ] as const) {
    await page.goto(`/${q}`);
    // The theme is the one stored on the device (M7-11): set it, then load again.
    await page.evaluate(
      ([key, t]) => {
        if (t === 'dark') localStorage.setItem(key, t);
        else localStorage.removeItem(key);
      },
      [THEME_KEY, theme] as const,
    );
    await page.reload();
    await expect(page.getByTestId('gallery')).toBeVisible();
    if (theme === 'dark') await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    else await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    expect(await axe(page), `${q} ${theme}`).toEqual([]);
  }
});

test('every control is reachable with Tab and shows a focus ring', async ({ page }) => {
  await page.goto('/?gallery');
  await expect(page.getByTestId('gallery')).toBeVisible();
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const ring = await focusRing(page);
    if (!ring || ring.tag === 'BODY') break;
    expect(ring.outline, `${ring.name} has a visible focus ring`).not.toBe('none');
    seen.push(ring.name);
  }
  // Disabled controls are skipped; the rest are all in the tab order.
  expect(seen).toEqual([
    'Primary action',
    'Default action',
    'Save',
    'Toggle snapping',
    'Save as',
    'More options for Save as',
    'Open menu',
    'Open dialog',
  ]);
});

test('menus, split buttons and dialogs work with the keyboard alone', async ({ page }) => {
  await page.goto('/?gallery');
  // Dropdown: Enter opens, arrows move (disabled item skipped), Enter selects.
  await page.getByRole('button', { name: 'Open menu' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('log')).toHaveText('menuA');

  // Split button arrow opens the alternatives.
  await page.getByRole('button', { name: 'More options for Save as' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Save a copy' })).toBeFocused();
  await expect(page.getByRole('menuitem', { name: 'Save optimized' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  // Toggle via Space.
  const toggle = page.getByRole('button', { name: 'Toggle snapping' });
  // Radix restores the page after the menu closes on its own schedule; retry
  // until focus really lands on the toggle.
  await expect(async () => {
    await toggle.focus();
    await expect(toggle).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // Dialog: named, traps focus, Esc closes, focus returns to the opener.
  const opener = page.getByRole('button', { name: 'Open dialog' });
  await expect(async () => {
    await opener.focus();
    await expect(opener).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Example dialog' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('forced-colors (High Contrast) keeps a visible focus ring', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/?gallery');
  await expect(page.getByTestId('gallery')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Primary action' })).toBeFocused();
  const ring = await focusRing(page);
  expect(ring?.outline).not.toBe('none');
  expect(ring?.width).not.toBe('0px');
});
