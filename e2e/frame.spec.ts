import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M1-09: the empty app frame (D-01, §8): landmarks, accessibility, panes, width.

async function stores(page: Page) {
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
        .__pdftoolsTest?.capabilities.stores,
    ),
  );
}

test('landmarks are present and named, and axe finds no violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Document area' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Navigation panes' })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Status bar' })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('the navigation panes collapse and expand from the keyboard', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Hide navigation panes' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('left-pane')).toBeHidden();
  const show = page.getByRole('button', { name: 'Show navigation panes' });
  await expect(show).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('left-pane')).toBeVisible();
});

test('the Properties pane is a named region with a keyboard close button', async ({ page }) => {
  await page.goto('/');
  await stores(page);
  await page.evaluate(() => {
    (
      window as unknown as {
        __pdftoolsTest: {
          capabilities: { stores: { app: { getState(): { setProperties(o: boolean): void } } } };
        };
      }
    ).__pdftoolsTest.capabilities.stores.app
      .getState()
      .setProperties(true);
  });
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  await page.getByRole('button', { name: 'Close the Properties pane' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('properties-pane')).toBeHidden();
});

for (const q of ['/', '/?locale=pseudo']) {
  test(`no horizontal scroll at the 1280 px minimum width (${q})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(q);
    await stores(page);
    await page.evaluate(() => {
      const s = (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: { stores: { app: { getState(): { setProperties(o: boolean): void } } } };
          };
        }
      ).__pdftoolsTest.capabilities.stores.app;
      s.getState().setProperties(true);
    });
    await expect(page.getByTestId('properties-pane')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}
