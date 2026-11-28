// Measuring scenes for Help's pictures (M14-11) and the owner's hand-check file:
// the measure corpus sheets (self-made, rule 13; M14-01) with measurements
// placed by the real tools. Each measurement is drawn by clicks in a free part
// of the sheet (a click inside an earlier one would select it), then set on the
// corpus points as a point drag does, so the values are the manifest's.
import type { Page } from '@playwright/test';
import { measureManifest, measureSheetBytes } from '../fixtures/measure-corpus/index.ts';
import { cap } from '../support/app.ts';
import { expect } from '../support/fixtures.ts';
import { at, type Doc } from './scenes.ts';

export type XY = [number, number];

export interface MeasureObj {
  id: string;
  type: number;
  contents?: string;
  vertices?: { x: number; y: number }[];
  measure?: Record<string, unknown> & { tool: string };
}

function sheetOf(file: string) {
  const s = measureManifest().sheets.find((x) => x.file === file);
  if (!s) throw new Error(`${file} missing from the measure manifest`);
  return s;
}

function corpusDoc(file: string): Doc {
  return { name: file, bytes: measureSheetBytes(file), width: sheetOf(file).width };
}

export const FLOOR = corpusDoc('01_floor_plan_1-100_mm.pdf');
export const PIPES = corpusDoc('02_pipe_run_1-50.pdf');
export const SCALES = corpusDoc('03_three_scales_1-50_1-5_1-10.pdf');

type Which = 'points' | 'onCircle' | 'holes';

/** A manifest item's points as the page shows them (page points, y down). */
export function item(doc: Doc, id: string, which: Which = 'points'): XY[] {
  const s = sheetOf(doc.name);
  const it = s.items.find((i) => i.id === id) as
    { points: XY[]; onCircle?: XY[]; holes?: XY[][] } | undefined;
  if (!it) throw new Error(`${doc.name}: no item ${id}`);
  const pts = which === 'onCircle' ? (it.onCircle ?? []) : it.points;
  return pts.map(([x, y]) => [x, s.height - y]);
}

/** The holes of a cutout or volume item, as the page shows them. */
export function holes(doc: Doc, id: string): XY[][] {
  const s = sheetOf(doc.name);
  const it = s.items.find((i) => i.id === id) as { holes?: XY[][] } | undefined;
  return (it?.holes ?? []).map((h) => h.map(([x, y]): XY => [x, s.height - y]));
}

const xy = ([x, y]: XY) => ({ x, y });

export const measureBar = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });

export async function measureTool(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  const b = measureBar(page).getByRole('button', { name, exact: true });
  // A tool stays on after it places a measurement; a click would turn it off.
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

export const objects = async (page: Page, id: string): Promise<MeasureObj[]> =>
  ((await cap(page, 'annotate', 'objects', id)) as MeasureObj[] | null) ?? [];

/** The page's box once it holds still (a pane that opens lays the page out again). */
export async function steadyPage(page: Page, pageIndex = 0): Promise<void> {
  const content = page.locator(`[data-page="${String(pageIndex)}"] .page-content`);
  let box = await content.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const now = await content.boundingBox();
    if (now && box?.x === now.x && box.y === now.y && box.width === now.width) return;
    box = now;
  }
}

/** Clicks page points (snapping may move them; the corpus points are set after). */
export async function clickPoints(page: Page, doc: Doc, pts: XY[], pageIndex = 0): Promise<void> {
  for (const [x, y] of pts) {
    const s = await at(page, doc, x, y, pageIndex);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await page.mouse.click(s.x, s.y);
  }
}

/** The measurement placed since `before`, once it has its value. */
export async function newest(page: Page, id: string, before: string[]): Promise<MeasureObj> {
  await expect
    .poll(async () => (await objects(page, id)).some((o) => !before.includes(o.id) && !!o.contents))
    .toBe(true);
  const m = (await objects(page, id)).find((o) => !before.includes(o.id) && !!o.contents);
  if (!m) throw new Error('measurement missing');
  return m;
}

/** `pts` scaled into a free box of the sheet, for the clicks. */
function inset(pts: XY[], box: [number, number, number, number]): XY[] {
  const [bx, by, bw, bh] = box;
  const x0 = Math.min(...pts.map((p) => p[0]));
  const y0 = Math.min(...pts.map((p) => p[1]));
  const w = Math.max(...pts.map((p) => p[0])) - x0 || 1;
  const h = Math.max(...pts.map((p) => p[1])) - y0 || 1;
  const k = Math.min(bw / w, bh / h);
  return pts.map(([x, y]) => [bx + (x - x0) * k, by + (y - y0) * k]);
}

export interface PlaceOptions {
  pageIndex?: number;
  /** A free box of the sheet for the clicks: x, y, width, height in page points. */
  free?: [number, number, number, number];
  /** A Length's dimension line, this far above its points (page points). */
  offset?: number;
  /** The text the measurement shows once on its points. */
  text?: RegExp;
}

/**
 * Places one measurement with the tool named `tool` (the Measure tab's button) on the
 * corpus points `pts`. Line tools take `linePoints`, path and area tools `vertices`,
 * Angle, Radius and Diameter `measure.pts`.
 */
export async function placeMeasure(
  page: Page,
  doc: Doc,
  id: string,
  tool: string,
  pts: XY[],
  opts: PlaceOptions = {},
): Promise<MeasureObj> {
  const pageIndex = opts.pageIndex ?? 0;
  const before = (await objects(page, id)).map((o) => o.id);
  await measureTool(page, tool);
  const clicks = inset(pts, opts.free ?? [920, 640, 180, 120]);
  const curve = ['Angle', 'Radius', 'Diameter'].includes(tool);
  if (tool === 'Length') {
    const [a, b] = clicks as [XY, XY];
    if (opts.offset) {
      await clickPoints(page, doc, [a, b, [(a[0] + b[0]) / 2, a[1] - opts.offset]], pageIndex);
    } else {
      await clickPoints(page, doc, [a, b], pageIndex);
      await page.keyboard.press('Enter');
    }
  } else if (curve) {
    await clickPoints(page, doc, clicks, pageIndex);
  } else {
    await clickPoints(page, doc, clicks, pageIndex);
    await page.keyboard.press('Enter');
  }
  const m = await newest(page, id, before);
  const [first, second] = pts;
  if (!first || !second) throw new Error('a measurement needs two points or more');
  let patch: Record<string, unknown>;
  if (tool === 'Length') patch = { linePoints: { start: xy(first), end: xy(second) } };
  else if (curve) patch = { measure: { ...m.measure, pts: pts.map(xy) } };
  else if (tool === 'Perimeter') patch = { vertices: [...pts, first].map(xy) };
  else patch = { vertices: pts.map(xy) };
  await cap(page, 'annotate', 'update', id, pageIndex, m.id, patch);
  if (opts.text) {
    await expect
      .poll(async () => (await objects(page, id)).find((o) => o.id === m.id)?.contents)
      .toMatch(opts.text);
  }
  return m;
}

/** Sets fields of a measurement's `measure` (a label, the caption's place, the depth…). */
export async function setMeasure(
  page: Page,
  id: string,
  annot: string,
  fields: Record<string, unknown>,
  pageIndex = 0,
): Promise<void> {
  const m = (await objects(page, id)).find((o) => o.id === annot);
  await cap(page, 'annotate', 'update', id, pageIndex, annot, {
    measure: { ...m?.measure, ...fields },
  });
}

/** Opens the Measurements pane from the left rail. */
export async function openMeasurementsPane(page: Page) {
  const pane = page.getByTestId('measurements-pane');
  if (!(await pane.isVisible()))
    await page.locator('[data-rail="rail.measurements"] button').click();
  await expect(pane).toBeVisible();
  return pane;
}

/** The Count tool with a "Door" group of squares, its seven doors counted on the plan. */
export async function countDoors(page: Page, id: string) {
  await measureTool(page, 'Count');
  const box = page.getByTestId('tool-properties');
  await expect(box.getByRole('heading', { name: 'Count group' })).toBeVisible();
  const name = box.getByLabel('Name', { exact: true });
  await name.fill('Door');
  await name.press('Tab');
  await expect(box.getByLabel('Group', { exact: true })).toHaveValue('Door');
  await box.getByLabel('Symbol', { exact: true }).selectOption({ label: 'Square' });
  const doors = item(FLOOR, 'doors');
  for (const [i, p] of doors.entries()) {
    await clickPoints(page, FLOOR, [p]);
    await expect
      .poll(async () => (await objects(page, id)).filter((o) => o.measure?.tool === 'count').length)
      .toBe(i + 1);
  }
  return box;
}
