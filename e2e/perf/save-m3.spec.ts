import type { Page } from '@playwright/test';
import { cap } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';

// M3-20 / §12: Ctrl+S with 100 markups of mixed M3 types — shapes, distance,
// perimeter and area measurements (with their labels and staged /Measure),
// and dynamic stamps — saves in < 1 s with no main-thread long task.

const tab = (page: Page) =>
  page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab').first();

test('Ctrl+S with 100 mixed M3 markups (measurements, stamps): < 1 s, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name: 'm3.pdf', b64: pdfs.simple(3).toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  // A page scale, so the measurements carry /Measure.
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Set Scale' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill('100');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();

  // 60 shapes, 30 measurements (10 of each kind, each with its label), 10 stamps.
  for (let i = 0; i < 60; i++)
    await cap(
      page,
      'annotate',
      'createSquare',
      id,
      i % 3,
      20 + (i % 10) * 50,
      60 + Math.floor(i / 10) * 40,
    );
  for (let i = 0; i < 10; i++) {
    const y = 400 + i * 30;
    await cap(page, 'annotate', 'measure', id, 0, 'distance', [
      { x: 40, y },
      { x: 200, y },
    ]);
    await cap(page, 'annotate', 'measure', id, 1, 'perimeter', [
      { x: 40, y },
      { x: 120, y: y + 20 },
      { x: 200, y },
    ]);
    await cap(page, 'annotate', 'measure', id, 2, 'area', [
      { x: 300, y },
      { x: 400, y },
      { x: 400, y: y + 20 },
    ]);
  }
  for (let i = 0; i < 10; i++) await cap(page, 'annotate', 'stamp', id, 2, 300, 60 + i * 30);
  // 100 markups plus the 30 measurement labels.
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[]).length, {
      timeout: 30_000,
    })
    .toBe(130);
  await expect(tab(page)).toHaveAccessibleName(/unsaved changes/);
  await cap(page, 'view', 'settle', 500);

  await guard.startMeasuring();
  const t0 = await page.evaluate(() => performance.now());
  await page.keyboard.press('Control+S');
  await expect(tab(page)).toHaveAccessibleName('m3.pdf');
  const ms = Math.round((await page.evaluate(() => performance.now())) - t0);
  test.info().annotations.push({ type: 'save-100-m3-markups-ms', description: String(ms) });
  expect(ms).toBeLessThan(1000);
});
