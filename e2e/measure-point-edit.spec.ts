import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { simplePdf, snapSheet } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-04 (D-78, D-77, Q24, Q23, Q36): a selected measurement is edited point by
// point. Its points (and a Length's dimension line) are handles: a drag moves
// one with the value live, snapping and Shift as when drawing and the loupe
// following; the release is one undo step. A right-click on an edge adds a
// point, on a point removes it. From the keyboard the handles are buttons
// (arrow keys move, Delete removes). A scale change updates the measurements
// that use it in one undo step, with a note and Undo. Self-made sheets only.

interface Obj {
  id: string;
  type: number;
  contents?: string;
  measure?: { tool: string };
  linePoints?: { start: { x: number; y: number }; end: { x: number; y: number } };
  vertices?: { x: number; y: number }[];
  leader?: { ll: number } | null;
}

const SHOTS = '/mnt/project-files/M14-04';

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const one = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot);
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

// Screenshots for people to look at (owner's rule): at device scale 2.
test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/m14-04/${name}.png` });
  }
}

async function open(page: Page, bytes: Uint8Array = simplePdf(1)) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  return id;
}

async function setScale(page: Page, real: string) {
  await measureTab(page).getByRole('button', { name: 'Set Scale' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill(real);
  await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
  await dialog.getByLabel('Decimal places').selectOption({ value: '2' });
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
}

async function at(page: Page, x: number, y: number, width = 595) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / width;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function clicks(page: Page, pts: [number, number][], width = 595) {
  for (const p of pts) {
    const s = await at(page, p[0], p[1], width);
    await page.mouse.move(s.x, s.y, { steps: 4 });
    await page.mouse.click(s.x, s.y);
  }
}

async function tool(page: Page, name: string) {
  const b = measureTab(page).getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** Draws a measurement by clicks, places it with Enter, and selects it in Select. */
async function draw(page: Page, id: string, name: string, pts: [number, number][], width = 595) {
  const before = (await objects(page, id)).map((o) => o.id);
  await tool(page, name);
  await clicks(page, pts, width);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await objects(page, id)).some((o) => !before.includes(o.id) && !!o.contents))
    .toBe(true);
  const m = (await objects(page, id)).find((o) => !before.includes(o.id));
  if (!m) throw new Error('measurement missing');
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'select', id, 0, m.id);
  await expect(page.getByTestId('measure-point').first()).toBeVisible();
  return m;
}

/** Drags from one page point to another with the mouse (CSS px steps between). */
async function dragFrom(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

test('drag a point of an Area: the value follows live, one undo step, redo @smoke', async ({
  page,
}) => {
  const id = await open(page);
  await setScale(page, '100');
  const m = await draw(page, id, 'Area', [
    [100, 150],
    [300, 150],
    [300, 250],
    [100, 250],
  ]);
  const points = page.getByTestId('measure-point');
  await expect(points).toHaveCount(4);
  // The plugin's own vertex handles are not shown on a measurement.
  await expect(page.locator('[data-epdf-vertex]')).toHaveCount(0);
  await expect(points.nth(2)).toHaveAccessibleName(
    'Point 3 of 4: drag it, or move it with the arrow keys; Delete removes it',
  );
  const before = (await one(page, id, m.id))?.contents;

  const handle = await points.nth(2).boundingBox();
  if (!handle) throw new Error('no handle');
  const to = await at(page, 360, 320);
  await dragFrom(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, to);
  // While dragging: the preview's caption shows the new value; nothing is changed yet.
  const live = page.getByTestId('measure-edit-value');
  await expect(live).toBeVisible();
  await expect(live).not.toHaveText(before ?? '');
  expect((await one(page, id, m.id))?.contents).toBe(before);
  await shot(page, '01-area-point-drag-light');
  await page.mouse.up();
  await expect(live).toBeHidden();
  await expect.poll(async () => (await one(page, id, m.id))?.contents).not.toBe(before);
  const after = await one(page, id, m.id);
  expect(after?.vertices?.[2]?.x).toBeCloseTo(360, -1);
  expect(after?.vertices?.[2]?.y).toBeCloseTo(320, -1);
  expect(after?.vertices).toHaveLength(4);

  // One undo takes the point and the value back; redo brings both again.
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(async () => (await one(page, id, m.id))?.contents).toBe(before);
  expect((await one(page, id, m.id))?.vertices?.[2]?.x).toBeCloseTo(300, -1);
  await cap(page, 'annotate', 'redo', id);
  await expect.poll(async () => (await one(page, id, m.id))?.contents).toBe(after?.contents);
});

test('right-click on an edge adds a point, on a point removes it; keyboard moves and removes @a11y', async ({
  page,
}) => {
  const id = await open(page);
  const m = await draw(page, id, 'Polylength', [
    [100, 150],
    [300, 150],
    [300, 300],
  ]);
  const points = page.getByTestId('measure-point');
  await expect(points).toHaveCount(3);
  // A right-click on the first edge adds a point there (no menu opens).
  const edge = await at(page, 200, 150);
  await page.mouse.click(edge.x, edge.y, { button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(async () => (await one(page, id, m.id))?.vertices?.length).toBe(4);
  expect((await one(page, id, m.id))?.vertices?.[1]?.x).toBeCloseTo(200, -1);
  await expect(points).toHaveCount(4);
  await shot(page, '02-point-added-light');
  // One undo removes it again; redo puts it back.
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(async () => (await one(page, id, m.id))?.vertices?.length).toBe(3);
  await cap(page, 'annotate', 'redo', id);
  await expect.poll(async () => (await one(page, id, m.id))?.vertices?.length).toBe(4);

  // A right-click on a point removes it.
  const p = await at(page, 300, 300);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect.poll(async () => (await one(page, id, m.id))?.vertices?.length).toBe(3);
  expect((await one(page, id, m.id))?.vertices?.[2]?.y).toBeCloseTo(150, -1);

  // Keyboard: Tab-reachable buttons; Shift+arrow moves a point 10 pt, Delete removes it.
  const first = (await one(page, id, m.id))?.vertices?.[0] ?? { x: 0, y: 0 };
  await points.nth(0).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(async () => (await one(page, id, m.id))?.vertices?.[0]?.y)
    .toBeCloseTo(first.y + 10, 3);
  await expect(points.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await one(page, id, m.id))?.vertices?.[0]?.x)
    .toBeCloseTo(first.x + 1, 3);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await one(page, id, m.id))?.vertices?.length).toBe(2);
  // The measurement itself stays: Delete removed a point only, and two is the fewest.
  await expect(points).toHaveCount(2);
  await expect(points.nth(0)).toHaveAccessibleName(
    'Point 1 of 2: drag it, or move it with the arrow keys',
  );
  await points.nth(0).focus();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  expect((await one(page, id, m.id))?.vertices).toHaveLength(2);
  expect(await axe(page)).toEqual([]);
});

test('a Length: drag its end with Shift (level), its dimension line out and back; saved without /LL', async ({
  page,
}) => {
  const id = await open(page);
  await setScale(page, '100');
  const m = await draw(page, id, 'Length', [
    [100, 200],
    [300, 200],
  ]);
  const before = (await one(page, id, m.id))?.contents;
  const grip = page.getByTestId('measure-line-grip');
  await expect(grip).toHaveAccessibleName(
    'Dimension line: drag it, or move it with the arrow keys',
  );

  // The end point with Shift: locked level with the other end.
  const end = await page.getByTestId('measure-point').nth(1).boundingBox();
  if (!end) throw new Error('no handle');
  await page.keyboard.down('Shift');
  await dragFrom(
    page,
    { x: end.x + end.width / 2, y: end.y + end.height / 2 },
    await at(page, 400, 214),
  );
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await one(page, id, m.id))?.contents).not.toBe(before);
  const moved = await one(page, id, m.id);
  expect(moved?.linePoints?.end.x).toBeCloseTo(400, -1);
  expect(moved?.linePoints?.end.y).toBeCloseTo(moved?.linePoints?.start.y ?? 0, 3);

  // The dimension line dragged 40 pt down the page: leader lines of 40 pt.
  const g = await grip.boundingBox();
  if (!g) throw new Error('no grip');
  await dragFrom(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 }, await at(page, 250, 240));
  await shot(page, '03-length-dimension-line-drag-light');
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await one(page, id, m.id))?.leader?.ll ?? 0))
    .toBeGreaterThan(39);
  const ll = (await one(page, id, m.id))?.leader?.ll ?? 0;
  // The arrow keys move it across the line (1 pt).
  await grip.focus();
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => Math.abs((await one(page, id, m.id))?.leader?.ll ?? 0))
    .toBeCloseTo(Math.abs(ll) + 1, 1);
  // The value is the measured points', not the dimension line's.
  expect((await one(page, id, m.id))?.contents).toBe(moved?.contents);

  // Back onto the points: no leader lines, and none in the saved file.
  const g2 = await grip.boundingBox();
  if (!g2) throw new Error('no grip');
  await dragFrom(
    page,
    { x: g2.x + g2.width / 2, y: g2.y + g2.height / 2 },
    await at(page, 250, 200),
  );
  await page.mouse.up();
  await expect.poll(async () => (await one(page, id, m.id))?.leader ?? null).toBeNull();
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  const tail = Buffer.from(s.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/IT\s*\/LineDimension/);
  expect(tail).not.toMatch(/\/LL\s/);
  expect(tail).not.toMatch(/\/LLE\s/);
});

test('a dragged point snaps to the drawing and the loupe follows it', async ({ page }) => {
  const id = await open(page, snapSheet());
  await setScale(page, '100');
  const m = await draw(
    page,
    id,
    'Length',
    [
      [150, 60],
      [300, 60],
    ],
    600,
  );
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages[
          `${id}/0`
        ],
    )
    .toBe('ready');
  // The rectangle's corner at user (500, 450): page (500, 150). Dragged to just beside it.
  const end = await page.getByTestId('measure-point').nth(1).boundingBox();
  if (!end) throw new Error('no handle');
  const near = await at(page, 497, 153, 600);
  await dragFrom(page, { x: end.x + end.width / 2, y: end.y + end.height / 2 }, near);
  await page.mouse.move(near.x + 1, near.y, { steps: 2 });
  await page.mouse.move(near.x, near.y, { steps: 2 });
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  await expect(page.getByTestId('measure-loupe')).toBeVisible();
  await shot(page, '04-point-snaps-loupe-light');
  await page.mouse.up();
  await expect(page.getByTestId('measure-loupe')).toBeHidden();
  await expect
    .poll(async () => (await one(page, id, m.id))?.linePoints?.end.x ?? 0)
    .toBeCloseTo(500, 1);
  expect((await one(page, id, m.id))?.linePoints?.end.y).toBeCloseTo(150, 1);
});

test('a new scale updates the measurements in one undo step, with a note and Undo; axe dark', async ({
  page,
}) => {
  const id = await open(page);
  await setScale(page, '100');
  const a = await draw(page, id, 'Length', [
    [100, 150],
    [300, 150],
  ]);
  const b = await draw(page, id, 'Length', [
    [100, 300],
    [200, 300],
  ]);
  const va = (await one(page, id, a.id))?.contents;
  const vb = (await one(page, id, b.id))?.contents;
  await page.keyboard.press('Escape');
  await setScale(page, '50');
  const note = page.getByRole('region', { name: 'Measurements updated' });
  await expect(note).toBeVisible();
  await expect(page.getByTestId('scale-note')).toHaveText(
    '2 measurements updated to the new scale.',
  );
  await expect.poll(async () => (await one(page, id, a.id))?.contents).not.toBe(va);
  await expect.poll(async () => (await one(page, id, b.id))?.contents).not.toBe(vb);
  await shot(page, '05-scale-note-light');
  await darkTheme(page);
  await shot(page, '06-scale-note-dark');
  expect(await axe(page)).toEqual([]);

  // Undo in the note: the scale and both values go back together.
  await note.getByRole('button', { name: 'Undo' }).click();
  await expect(note).toBeHidden();
  await expect.poll(async () => (await one(page, id, a.id))?.contents).toBe(va);
  await expect.poll(async () => (await one(page, id, b.id))?.contents).toBe(vb);
  // Redo brings the new scale back with its values, without a note.
  await cap(page, 'annotate', 'redo', id);
  await expect.poll(async () => (await one(page, id, a.id))?.contents).not.toBe(va);
  await expect(note).toBeHidden();
  // Ctrl+Z (the same history) undoes the scale too.
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(async () => (await one(page, id, a.id))?.contents).toBe(va);
});

test('handles in dark theme, selected Area with its points @a11y', async ({ page }) => {
  await open(page);
  await darkTheme(page);
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await draw(page, id, 'Area', [
    [100, 150],
    [300, 150],
    [250, 300],
  ]);
  await page.getByTestId('measure-point').nth(1).focus();
  await shot(page, '07-area-points-dark');
  expect(await axe(page)).toEqual([]);
});
