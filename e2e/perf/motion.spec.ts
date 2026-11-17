import type { Page } from '@playwright/test';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { skipReviewerPrompt } from '../support/shots.ts';

// M10-07 (ADR-027 D-47): the animated surfaces, with motion on and a 200-page
// document open, never block the main thread (perf guard: no task > 100 ms, rule 1).
// Every ribbon tab, a menu, a dialog, the backstage, each left pane, the
// Properties pane and Tell me, opened and closed twice.

const run = (page: Page, id: string) => cap(page, 'commands', 'run', id);
const TABS = [
  'View',
  'Comment',
  'Form',
  'Measure',
  'Organize',
  'Convert',
  'Protect',
  'Help',
  'Home',
];
const PANES = ['rail.bookmarks', 'rail.comments', 'rail.search', 'rail.thumbnails'];

test('ribbon tabs, menus, dialogs, the backstage and panes animate without long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await skipReviewerPrompt(page);
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(200).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await expect(page.locator('.thumb-img').first()).toBeVisible();
  await guard.startMeasuring();

  const opened: string[] = [];
  for (let round = 0; round < 2; round++) {
    for (const tab of TABS) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.waitForTimeout(250); // let the groups' fade run
    }
    for (const pane of PANES) {
      expect(await run(page, pane)).toBe(true);
      await page.waitForTimeout(250);
    }
    await page.locator('.thumb').first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.getByTestId('document-view').focus();
    await page.keyboard.press('Control+P');
    await expect(page.getByRole('dialog', { name: 'Print' })).toBeVisible();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Print' })).toHaveCount(0);

    await page.getByTestId('file-tab').click();
    await expect(page.getByTestId('backstage')).toBeVisible();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('backstage')).toHaveCount(0);

    expect(await run(page, 'view.propertiesPane')).toBe(true);
    await page.waitForTimeout(250);
    expect(await run(page, 'view.propertiesPane')).toBe(true);

    // Tell me (M10-08·O2): opens, searches a query that lists many commands (each one's
    // state read once), runs one.
    await page.keyboard.press('Alt+q');
    const tellMe = page.getByRole('combobox', { name: 'Tell me what you want to do' });
    await tellMe.fill('e');
    await tellMe.press('Enter');
    await expect(page.getByTestId('tell-me').getByRole('option').first()).toBeVisible();
    await page.waitForTimeout(250);
    await tellMe.fill('fit page');
    await tellMe.press('Enter');
    await tellMe.press('Enter');
    await expect(page.getByTestId('tell-me')).toHaveCount(0);
    opened.push(`round ${String(round + 1)}`);
  }
  const longTasks = await guard.longTasksOverLimit();
  test.info().annotations.push({
    type: 'm10-07-motion',
    description: JSON.stringify({ rounds: opened.length, longTasks }),
  });
});
