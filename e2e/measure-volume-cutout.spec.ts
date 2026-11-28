import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { measureManifest, measureSheetBytes } from './fixtures/measure-corpus/index.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-06 (D-73, D-74, ADR-035 Amendment 1 decision 5, plan M14 §6): Volume is
// an area times a remembered Depth set in the Properties pane before drawing
// and edited later; Cutout cuts holes into a selected Area or Volume (the
// value is net, the pane says "2 cutouts"); a hole must lie inside the outline
// and is edited point by point and deleted like the rest; Area and Volume have
// their own units and decimals (Automatic: m² and m³ on a metric scale). On the
// measure corpus floor plan (1:100 in mm): the slab is 81 m² gross, 70.75 m²
// net and 17.6875 m³ at 250 mm. Saved with Ctrl+S and read back.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- corpus points known to exist */

interface P {
  x: number;
  y: number;
}
interface Obj {
  id: string;
  type: number;
  contents?: string;
  vertices?: P[];
  measure?: {
    tool: string;
    holes?: P[][];
    depth?: { value: number; unit: string };
    volumeUnit?: string;
  };
}

const SHEET = '01_floor_plan_1-100_mm.pdf';
const SHOTS = '/mnt/project-files/M14-06';

const sheet = () => {
  const s = measureManifest().sheets.find((x) => x.file === SHEET);
  if (!s) throw new Error('floor plan missing');
  return s;
};
/** The page as shown (y down) from the manifest's user space (y up). */
const shown = (pts: readonly (readonly [number, number])[]): P[] =>
  pts.map(([x, y]) => ({ x, y: sheet().height - y }));
const slab = () => {
  const it = sheet().items.find((i) => i.id === 'slab-volume') as
    { points: [number, number][]; holes: [number, number][][] } | undefined;
  if (!it) throw new Error('slab missing');
  return { outer: shown(it.points), holes: it.holes.map((h) => shown(h)) };
};

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const one = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot);
const contentsOf = async (page: Page, id: string, annot: string) =>
  (await one(page, id, annot))?.contents ?? null;
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
const toast = (page: Page) => page.getByTestId('snapshot-toast');
const facts = (page: Page) => page.getByTestId('measure-facts');

// Screenshots for people to look at (owner's rule): at device scale 2.
test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/m14-06/${name}.png` });
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

async function at(page: Page, p: P) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / sheet().width;
  return { x: box.x + p.x * s, y: box.y + p.y * s };
}

async function clicks(page: Page, pts: readonly P[]) {
  for (const p of pts) {
    const s = await at(page, p);
    await page.mouse.move(s.x, s.y, { steps: 4 });
    await page.mouse.click(s.x, s.y);
  }
}

async function tool(page: Page, name: string) {
  const b = measureTab(page).getByRole('button', { name, exact: true });
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** Draws the slab with the tool, sets it on the corpus points exactly, and selects it. */
async function drawSlab(page: Page, id: string, name: 'Area' | 'Volume') {
  const before = (await objects(page, id)).map((o) => o.id);
  await tool(page, name);
  const { outer } = slab();
  await clicks(page, outer);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await objects(page, id)).some((o) => !before.includes(o.id) && !!o.contents))
    .toBe(true);
  const m = (await objects(page, id)).find((o) => !before.includes(o.id))!;
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'update', id, 0, m.id, { vertices: outer });
  await cap(page, 'annotate', 'select', id, 0, m.id);
  await expect(page.getByTestId('measure-point').first()).toBeVisible();
  return m.id;
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

test('Volume: Depth set before drawing, two cutouts with the tool, net 17.69 m³; edited later; saved and read back @smoke', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const bytes = measureSheetBytes(SHEET);
  const id = await open(page, bytes);
  await run(page, 'view.propertiesPane');

  // The Depth goes in the Properties pane before drawing (remembered on this device).
  await tool(page, 'Volume');
  await page.getByLabel('Depth unit', { exact: true }).selectOption({ label: 'Millimetres' });
  const depth = page.getByLabel('Depth', { exact: true });
  await depth.fill('250');
  await depth.press('Enter');
  await expect(page.getByText('Each new volume takes this depth.', { exact: false })).toBeVisible();
  await shot(page, '01-volume-tool-properties-light');
  const vol = await drawSlab(page, id, 'Volume');
  // 81 m² × 250 mm, before any cutout.
  await expect.poll(() => contentsOf(page, id, vol)).toBe('20.25 m³');
  await expect(facts(page)).toContainText('Area: 81.00 m²');
  await expect(facts(page)).toContainText('Depth: 250 mm');
  await expect(facts(page)).toContainText('To cut a hole, select the area');

  // Cutout: the selected volume; each hole clicked round is one cut, and the tool stays on.
  await tool(page, 'Cutout');
  await expect(page.getByText('Click each corner of the hole', { exact: false })).toBeVisible();
  const { holes } = slab();
  await clicks(page, holes[0]!);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await one(page, id, vol))?.measure?.holes?.length).toBe(1);
  const cut = (await one(page, id, vol))!.measure!.holes![0]!;
  cut.forEach((p, i) => {
    expect(p.x).toBeCloseTo(holes[0]![i]!.x, -0.5);
    expect(p.y).toBeCloseTo(holes[0]![i]!.y, -0.5);
  });
  await expect(
    measureTab(page).getByRole('button', { name: 'Cutout', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  // The second hole is shown dashed while it is clicked round.
  await clicks(page, holes[1]!.slice(0, 3));
  await shot(page, '02-cutout-drawing-light');
  await clicks(page, holes[1]!.slice(3));
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await one(page, id, vol))?.measure?.holes?.length).toBe(2);

  // A hole outside the outline is not cut, and a note says why.
  await clicks(page, [
    { x: 500, y: 150 },
    { x: 560, y: 150 },
    { x: 560, y: 200 },
  ]);
  await page.keyboard.press('Enter');
  await expect(toast(page)).toHaveText(
    'A cutout must lie inside the outline of its area. Nothing was cut.',
  );
  expect((await one(page, id, vol))?.measure?.holes).toHaveLength(2);

  // Esc leaves Cutout; the volume is selected again.
  await page.keyboard.press('Escape');
  await expect(
    measureTab(page).getByRole('button', { name: 'Cutout', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(facts(page)).toBeVisible();

  // On the corpus holes exactly: net 70.75 m² × 250 mm.
  const meta = (await one(page, id, vol))!.measure!;
  await cap(page, 'annotate', 'update', id, 0, vol, { measure: { ...meta, holes } });
  await expect.poll(() => contentsOf(page, id, vol)).toBe('17.69 m³');
  await expect(facts(page)).toContainText('Area: 70.75 m²');
  await expect(facts(page)).toContainText('Before cutouts: 81.00 m²');
  const cutouts = page.getByTestId('measure-cutouts');
  await expect(cutouts.getByRole('listitem')).toHaveText([
    /^Cutout 1: 2\.25 m²/,
    /^Cutout 2: 8\.00 m²/,
  ]);
  await expect(page.getByTestId('selected-measure-hole')).toHaveCount(2);
  await page.getByTestId('measure-cutouts').scrollIntoViewIfNeeded();
  await shot(page, '03-volume-with-cutouts-properties-light');
  expect(await axe(page)).toEqual([]);

  // Delete a cutout in the Properties pane: one undo step.
  await cutouts.getByRole('button', { name: 'Delete cutout 2' }).click();
  await expect.poll(() => contentsOf(page, id, vol)).toBe('19.69 m³');
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(() => contentsOf(page, id, vol)).toBe('17.69 m³');

  // The Depth edited later, and back.
  await cap(page, 'annotate', 'select', id, 0, vol);
  const depthNow = page.getByLabel('Depth', { exact: true });
  await depthNow.fill('200');
  await depthNow.press('Enter');
  await expect.poll(() => contentsOf(page, id, vol)).toBe('14.15 m³');
  await depthNow.fill('250');
  await depthNow.press('Enter');
  await expect.poll(() => contentsOf(page, id, vol)).toBe('17.69 m³');

  // Its own unit: cubic yards.
  await expect(page.getByLabel('Volume unit', { exact: true })).toHaveValue('auto');
  await page
    .getByLabel('Volume unit', { exact: true })
    .selectOption({ label: 'Cubic yards (cu yd)' });
  await expect.poll(() => contentsOf(page, id, vol)).toBe('23.13 cu yd');

  // The Measurements pane: the volume, its area and depth, and "2 cutouts".
  await page.locator('[data-rail="rail.measurements"] button').click();
  const row = page.getByTestId('measure-row').first();
  await expect(row).toContainText('23.13 cu yd');
  await expect(row.getByTestId('measure-row-volume')).toHaveText('Area 70.75 m² · Depth 250 mm');
  await expect(row.getByTestId('measure-row-cutouts')).toHaveText('2 cutouts');
  await shot(page, '04-measurements-pane-volume-light');
  expect(await axe(page)).toEqual([]);

  // Ctrl+S: one Polygon with its holes, depth and unit in the Triya data; read back.
  const { file, tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/IT\s*\/PolygonDimension/);
  expect(tail).toMatch(/\/Subj\s*\(Volume\)/);
  expect(tail).toMatch(/\/TriyaPDF/);
  expect(tail).toMatch(/\/Ho\s*\[/);
  expect(tail).toMatch(/\/Vu\s*\/yd3/);
  const back = await reopen(page, new Uint8Array(file), 'slab-saved.pdf');
  // Read back from the file's Triya data: the value, the depth, the unit and both holes.
  await expect
    .poll(async () => (await objects(page, back)).find((o) => o.contents === '23.13 cu yd'))
    .toBeTruthy();
  const read = (await objects(page, back)).find((o) => o.contents === '23.13 cu yd')!;
  await cap(page, 'annotate', 'select', back, 0, read.id);
  const pane = page.getByTestId('measure-facts');
  if (!(await pane.isVisible())) await run(page, 'view.propertiesPane');
  await expect(pane).toContainText('Area: 70.75 m²');
  await expect(pane).toContainText('Depth: 250 mm');
  await expect(page.getByTestId('measure-cutouts').getByRole('listitem')).toHaveText([
    /^Cutout 1: 2\.25 m²/,
    /^Cutout 2: 8\.00 m²/,
  ]);
  await expect(page.getByLabel('Volume unit', { exact: true })).toHaveValue('yd3');
  await expect(page.getByTestId('selected-measure-hole')).toHaveCount(2);
  await expect(page.getByTestId('measure-hole-point')).toHaveCount(8);
});

test('Area cutouts are edited point by point: drag, keyboard, a refused edit; outline edits keep them; axe dark @a11y', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await darkTheme(page);
  const id = await open(page);
  await run(page, 'view.propertiesPane');
  const area = await drawSlab(page, id, 'Area');
  await expect.poll(() => contentsOf(page, id, area)).toBe('81.00 m²');
  const { holes } = slab();
  const meta = (await one(page, id, area))!.measure!;
  await cap(page, 'annotate', 'update', id, 0, area, { measure: { ...meta, holes } });
  await expect.poll(() => contentsOf(page, id, area)).toBe('70.75 m²');
  await cap(page, 'annotate', 'select', id, 0, area);

  // Every hole point is a handle, named for its cutout.
  const points = page.getByTestId('measure-hole-point');
  await expect(points).toHaveCount(8);
  await expect(points.nth(4)).toHaveAccessibleName(
    'Cutout 2, point 1 of 4: drag it, or move it with the arrow keys; Delete removes it',
  );

  // A drag moves one point of the second hole (inside the outline): one undo step.
  const handle = await points.nth(4).boundingBox();
  if (!handle) throw new Error('no handle');
  // (Clear of the sheet's lines, so the drag doesn't snap back to the opening's corner.)
  const to = await at(page, { x: 250, y: 200 });
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await shot(page, '05-hole-point-drag-dark');
  await page.mouse.up();
  await expect.poll(() => contentsOf(page, id, area)).not.toBe('70.75 m²');
  const moved = (await one(page, id, area))!.measure!.holes![1]![0]!;
  expect(moved.x).toBeCloseTo(250, -0.5);
  expect(moved.y).toBeCloseTo(200, -0.5);
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(() => contentsOf(page, id, area)).toBe('70.75 m²');

  // A drag out of the outline is refused, with a note.
  const again = await points.nth(4).boundingBox();
  if (!again) throw new Error('no handle');
  const out = await at(page, { x: 600, y: 200 });
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(out.x, out.y, { steps: 8 });
  await page.mouse.up();
  await expect(toast(page)).toHaveText(
    'A cutout must lie inside the outline of its area. Nothing was cut.',
  );
  expect((await one(page, id, area))?.measure?.holes?.[1]?.[0]?.x).toBeCloseTo(holes[1]![0]!.x, 3);

  // From the keyboard: arrows move a hole point, Delete removes it (a hole keeps three).
  await points.nth(0).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => (await one(page, id, area))?.measure?.holes?.[0]?.[0]?.x)
    .toBeCloseTo(holes[0]![0]!.x + 10, 3);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await one(page, id, area))?.measure?.holes?.[0]?.length).toBe(3);
  await expect(points).toHaveCount(7);
  await cap(page, 'annotate', 'undo', id);
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(() => contentsOf(page, id, area)).toBe('70.75 m²');

  // Moving the whole area moves its holes with it: the value stays.
  const before = (await one(page, id, area))!;
  await cap(page, 'annotate', 'select', id, 0, area);
  const grab = await at(page, { x: 250, y: 120 });
  const drop = await at(page, { x: 250, y: 160 });
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await one(page, id, area))?.vertices?.[0]?.y)
    .not.toBeCloseTo(before.vertices![0]!.y, 3);
  const shifted = (await one(page, id, area))!;
  const dy = shifted.vertices![0]!.y - before.vertices![0]!.y;
  expect(shifted.measure?.holes?.[0]?.[0]?.y).toBeCloseTo(holes[0]![0]!.y + dy, 2);
  expect(shifted.contents).toBe('70.75 m²');

  await cap(page, 'annotate', 'select', id, 0, area);
  await expect(page.getByTestId('measure-cutouts')).toBeVisible();
  await page.getByTestId('measure-cutouts').scrollIntoViewIfNeeded();
  await shot(page, '06-area-with-cutouts-dark');
  expect(await axe(page)).toEqual([]);
});
