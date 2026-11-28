import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-08 (D-76, ADR-035, plan M14 §8): the Measurements pane in the left rail.
// Groups by tool with totals, This page or All pages, a row's click or Enter
// shows and selects its measurement, flags for spanning and paper size, the
// Scales section (every page's scale and viewports; replaces the Properties
// pane's list), the Measurements filter in Comments and the CRS option; axe
// light and dark; screenshots at 1280, 1366 and 1920 px.

interface Obj {
  id: string;
  type: number;
  contents?: string;
  measure?: { tool: string };
}

const T = { LINE: 4, POLYGON: 7 };
const MM = 72 / 25.4;
const H = 842; // simplePdf is A4: user y → EmbedPDF y = H - y
const SHOTS = '/mnt/project-files/M14-08';

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const pane = (page: Page) => page.getByTestId('measurements-pane');
const list = (page: Page) => page.getByTestId('measure-list');
const scales = (page: Page) => page.getByTestId('measure-scales');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/M14-08/${name}.png` });
  }
}

async function open(page: Page, pages = 1, width = 1280) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  const b64 = Buffer.from(simplePdf(pages)).toString('base64');
  await drop(page, [{ name: 'sheet.pdf', b64 }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  return id;
}

async function setScale(page: Page) {
  await measureTab(page).getByRole('button', { name: 'Set Scale' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill('100');
  await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
  await dialog.getByLabel('Decimal places').selectOption({ value: '2' });
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
}

async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function clicks(page: Page, pts: [number, number][]) {
  for (const p of pts) {
    const s = await at(page, ...p);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await page.mouse.click(s.x, s.y);
  }
}

async function tool(page: Page, name: string) {
  await measureTab(page).getByRole('button', { name, exact: true }).click();
}

/** A new measurement of `type`, once its value is in. */
async function newest(page: Page, id: string, type: number, before: Set<string>) {
  let m: Obj | undefined;
  await expect
    .poll(async () => {
      m = (await objects(page, id)).find(
        (o) => o.type === type && !before.has(o.id) && !!o.contents,
      );
      return m?.id ?? null;
    })
    .not.toBeNull();
  if (!m) throw new Error('no measurement');
  return m.id;
}

/** A Length set to user-space points a → b (exact values, whatever the clicks were). */
async function length(page: Page, id: string, a: [number, number], b: [number, number]) {
  const before = new Set((await objects(page, id)).map((o) => o.id));
  await tool(page, 'Length');
  await clicks(page, [
    [100, 150],
    [200, 150],
  ]);
  await page.keyboard.press('Enter');
  const m = await newest(page, id, T.LINE, before);
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'update', id, 0, m, {
    linePoints: { start: { x: a[0], y: H - a[1] }, end: { x: b[0], y: H - b[1] } },
  });
  return m;
}

/** An Area set to a w × h mm (paper) rectangle at user-space x, y. */
async function area(page: Page, id: string, x: number, y: number, w: number, h: number) {
  const before = new Set((await objects(page, id)).map((o) => o.id));
  await tool(page, 'Area');
  await clicks(page, [
    [330, 60],
    [480, 60],
    [480, 180],
  ]);
  await page.keyboard.press('Enter');
  const m = await newest(page, id, T.POLYGON, before);
  await page.keyboard.press('Escape');
  const pts = [
    [x, y],
    [x + w * MM, y],
    [x + w * MM, y + h * MM],
    [x, y + h * MM],
  ].map(([px = 0, py = 0]) => ({ x: px, y: H - py }));
  await cap(page, 'annotate', 'update', id, 0, m, { vertices: pts });
  return m;
}

async function openPane(page: Page) {
  if (await pane(page).isVisible()) return;
  await page.locator('[data-rail="rail.measurements"] button').click();
  await expect(pane(page)).toBeVisible();
}

const valueOf = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot)?.contents ?? null;

test('groups by tool with totals; a click and Enter show and select; This page @smoke', async ({
  page,
}) => {
  const id = await open(page, 2);
  await setScale(page);
  // 20 mm and 15 mm of paper at 1:100: 2 m and 1.5 m; a 100 × 50 mm area: 50 m².
  const a = await length(page, id, [60, 120], [60 + 20 * MM, 120]);
  const b = await length(page, id, [60, 300], [60 + 15 * MM, 300]);
  const c = await area(page, id, 300, 400, 100, 50);
  await expect.poll(() => valueOf(page, id, a)).toBe('2.00 m');
  await expect.poll(() => valueOf(page, id, b)).toBe('1.50 m');
  await expect.poll(() => valueOf(page, id, c)).toBe('50.00 m²');
  await cap(page, 'annotate', 'select', id, 0, c);
  await page.keyboard.press('Escape');

  await openPane(page);
  const lengths = page.getByTestId('measure-group-length');
  await expect(lengths).toContainText('Length');
  await expect(lengths).toContainText('Total 3.50 m');
  await expect(lengths.getByRole('option')).toHaveCount(2);
  // Top to bottom on the page: b (user y 300) is above a (user y 120).
  await expect(lengths.getByRole('option').first()).toContainText('1.50 m');
  await expect(lengths.getByRole('option').first()).toContainText('Page 1 · 1 : 100');
  await expect(page.getByTestId('measure-group-area')).toContainText('Total 50.00 m²');
  await expect(pane(page).getByRole('status').first()).toHaveText('3 measurements');
  // The group's name says its total to a screen reader.
  await expect(
    page.getByRole('group', { name: /Length, 2 measurements\. Total 3\.50 m/ }),
  ).toBeVisible();

  // A click selects the markup on the page.
  await lengths.getByRole('option').nth(1).click();
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([a]);
  await expect(lengths.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');

  // Keyboard (Q36): one tab stop, arrows move, Enter shows and selects.
  await list(page).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([c]);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([b]);

  // An edit updates the row and the total.
  await cap(page, 'annotate', 'update', id, 0, a, {
    linePoints: { start: { x: 60, y: H - 120 }, end: { x: 60 + 30 * MM, y: H - 120 } },
  });
  await expect(lengths).toContainText('Total 4.50 m');

  // This page: page 2 has none.
  await pane(page).getByLabel('This page').check();
  await expect(lengths).toContainText('Total 4.50 m');
  await page.evaluate(() =>
    (
      window as unknown as {
        __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
      }
    ).__pdftoolsTest.capabilities.commands.run('view.nextPage'),
  );
  await expect(pane(page)).toContainText('No measurements on this page.');
  await pane(page).getByLabel('All pages').check();
  await expect(page.getByTestId('measure-row')).toHaveCount(3);
});

test('flags: spans two scales (no number, out of the total) and paper size; Scales section', async ({
  page,
}) => {
  const id = await open(page, 2);
  // Page 1 measured at paper size from the no-scale question (Q29).
  await tool(page, 'Length');
  await clicks(page, [
    [100, 100],
    [300, 100],
  ]);
  const prompt = page.getByRole('region', { name: 'No scale on this page' });
  await prompt.getByRole('button', { name: 'Measure at paper size' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await openPane(page);
  await expect(page.getByTestId('measure-row')).toHaveCount(1);
  await expect(page.getByTestId('measure-row')).toContainText('Paper size');
  await expect(page.getByTestId('measure-group-length')).toContainText('At paper size');

  // A real scale, a Detail A 1:5 from the Scales section (keyboard path), a line across it.
  await setScale(page);
  await expect(scales(page)).toContainText('Page 1 (current)');
  await expect(scales(page)).toContainText('1 : 100');
  await scales(page).getByRole('button', { name: 'Add viewport' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scale viewport' });
  await dialog.getByLabel('Left').fill('300');
  await dialog.getByLabel('Bottom').fill('400');
  await dialog.getByLabel('Right').fill('550');
  await dialog.getByLabel('Top').fill('700');
  await dialog.getByLabel('Paper').fill('1');
  await dialog.getByLabel('Real', { exact: true }).fill('5');
  await dialog.getByLabel('Units').selectOption({ label: 'Millimetres' });
  await dialog.getByLabel('Decimal places').selectOption({ value: '1' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('measure-viewport')).toHaveText('Detail A · 1 : 5');

  const plate = await length(page, id, [320, 450], [320 + 80 * MM, 450]);
  await length(page, id, [100, 200], [320, 450]);
  await expect.poll(() => valueOf(page, id, plate)).toBe('400.0 mm');
  const lengths = page.getByTestId('measure-group-length');
  const spanRow = lengths.getByRole('option').filter({ hasText: 'Spans 2 scales' });
  await expect(spanRow).toHaveCount(1);
  await expect(spanRow).toContainText('No value');
  await expect(lengths).toContainText('1 not in the total');
  await expect(lengths.getByRole('option').filter({ hasText: 'Detail A · 1 : 5' })).toContainText(
    '400.0 mm',
  );

  // A click on a viewport selects it on the page, on any tab.
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByTestId('measure-viewport').click();
  await expect(page.getByTestId('measure-viewport')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.viewport-outline--picked')).toHaveCount(1);
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.mouse.move(5, 5);
  await shot(page, '03-flags-scales-viewport-light-1366');
  // A click on the page lets it go.
  const p = await at(page, 50, 50);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.viewport-outline--picked')).toHaveCount(0);

  // The Properties pane no longer lists viewports.
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  await expect(
    page.getByTestId('properties-pane').getByRole('button', { name: 'Add viewport' }),
  ).toHaveCount(0);

  // Set the scale of a page from its row.
  await scales(page).getByRole('button', { name: 'Set the scale of page 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Set scale' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Comments: a Measurements filter hides them; Export CRS leaves them out by default', async ({
  page,
}) => {
  const id = await open(page);
  await setScale(page);
  await length(page, id, [60, 120], [60 + 20 * MM, 120]);
  const note = (await cap(page, 'annotate', 'createSquare', id, 0, 300, 300)) as string;
  await cap(page, 'annotate', 'update', id, 0, note, { contents: 'Check the wall' });
  await page.locator('[data-rail="rail.comments"] button').click();
  const comments = page.getByTestId('comments-pane');
  await expect(comments).toContainText('2.00 m');
  await expect(comments).toContainText('Check the wall');
  await comments.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Show' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Measurements' }).click();
  await page.keyboard.press('Escape');
  await expect(comments).not.toContainText('2.00 m');
  await expect(comments).toContainText('Check the wall');
  const chip = comments.getByRole('button', { name: 'Remove filter Measurements hidden' });
  await chip.click();
  await expect(comments).toContainText('2.00 m');

  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page
    .getByRole('button', { name: /^Export CRS/ })
    .first()
    .click();
  const crs = page.getByRole('dialog', { name: 'Export Comment Review Sheet' });
  await expect(crs.getByLabel('Include measurements')).not.toBeChecked();
  await page.keyboard.press('Escape');
});

for (const theme of ['light', 'dark'] as const)
  test(`axe and screenshots, ${theme} @a11y`, async ({ page }) => {
    if (theme === 'dark') await darkTheme(page);
    const id = await open(page, 2);
    await setScale(page);
    await length(page, id, [60, 120], [60 + 20 * MM, 120]);
    await length(page, id, [60, 300], [60 + 15 * MM, 300]);
    const c = await area(page, id, 300, 400, 100, 50);
    await cap(page, 'annotate', 'update', id, 0, c, {
      measure: { tool: 'area', label: 'Slab S1' },
    });
    await openPane(page);
    await expect(page.getByTestId('measure-row')).toHaveCount(3);
    await page.getByTestId('measure-row').first().click();
    await page.mouse.move(5, 5);
    expect(await axe(page)).toEqual([]);
    for (const width of [1280, 1366, 1920]) {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : 800 });
      await shot(page, `01-pane-${theme}-${String(width)}`);
    }
    await page.setViewportSize({ width: 1366, height: 800 });
    await pane(page).getByLabel('This page').check();
    await list(page).focus();
    await page.keyboard.press('ArrowDown');
    expect(await axe(page)).toEqual([]);
    await shot(page, `02-this-page-keyboard-${theme}-1366`);
  });
