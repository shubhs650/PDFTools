import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { measureManifest, measureSheetBytes } from './fixtures/measure-corpus/index.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-05 (D-73, D-74, Q9, Q10): Angle by three clicks (the inside angle, its
// arc, degrees to 1 decimal, no scale needed); Radius and Diameter by the
// centre and a point on the edge, or by three points on the curve (the choice
// in the Properties pane, remembered), drawn as the arc or the whole circle
// with the line and the value. Each is one Stamp with its own appearance and
// Triya data, saved with Ctrl+S and read back. On the measure corpus pipe run
// (1:50 in mm), against its manifest. Self-made sheets only.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- corpus items known to exist */

interface Obj {
  id: string;
  type: number;
  contents?: string;
  subject?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
  measure?: { tool: string; pts?: { x: number; y: number }[]; shape?: string };
}

const STAMP = 13;
const SHEET = '02_pipe_run_1-50.pdf';
const SHOTS = '/mnt/project-files/M14-05';

const sheet = () => {
  const s = measureManifest().sheets.find((x) => x.file === SHEET);
  if (!s) throw new Error('pipe run missing');
  return s;
};
type XY = [number, number];
/** A manifest item's points as the page shows them (y down). */
const item = (id: string, which: 'points' | 'onCircle' = 'points'): XY[] => {
  const s = sheet();
  const it = s.items.find((i) => i.id === id) as
    { points: XY[]; onCircle?: XY[]; value: number } | undefined;
  if (!it) throw new Error(id);
  return (which === 'onCircle' ? (it.onCircle ?? []) : it.points).map(
    ([x, y]) => [x, s.height - y] as XY,
  );
};
const xy = ([x, y]: XY) => ({ x, y });

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const one = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot);
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

test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/m14-05/${name}.png` });
  }
}

async function open(page: Page, bytes: Uint8Array = measureSheetBytes(SHEET), name = SHEET) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  return id;
}

/** The page's box once it holds still (a pane that opens lays the page out again). */
async function pageBox(page: Page) {
  const content = page.locator('[data-page="0"] .page-content');
  let box = await content.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const now = await content.boundingBox();
    if (now && box?.x === now.x && box.y === now.y && box.width === now.width) return now;
    box = now;
  }
  return box;
}

async function at(page: Page, [x, y]: XY) {
  const box = await pageBox(page);
  if (!box) throw new Error('page not laid out');
  const s = box.width / sheet().width;
  return { x: box.x + x * s, y: box.y + y * s };
}

/** Clicks page points (snapping may move them onto the drawing; the values are set after). */
async function clicks(page: Page, pts: XY[]) {
  for (const p of pts) {
    const s = await at(page, p);
    await page.mouse.move(s.x, s.y, { steps: 4 });
    await page.mouse.click(s.x, s.y);
  }
}

async function tool(page: Page, name: string) {
  const b = measureTab(page).getByRole('button', { name, exact: true });
  // A tool stays on after it places a measurement; a click would turn it off.
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** The measurement placed after `before`, once it has its value. */
async function placed(page: Page, id: string, before: string[]) {
  await expect
    .poll(async () => (await objects(page, id)).some((o) => !before.includes(o.id) && !!o.contents))
    .toBe(true);
  const m = (await objects(page, id)).find((o) => !before.includes(o.id));
  if (!m) throw new Error('measurement missing');
  return m;
}

/** Sets a measurement on the corpus points (as a point drag does), then waits for its text. */
async function onPoints(page: Page, id: string, m: Obj, pts: XY[], text: RegExp) {
  await cap(page, 'annotate', 'update', id, 0, m.id, {
    measure: { ...m.measure, pts: pts.map(xy) },
  });
  await expect.poll(async () => (await one(page, id, m.id))?.contents).toMatch(text);
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

test('Angle by three clicks on the pipe run: 142.5° inside, 37.5° deflection, no scale needed @smoke', async ({
  page,
}) => {
  const id = await open(page);
  await tool(page, 'Angle');
  await expect(page.getByTestId('tool-hint')).toContainText('corner');
  // Drawn in a free corner of the sheet (a click on an earlier one selects it), live.
  const pts: XY[] = [
    [220, 650],
    [130, 650],
    [175, 590],
  ];
  await clicks(page, pts.slice(0, 2));
  const third = await at(page, pts[2]!);
  await page.mouse.move(third.x, third.y, { steps: 6 });
  await expect(page.getByTestId('measure-curve-live').locator('path')).toHaveCount(1);
  await expect(page.getByTestId('measure-live')).toHaveText(/^∠ \d+\.\d°$/);
  await shot(page, 'angle-live');
  await page.mouse.click(third.x, third.y);
  const a = await placed(page, id, []);
  expect(a.type).toBe(STAMP);
  expect(a.subject).toBe('Angle');
  expect(a.measure?.tool).toBe('angle');
  expect(a.measure?.pts).toHaveLength(3);
  await expect(page.getByTestId('measure-live')).toHaveCount(0);

  // On the manifest's points: the inside angle at the first bend.
  await onPoints(page, id, a, item('inside-angle-B'), /^∠ 142\.5°$/);
  await tool(page, 'Angle');
  await clicks(page, [
    [360, 650],
    [270, 650],
    [315, 590],
  ]);
  const d = await placed(page, id, [a.id]);
  await onPoints(page, id, d, item('deflection-B'), /^∠ 37\.5°$/);
  await page.keyboard.press('Escape');

  // The Properties pane: no scale needed.
  await run(page, 'view.propertiesPane');
  await cap(page, 'annotate', 'select', id, 0, a.id);
  await expect(page.getByTestId('measure-info')).toContainText('An angle needs no scale.');
  await expect(page.getByTestId('selected-measure-curve')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await shot(page, 'angle-selected');
});

test('Radius and Diameter: centre and edge, or three points (remembered); saved and read back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const bytes = measureSheetBytes(SHEET);
  const id = await open(page, bytes);
  await run(page, 'view.propertiesPane');

  // Radius, centre then edge (the default): the flange, a small full circle.
  await tool(page, 'Radius');
  await expect(page.getByTestId('tool-hint')).toContainText('centre');
  const props = page.getByTestId('tool-properties');
  await expect(props.getByLabel('Pick by')).toHaveValue('centre');
  // In the sheet's 1:50 viewport, clear of the drawing.
  await clicks(page, [[150, 650]]);
  const edge = await at(page, [180, 650]);
  await page.mouse.move(edge.x, edge.y, { steps: 6 });
  await expect(page.getByTestId('measure-curve-live').locator('path')).toHaveCount(1);
  await expect(page.getByTestId('measure-live')).toHaveText(/^R [\d,.]+ mm$/);
  await page.mouse.click(edge.x, edge.y);
  const flange = await placed(page, id, []);
  expect(flange.measure?.pts).toHaveLength(2);
  await onPoints(page, id, flange, item('flange-radius'), /^R 300(\.0+)? mm$/);

  // Diameter, centre then edge: the tank, Ø 3,000 mm (the whole circle).
  await tool(page, 'Diameter');
  await clicks(page, [
    [250, 650],
    [280, 650],
  ]);
  const tank = await placed(page, id, [flange.id]);
  await onPoints(page, id, tank, item('tank-diameter'), /^Ø 3,000(\.0+)? mm$/);

  // Radius by three points, picked in the Properties pane: the bend, an arc.
  await tool(page, 'Radius');
  await props.getByLabel('Pick by').selectOption({ label: 'Three points on the curve' });
  await expect(page.getByTestId('tool-hint')).toContainText('three points');
  await clicks(page, [
    [330, 660],
    [350, 645],
  ]);
  // The pointer is the third point: the arc and its value follow it.
  const p3 = await at(page, [370, 660]);
  await page.mouse.move(p3.x, p3.y, { steps: 6 });
  await expect(page.getByTestId('measure-curve-live').locator('path')).toHaveCount(1);
  await expect(page.getByTestId('measure-live')).toHaveText(/^R [\d,.]+ mm$/);
  await page.mouse.click(p3.x, p3.y);
  const bend = await placed(page, id, [flange.id, tank.id]);
  expect(bend.measure?.pts).toHaveLength(3);
  await onPoints(page, id, bend, item('bend-radius-B', 'onCircle'), /^R 1,200(\.0+)? mm$/);
  await page.keyboard.press('Escape');

  // Selected: drawn whole on the page; the Properties pane shows it as the arc, or the circle.
  await cap(page, 'annotate', 'select', id, 0, bend.id);
  const info = page.getByTestId('measure-info');
  await expect(info.getByLabel('Shown as')).toHaveValue('arc');
  await expect(page.getByTestId('selected-measure-curve')).toBeVisible();
  await shot(page, 'radius-three-points-selected');
  await info.getByLabel('Shown as').selectOption({ label: 'The whole circle' });
  await expect.poll(async () => (await one(page, id, bend.id))?.measure?.shape).toBe('circle');
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(async () => (await one(page, id, bend.id))?.measure?.shape).toBeUndefined();
  await page.keyboard.press('Escape');
  await shot(page, 'pipe-run-curves');

  // Saved with Ctrl+S's narrow tail: Stamps with their own appearance and Triya data.
  const { file, tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/Subtype\s*\/Stamp/);
  expect(tail).not.toMatch(/\/IT\s*\//);
  expect(tail).toMatch(/\/TriyaPDF/);
  expect(tail).toMatch(/\/Contents\s*\(R 1,200/);

  // Reopened (a new start of the app): the same values, points and method.
  const back = await open(page, file, 'saved.pdf');
  await expect
    .poll(async () =>
      (await objects(page, back))
        .filter((o) => o.type === STAMP)
        .map((o) => o.contents)
        .sort(),
    )
    .toEqual([
      expect.stringMatching(/^R 1,200/),
      expect.stringMatching(/^R 300/),
      expect.stringMatching(/^Ø 3,000/),
    ]);
  await tool(page, 'Radius');
  const pane = page.getByTestId('tool-properties');
  if (!(await pane.isVisible())) await run(page, 'view.propertiesPane');
  await expect(pane.getByLabel('Pick by')).toHaveValue('three');
  // The tool off again (Select).
  await measureTab(page).getByRole('button', { name: 'Radius', exact: true }).click();
  await expect(
    measureTab(page).getByRole('button', { name: 'Radius', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');

  // The Measurements pane lists them by tool, read back from the file, with no totals.
  await page.locator('[data-rail="rail.measurements"] button').click();
  const radii = page.getByTestId('measure-group-radius');
  await expect(radii).toContainText('Radius');
  await expect(radii.getByTestId('measure-row')).toHaveCount(2);
  await expect(radii).toContainText('1,200');
  await expect(radii).not.toContainText('Total');
  await expect(page.getByTestId('measure-group-diameter')).toContainText('3,000');
  await shot(page, 'measurements-pane-curves');

  // A point dragged on the read-back bend: a new value in one undo step.
  const bend2 = (await objects(page, back)).find((o) => o.contents?.startsWith('R 1,200'))!;
  await cap(page, 'annotate', 'select', back, 0, bend2.id);
  const handles = page.getByTestId('measure-point');
  await expect(handles).toHaveCount(3);
  const h = await handles.nth(1).boundingBox();
  if (!h) throw new Error('no handle');
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 12, h.y + h.height / 2 + 12, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await one(page, back, bend2.id))?.contents)
    .not.toBe(bend2.contents);
  await cap(page, 'annotate', 'undo', back);
  await expect.poll(async () => (await one(page, back, bend2.id))?.contents).toBe(bend2.contents);
});

test('dark theme: the three tools, their hints and Properties; axe dark', async ({ page }) => {
  await darkTheme(page);
  const id = await open(page);
  await run(page, 'view.propertiesPane');
  await tool(page, 'Diameter');
  await expect(page.getByTestId('tool-properties').getByLabel('Pick by')).toBeVisible();
  await clicks(page, [
    [250, 650],
    [280, 650],
  ]);
  const tank = await placed(page, id, []);
  await onPoints(page, id, tank, item('tank-diameter'), /^Ø 3,000(\.0+)? mm$/);
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'select', id, 0, tank.id);
  await expect(page.getByTestId('measure-info')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await shot(page, 'diameter-selected-dark');
});
