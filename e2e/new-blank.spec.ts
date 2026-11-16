import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, darkTheme } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M10-08·O4 (D-49, §7.8): Create Blank PDF from the start screen, File → New and
// Ctrl+Alt+N. The Work worker builds it; it opens as an unsaved "Untitled n.pdf"
// tab whose first save is a Save As.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Create Blank PDF' });
const activeId = async (page: Page) => (await cap(page, 'view', 'activeDocId')) as string;
const sizes = async (page: Page) =>
  ((await cap(page, 'pages', 'info', await activeId(page))) as { w: number; h: number }[]).map(
    (p) => `${String(p.w)}x${String(p.h)}`,
  );

for (const theme of ['light', 'dark'] as const)
  test(`Create blank PDF on the start screen: Letter, landscape, 3 pages (${theme}) @smoke`, async ({
    page,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    await page.goto('/');
    const actions = page.getByTestId('start-screen').getByRole('list', { name: 'Quick actions' });
    const tile = actions.getByRole('button').first();
    await expect(tile).toHaveAccessibleName('Create blank PDF');
    await expect(tile).toHaveAccessibleDescription('A4, Letter or a custom size');
    await tile.click();

    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.getByLabel('Page size')).toHaveValue('a4');
    await expect(d.getByRole('radio', { name: 'Portrait' })).toBeChecked();
    await expect(d.getByLabel('Number of pages')).toHaveValue('1');
    await expect(d.getByTestId('blank-summary')).toHaveText('1 page, 210 × 297 mm');
    await expect(d.getByRole('button', { name: 'Help for this dialog' })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations.map((v) => v.id),
    ).toEqual([]);

    await d.getByLabel('Page size').selectOption('letter');
    await d.getByRole('radio', { name: 'Landscape' }).check();
    await d.getByLabel('Number of pages').fill('3');
    await expect(d.getByTestId('blank-summary')).toHaveText('3 pages, each 11 × 8.5 in');
    await d.getByRole('button', { name: 'Create' }).click();

    await expect(d).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(1);
    await expect(tabs(page).first()).toHaveAccessibleName('Untitled 1.pdf, unsaved changes');
    await expect.poll(() => sizes(page)).toEqual(['792x612', '792x612', '792x612']);
  });

test('File → New and Ctrl+Alt+N: a custom size, then the first save is a Save As', async ({
  page,
}) => {
  // No file pickers: Save As falls back to a download with the suggested name.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.goto('/');

  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await expect(backstage.getByRole('heading', { name: 'New', exact: true })).toBeVisible();
  await backstage.getByRole('region', { name: 'New' }).getByRole('button', { name: 'New' }).click();
  await expect(backstage).toBeHidden();
  const d = dialog(page);
  await expect(d).toBeVisible();

  // A custom size: width × height as typed, in mm; out-of-range sides are refused.
  await d.getByLabel('Page size').selectOption('custom');
  await expect(d.getByRole('radio', { name: 'Portrait' })).toHaveCount(0);
  await d.getByLabel('Units').selectOption('mm');
  await d.getByLabel('Width').fill('5');
  await expect(d.getByText('Enter a size from 12.7 to 5,080 mm.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Create' })).toBeDisabled();
  await d.getByLabel('Width').fill('420');
  await d.getByLabel('Height').fill('297');
  await d.getByLabel('Number of pages').fill('0');
  await expect(d.getByText('Enter a whole number from 1 to 1,000.')).toBeVisible();
  await d.getByLabel('Number of pages').fill('2');
  await expect(d.getByTestId('blank-summary')).toHaveText('2 pages, each 420 × 297 mm');
  await d.getByLabel('Number of pages').press('Enter');
  await expect(tabs(page).first()).toHaveAccessibleName('Untitled 1.pdf, unsaved changes');
  await expect.poll(() => sizes(page)).toEqual(['1191x842', '1191x842']);

  // Ctrl+Alt+N reopens it with the last choices; a second document gets the next name.
  await page.keyboard.press('Control+Alt+n');
  await expect(d).toBeVisible();
  await expect(d.getByLabel('Page size')).toHaveValue('custom');
  await expect(d.getByLabel('Width')).toHaveValue('420');
  await d.getByLabel('Page size').selectOption('a4');
  await d.getByLabel('Number of pages').fill('1');
  await d.getByRole('button', { name: 'Create' }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAccessibleName('Untitled 2.pdf, unsaved changes');

  // A third identical A4 document is a new tab, not "already open".
  await page.keyboard.press('Control+Alt+n');
  await d.getByRole('button', { name: 'Create' }).click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(2)).toHaveAccessibleName('Untitled 3.pdf, unsaved changes');

  // Ctrl+S on a new document asks where to save it (here: a download).
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await download;
  expect(file.suggestedFilename()).toBe('Untitled 3.pdf');
  const text = readFileSync(await file.path()).toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toMatch(/\/Count 1\b/);
});
