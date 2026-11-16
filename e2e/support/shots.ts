// Screenshot helpers for PR before/after sets (M10 onwards). Scratch shot specs
// (and help-shots) start from here so a run never stalls on a first-run prompt:
// the "Who is reviewing?" profile dialog opens on the first comment tool and
// blocks every click behind it until a reviewer profile exists.
import type { Page } from '@playwright/test';
import { simplePdf } from '../fixtures/generate.ts';
import { cap, darkTheme, drop } from './app.ts';
import { expect } from './fixtures.ts';

export type ShotTheme = 'light' | 'dark';

/**
 * Stores a reviewer profile, so the "Who is reviewing?" dialog never opens
 * (it otherwise appears on the first comment tool and blocks the page).
 * Call after `page.goto`.
 */
export async function skipReviewerPrompt(page: Page, name = 'Ana de Vries'): Promise<void> {
  await cap(page, 'annotate', 'setProfile', name);
}

/**
 * Loads the app for a screenshot: the theme, the window width (800 px high) and a
 * reviewer profile, so no first-run prompt gets in the way.
 */
export async function startShots(page: Page, theme: ShotTheme, width: number): Promise<void> {
  if (theme === 'dark') await darkTheme(page);
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
  await skipReviewerPrompt(page);
}

/** Opens a self-made PDF (rule 13) by drag-and-drop and waits for its first page. */
export async function openSample(page: Page, pages = 3, name = 'drawing.pdf'): Promise<void> {
  await drop(page, [{ name, b64: Buffer.from(simplePdf(pages)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}
