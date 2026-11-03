import type { Locator } from '@playwright/test';
import { expect } from './fixtures.ts';

// The colour picker (M6-16): a button that opens "Standard colors" and
// "More colors…" (the system picker, which tests drive through its input).

/** Opens the picker named `label` inside `scope` and clicks a standard colour (or "No fill"). */
export async function pickColor(scope: Locator, label: string, swatch: string): Promise<void> {
  const page = scope.page();
  await scope.getByRole('button', { name: label, exact: true }).click();
  const popup = page.getByRole('dialog', { name: label, exact: true });
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: swatch, exact: true }).click();
  await expect(popup).toBeHidden();
}

/** Sets a custom colour, as "More colors…" would. */
export async function customColor(scope: Locator, label: string, hex: string): Promise<void> {
  await scope
    .locator('.ui-color-picker', {
      has: scope.page().getByRole('button', { name: label, exact: true }),
    })
    .locator('input[type="color"]')
    .fill(hex, { force: true });
}
