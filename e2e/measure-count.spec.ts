import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { measureManifest, measureSheetBytes } from './fixtures/measure-corpus/index.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-07 (D-75, ADR-035 Amendment 1, plan M14 §7, Q11, Q14, Q15): Count. Each
// click places one Stamp of the group chosen in the Count group box, with the
// next number of that group across the document beside its symbol ("Door 3").
// A deleted count leaves its gap; Renumber group in the Measurements pane
// closes the gaps in one undo step. Changing the group changes every count of
// it in one undo step. Show number hides the number. Saved with Ctrl+S (one
// shared caption font) and read back. Same-size count numbers: a view option
// from the status bar, screen only, at several zooms.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- objects known to exist */

interface P {
  x: number;
  y: number;
}
interface Obj {
  id: string;
  type: number;
  contents?: string;
  strokeColor?: string;
  measure?: { tool: string; group?: string; n?: number; sym?: string; size?: number; hideN?: true };
}

const STAMP = 13;
const SHEET = '01_floor_plan_1-100_mm.pdf';
const SHOTS = '/mnt/project-files/M14-07';

const sheet = () => {
  const s = measureManifest().sheets.find((x) => x.file === SHEET);
  if (!s) throw new Error('floor plan missing');
  return s;
};

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const props = (page: Page) => page.getByTestId('properties-pane');
/** The Count tool's properties (a count just placed is selected and shows its own too). */
const toolProps = (page: Page) => page.getByTestId('tool-properties');
/** A selected count's properties. */
const info = (page: Page) => page.getByTestId('measure-info');
const pane = (page: Page) => page.getByTestId('measurements-pane');
const view = (page: Page) => page.getByTestId('document-view');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const counts = async (page: Page, id: string) =>
  (await objects(page, id)).filter((o) => o.type === STAMP && o.measure?.tool === 'count');
/** The counts' texts, sorted. */
const texts = async (page: Page, id: string) =>
  (await counts(page, id)).map((o) => o.contents ?? '').sort();
const byText = async (page: Page, id: string, text: string) =>
  (await counts(page, id)).find((o) => o.contents === text);
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);
const run = (page: Page, cmd: string) =>
  page.evaluate(
    (c) =>
      (
        window as unknown as {
          __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
        }
      ).__pdftoolsTest.capabilities.commands.run(c),
    cmd,
  );

// Screenshots for people to look at (owner's rule): at device scale 2.
test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/m14-07/${name}.png` });
  }
}

async function open(page: Page, bytes = measureSheetBytes(SHEET), name = SHEET) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  return reopen(page, bytes, name);
}

async function reopen(page: Page, bytes: Uint8Array, name: string) {
  const before = await cap(page, 'view', 'activeDocId');
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(before);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  return id;
}

/** Page point (EmbedPDF, y down) → screen, at the zoom now. */
async function at(page: Page, p: P) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / sheet().width;
  return { x: box.x + p.x * s, y: box.y + p.y * s };
}

/** CSS px per page point now. */
async function zoomScale(page: Page) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  return (box?.width ?? 0) / sheet().width;
}

async function place(page: Page, id: string, pts: readonly P[]) {
  for (const p of pts) {
    const before = (await counts(page, id)).length;
    const s = await at(page, p);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await page.mouse.click(s.x, s.y);
    await expect.poll(async () => (await counts(page, id)).length).toBe(before + 1);
  }
}

async function countTool(page: Page) {
  const b = measureTab(page).getByRole('button', { name: 'Count', exact: true });
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function showProperties(page: Page) {
  if (!(await props(page).isVisible())) await run(page, 'view.propertiesPane');
  await expect(props(page)).toBeVisible();
}

async function openPane(page: Page) {
  if (await pane(page).isVisible()) return;
  await page.locator('[data-rail="rail.measurements"] button').click();
  await expect(pane(page)).toBeVisible();
}

async function rename(page: Page, name: string) {
  const field = toolProps(page).getByLabel('Name', { exact: true });
  await field.fill(name);
  // Committed on leaving the field.
  await field.press('Tab');
  await expect(toolProps(page).getByLabel('Group', { exact: true })).toHaveValue(name);
}

async function save(page: Page, id: string, original: Uint8Array) {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(s).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(s.tail, 'base64');
  return { file: Buffer.concat([Buffer.from(original), tail]), tail: tail.toString('latin1') };
}

const row = (y: number, n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ x: 120 + i * 60, y }));

test('Count: groups, numbers across the document, gaps and Renumber group, the group edited in one step; saved and read back @smoke', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const bytes = measureSheetBytes(SHEET);
  const id = await open(page, bytes);
  await showProperties(page);
  await countTool(page);

  // The Count group box: a name, a symbol, a colour (the standard picker) and a size.
  await expect(toolProps(page).getByRole('heading', { name: 'Count group' })).toBeVisible();
  await rename(page, 'Door');
  await toolProps(page).getByLabel('Symbol', { exact: true }).selectOption({ label: 'Square' });
  await expect(page.getByTestId('count-next')).toHaveText('Next click: Door 1');

  // Each click places one count with the next number.
  await place(page, id, row(140, 3));
  await expect.poll(() => texts(page, id)).toEqual(['Door 1', 'Door 2', 'Door 3']);
  const door1 = (await byText(page, id, 'Door 1'))!;
  expect(door1.measure).toMatchObject({ group: 'Door', n: 1, sym: 'square', size: 12 });
  await expect(page.getByTestId('count-next')).toHaveText('Next click: Door 4');
  // The ghost under the pointer shows the next one.
  const ghostAt = await at(page, { x: 320, y: 140 });
  await page.mouse.move(ghostAt.x, ghostAt.y, { steps: 3 });
  await expect(page.getByTestId('measure-count-ghost')).toBeVisible();
  await expect(page.getByTestId('measure-count-next')).toHaveText('Door 4');
  await shot(page, '01-count-tool-door');

  // A second group: its own numbers from 1.
  await toolProps(page).getByRole('button', { name: 'New group' }).click();
  await rename(page, 'Window');
  await toolProps(page).getByLabel('Symbol', { exact: true }).selectOption({ label: 'Diamond' });
  await place(page, id, row(260, 2));
  await expect
    .poll(() => texts(page, id))
    .toEqual(['Door 1', 'Door 2', 'Door 3', 'Window 1', 'Window 2']);
  await shot(page, '02-two-groups');

  // Back to Door: a deleted count leaves its gap; the next takes the highest plus one.
  await toolProps(page).getByLabel('Group', { exact: true }).selectOption('Door');
  await page.keyboard.press('Escape');
  const door2 = (await byText(page, id, 'Door 2'))!;
  await cap(page, 'annotate', 'select', id, 0, door2.id);
  await view(page).press('Delete');
  await expect.poll(() => texts(page, id)).not.toContain('Door 2');
  await countTool(page);
  await expect(page.getByTestId('count-next')).toHaveText('Next click: Door 4');
  await place(page, id, [{ x: 120, y: 380 }]);
  await expect
    .poll(() => texts(page, id))
    .toEqual(['Door 1', 'Door 3', 'Door 4', 'Window 1', 'Window 2']);
  await page.keyboard.press('Escape');

  // The Measurements pane: one group per count group, and Renumber for the one with gaps.
  await openPane(page);
  await expect(page.getByTestId('measure-group-count:door')).toBeVisible();
  await expect(page.getByTestId('measure-group-count:window')).toBeVisible();
  await expect(page.getByTestId('measure-group-count:door').getByTestId('measure-row')).toHaveText([
    /Door 1/,
    /Door 3/,
    /Door 4/,
  ]);
  const renumber = pane(page).getByRole('button', { name: 'Renumber Door' });
  await expect(renumber).toBeVisible();
  await expect(pane(page).getByRole('button', { name: 'Renumber Window' })).toHaveCount(0);
  await shot(page, '03-pane-gap');
  await renumber.click();
  await expect
    .poll(() => texts(page, id))
    .toEqual(['Door 1', 'Door 2', 'Door 3', 'Window 1', 'Window 2']);
  await expect(renumber).toHaveCount(0);
  // One undo step brings the gaps back.
  await cap(page, 'annotate', 'undo', id);
  await expect
    .poll(() => texts(page, id))
    .toEqual(['Door 1', 'Door 3', 'Door 4', 'Window 1', 'Window 2']);
  await cap(page, 'annotate', 'redo', id);
  await expect
    .poll(() => texts(page, id))
    .toEqual(['Door 1', 'Door 2', 'Door 3', 'Window 1', 'Window 2']);
  await shot(page, '04-pane-renumbered');
  expect(await axe(page)).toEqual([]);

  // A selected count: its group, Show number, and the group edited for all its counts at once.
  const d2 = (await byText(page, id, 'Door 2'))!;
  await cap(page, 'annotate', 'select', id, 0, d2.id);
  await expect(info(page)).toBeVisible();
  await expect(info(page).getByLabel('Group', { exact: true })).toHaveValue('Door');
  await info(page).getByLabel('Size', { exact: true }).selectOption({ label: '16 pt' });
  await expect
    .poll(async () =>
      (await counts(page, id))
        .filter((o) => o.measure?.group === 'Door')
        .map((o) => o.measure?.size),
    )
    .toEqual([16, 16, 16]);
  await cap(page, 'annotate', 'undo', id);
  await expect
    .poll(async () =>
      (await counts(page, id))
        .filter((o) => o.measure?.group === 'Door')
        .map((o) => o.measure?.size),
    )
    .toEqual([12, 12, 12]);
  await cap(page, 'annotate', 'redo', id);
  // Show number off: the symbol alone.
  await cap(page, 'annotate', 'select', id, 0, d2.id);
  const showN = info(page).getByLabel('Show number', { exact: true });
  await showN.uncheck();
  await expect.poll(async () => (await byText(page, id, 'Door 2'))?.measure?.hideN).toBe(true);
  await shot(page, '05-selected-count-no-number');
  await info(page).getByLabel('Show number', { exact: true }).check();
  await expect.poll(async () => (await byText(page, id, 'Door 2'))?.measure?.hideN).toBeUndefined();

  // Ctrl+S: five Stamps with their Triya data and one shared caption font; read back.
  const { file, tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/Subtype\s*\/Stamp/);
  expect(tail).toMatch(/\/G\s*\(Door\)/);
  expect(tail).toMatch(/\/Sy\s*\/diamond/);
  expect(tail.match(/\/FontFile2/g)?.length).toBe(1);
  const back = await reopen(page, new Uint8Array(file), 'counts-saved.pdf');
  // Read back: plain Stamps whose group, number and symbol come from their Triya data.
  const stamps = async () =>
    (await objects(page, back))
      .filter((o) => o.type === STAMP)
      .map((o) => o.contents ?? '')
      .sort();
  await expect.poll(stamps).toEqual(['Door 1', 'Door 2', 'Door 3', 'Window 1', 'Window 2']);
  const w2 = (await objects(page, back)).find((o) => o.contents === 'Window 2')!;
  await cap(page, 'annotate', 'select', back, 0, w2.id);
  await expect(info(page).getByLabel('Group', { exact: true })).toHaveValue('Window');
  await expect(info(page).getByLabel('Symbol', { exact: true })).toHaveValue('diamond');
  await page.keyboard.press('Escape');
  // The next Door after reopening continues the file's numbers.
  await countTool(page);
  await toolProps(page).getByLabel('Group', { exact: true }).selectOption('Door');
  await expect(page.getByTestId('count-next')).toHaveText('Next click: Door 4');
  await shot(page, '06-read-back');
  expect(await axe(page)).toEqual([]);
});

test('Same-size count numbers: from the status bar, screen only, at several zooms; axe dark @a11y', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await darkTheme(page);
  const id = await open(page);
  await showProperties(page);
  await countTool(page);
  await rename(page, 'Socket');
  await toolProps(page).getByLabel('Size', { exact: true }).selectOption({ label: '8 pt' });
  await place(page, id, row(200, 4));
  await page.keyboard.press('Escape');
  await expect
    .poll(() => texts(page, id))
    .toEqual(['Socket 1', 'Socket 2', 'Socket 3', 'Socket 4']);

  const toggle = statusBar(page).getByRole('button', { name: 'Same-Size Count Numbers' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('count-number-label')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  const zoomField = statusBar(page).getByRole('textbox', { name: 'Zoom', exact: true });
  const zoomTo = async (pct: number) => {
    await zoomField.fill(String(pct));
    await zoomField.press('Enter');
    await cap(page, 'view', 'settle');
    await expect.poll(async () => Math.round((await zoomScale(page)) * 100)).toBe(pct);
  };
  const labelSize = async () =>
    page
      .getByTestId('count-number-label')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  // Zoomed out: every number gets a small label; at 25 % it is capped at 4× its saved size.
  await zoomTo(50);
  await expect(page.getByTestId('count-number-label')).toHaveCount(4);
  await expect(page.getByTestId('count-number-label').first()).toHaveText('1');
  expect(await labelSize()).toBeCloseTo(11, 0);
  await shot(page, '07-same-size-50-dark');
  await zoomTo(25);
  await expect(page.getByTestId('count-number-label')).toHaveCount(4);
  expect(await labelSize()).toBeCloseTo(10, 0);
  await shot(page, '08-same-size-25-dark');
  // Zoomed in: the saved number is already big enough, so nothing is added.
  await zoomTo(200);
  await expect(page.getByTestId('count-number-label')).toHaveCount(0);
  await shot(page, '09-same-size-200-dark');
  await zoomTo(50);
  await expect(page.getByTestId('count-number-label')).toHaveCount(4);
  expect(await axe(page)).toEqual([]);

  // Screen only: nothing of it in the file's annotations; off again from the status bar.
  expect((await counts(page, id)).every((o) => o.contents?.startsWith('Socket '))).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('count-number-label')).toHaveCount(0);
  // Kept on this device.
  expect(await page.evaluate(() => localStorage.getItem('pdftools.countNumbers'))).toBeNull();
});
