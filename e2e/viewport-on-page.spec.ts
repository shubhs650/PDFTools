import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-09 (D-77, ADR-035, plan M14 §9): scale viewports edited on the page.
// On the Measure tab with Select: a click on a border selects it, a drag moves
// it, its handles resize it, Delete removes it, a double-click opens its name
// and scale. Keyboard: the Scales section and the selected viewport's label
// and handles (arrow keys). The measurements using it follow (one undo step,
// a note). Other tabs: the borders take no clicks. The /VP entries after save
// and reload. Axe light and dark; screenshots.

interface Obj {
  id: string;
  type: number;
  contents?: string;
}

const LINE = 4;
const MM = 72 / 25.4;
const H = 842; // simplePdf is A4: user y → EmbedPDF y = H - y
const SHOTS = '/mnt/project-files/M14-09';
// Detail A: user space [300 400 550 700] → page points left 300, top 142, 250 × 300.
const DETAIL = { left: 300, top: H - 700, width: 250, height: 300 };

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const scales = (page: Page) => page.getByTestId('measure-scales');
const outline = (page: Page) => page.getByTestId('viewport-outline');
const frame = (page: Page) => page.getByTestId('viewport-frame');
const handle = (page: Page, h: string) =>
  page.locator(`[data-testid="viewport-handle"][data-handle="${h}"]`);
const note = (page: Page) => page.getByTestId('scale-note');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const contentsOf = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot)?.contents ?? null;
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/M14-09/${name}.png` });
  }
}

async function open(page: Page, bytes: Uint8Array): Promise<string> {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  return id;
}

/** The Measurements pane in the left rail (M14-08), with its Scales section. */
async function measurementsPane(page: Page) {
  if (await scales(page).isVisible()) return;
  await page.locator('[data-rail="rail.measurements"] button').click();
  await expect(scales(page)).toBeVisible();
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

/** Detail A at 1 : 5 over user space [300 400 550 700], from the Scales section. */
async function addDetail(page: Page) {
  await measurementsPane(page);
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
  await expect(outline(page)).toHaveCount(1);
}

/** Page points → screen. */
async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

/** The outline's rectangle in page points. */
async function rectOf(page: Page) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  const o = await outline(page).first().boundingBox();
  if (!box || !o) throw new Error('not laid out');
  const s = box.width / 595;
  return {
    left: (o.x - box.x) / s,
    top: (o.y - box.y) / s,
    width: o.width / s,
    height: o.height / s,
  };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** A Length drawn, then set to user-space points a → b. */
async function length(page: Page, id: string, a: [number, number], b: [number, number]) {
  await measureTab(page).getByRole('button', { name: 'Length', exact: true }).click();
  const before = new Set((await objects(page, id)).map((o) => o.id));
  const p = await at(page, 100, 150);
  const q = await at(page, 200, 150);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await page.mouse.up();
  // M13-10: a click on the second point places it with no offset.
  await page.mouse.click(q.x, q.y);
  await page.keyboard.press('Escape');
  let m: Obj | undefined;
  await expect
    .poll(async () => {
      m = (await objects(page, id)).find((o) => o.type === LINE && !before.has(o.id));
      return m?.contents ?? null;
    })
    .not.toBeNull();
  if (!m) throw new Error('no measurement');
  await cap(page, 'annotate', 'update', id, 0, m.id, {
    linePoints: { start: { x: a[0], y: H - a[1] }, end: { x: b[0], y: H - b[1] } },
  });
  await page.keyboard.press('Escape');
  return m.id;
}

/** A scaled sheet with Detail A and an 80 mm plate measured inside it (400.0 mm at 1 : 5). */
async function sheet(page: Page) {
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  await setScale(page);
  await addDetail(page);
  const plate = await length(page, id, [320, 450], [320 + 80 * MM, 450]);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('400.0 mm');
  return { id, plate, bytes };
}

test('by mouse: select, move, resize, double-click to edit, Delete; the plate follows; saved and read back', async ({
  page,
}) => {
  const { id, plate, bytes } = await sheet(page);
  await expect(frame(page)).toHaveCount(0);

  // A click inside the viewport is the page's, not the viewport's.
  const inside = await at(page, 420, 300);
  await page.mouse.click(inside.x, inside.y);
  await expect(frame(page)).toHaveCount(0);

  // A click on the top border selects it: its label is focused, eight handles show.
  const top = await at(page, 420, DETAIL.top);
  await page.mouse.click(top.x, top.y);
  await expect(frame(page)).toBeFocused();
  await expect(frame(page)).toHaveAccessibleName('Detail A 1 : 5 scale viewport');
  await expect(page.getByTestId('viewport-handle')).toHaveCount(8);
  await expect(scales(page).getByTestId('measure-viewport')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Drag the border down 300 pt: the plate is outside now and takes the page's 1 : 100.
  await drag(page, [420, DETAIL.top], [420, DETAIL.top + 300]);
  await expect.poll(async () => (await rectOf(page)).top).toBeCloseTo(DETAIL.top + 300, -1);
  expect((await rectOf(page)).width).toBeCloseTo(DETAIL.width, 0);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('8.00 m');
  await expect(note(page)).toHaveText('1 measurement updated to the new scale.');
  await expect(frame(page)).toBeVisible();
  await shot(page, '01-moved-note-light');

  // One undo step brings the viewport and the plate's value back.
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(async () => (await rectOf(page)).top).toBeCloseTo(DETAIL.top, -1);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('400.0 mm');

  // The right edge's handle widens it by 30 pt (an edge moves along its own axis only).
  await expect(frame(page)).toBeVisible();
  const right = DETAIL.left + DETAIL.width;
  const middle = DETAIL.top + DETAIL.height / 2;
  await drag(page, [right, middle], [right + 30, middle + 20]);
  await expect.poll(async () => (await rectOf(page)).width).toBeCloseTo(DETAIL.width + 30, -1);
  expect((await rectOf(page)).height).toBeCloseTo(DETAIL.height, 0);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('400.0 mm');

  // A double-click on the border opens its name and scale; it stays selected under the new name.
  const left = await at(page, DETAIL.left, 300);
  await page.mouse.dblclick(left.x, left.y);
  const dialog = page.getByRole('dialog', { name: 'Edit scale viewport' });
  await expect(dialog.getByLabel('Name')).toHaveValue('Detail A');
  await dialog.getByLabel('Name').fill('Detail B');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(outline(page)).toContainText('Detail B 1 : 5');
  await expect(frame(page)).toHaveAccessibleName('Detail B 1 : 5 scale viewport');

  // Delete removes it (one undo step); the plate takes the page scale.
  await frame(page).focus();
  await page.keyboard.press('Delete');
  await expect(outline(page)).toHaveCount(0);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('8.00 m');
  await cap(page, 'annotate', 'undo', id);
  await expect(outline(page)).toHaveCount(1);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('400.0 mm');

  // On another tab the border takes no clicks.
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await expect(page.getByTestId('viewport-edge')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  await expect(page.getByTestId('viewport-edge')).toHaveCount(4);

  // Saved: the page's /VP has Detail B with its new box, read back on reopening.
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  const tail = Buffer.from(s.tail, 'base64');
  const text = tail.toString('latin1');
  expect(text).toMatch(/\/Name\s*\(Detail B\)/);
  const boxes = [
    ...text.matchAll(/\/BBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g),
  ]
    .map((m) => m.slice(1, 5).map(Number))
    .filter(([x1]) => x1 !== undefined && Math.abs(x1 - 300) < 2);
  expect(boxes).toHaveLength(1);
  const [x1, y1, x2, y2] = boxes[0] ?? [];
  expect(x2).toBeCloseTo(580, -1);
  expect(y1).toBeCloseTo(400, -1);
  expect(y2).toBeCloseTo(700, -1);
  expect(x1).toBeCloseTo(300, -1);

  const id2 = await open(page, Buffer.concat([Buffer.from(bytes), tail]));
  await measurementsPane(page);
  await expect(scales(page)).toContainText('Detail B · 1 : 5');
  expect((await rectOf(page)).width).toBeCloseTo(DETAIL.width + 30, -1);
  await expect
    .poll(async () => (await objects(page, id2)).map((o) => o.contents))
    .toContain('400.0 mm');
});

test('by keyboard: the Scales section and the label move it, a handle resizes it, Delete removes it', async ({
  page,
}) => {
  const { id, plate } = await sheet(page);
  const item = scales(page).getByTestId('measure-viewport');
  await item.focus();
  // Shift+ArrowDown: 10 pt down; the viewport is picked and stays picked.
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await rectOf(page)).top).toBeCloseTo(DETAIL.top + 10, 0);
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await rectOf(page)).left).toBeCloseTo(DETAIL.left - 1, 0);
  await expect(item).toBeFocused();
  await expect.poll(() => contentsOf(page, id, plate)).toBe('400.0 mm');

  // On the page: the selected viewport's label takes the arrow keys too.
  await frame(page).focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await rectOf(page)).top).toBeCloseTo(DETAIL.top, 0);
  // The right edge's handle: Shift+ArrowRight widens it by 10 pt; ArrowDown does nothing.
  const e = handle(page, 'e');
  await expect(e).toHaveAccessibleName('Resize Detail A from its right edge');
  await e.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await rectOf(page)).width).toBeCloseTo(DETAIL.width + 10, 0);
  await page.keyboard.press('ArrowDown');
  expect((await rectOf(page)).height).toBeCloseTo(DETAIL.height, 0);

  // Enter on the label opens the dialog; Escape closes it.
  await frame(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Edit scale viewport' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit scale viewport' })).toBeHidden();

  // Delete in the Scales section removes it; undo brings it back.
  await item.focus();
  await page.keyboard.press('Delete');
  await expect(outline(page)).toHaveCount(0);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('8.00 m');
  await cap(page, 'annotate', 'undo', id);
  await expect(outline(page)).toHaveCount(1);
});

for (const theme of ['light', 'dark'] as const)
  test(`selected viewport with its handles, ${theme} @a11y`, async ({ page }) => {
    if (theme === 'dark') await darkTheme(page);
    await sheet(page);
    // 100 %: the whole viewport and the plate in view.
    const field = page.getByRole('textbox', { name: 'Zoom', exact: true });
    await field.fill('100');
    await field.press('Enter');
    await expect
      .poll(
        async () => (await page.locator('[data-page="0"] .page-content').boundingBox())?.width ?? 0,
      )
      .toBeCloseTo(595, -1);
    await page.locator('[data-page="0"]').scrollIntoViewIfNeeded();
    const top = await at(page, 420, DETAIL.top);
    await page.mouse.click(top.x, top.y);
    await expect(frame(page)).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await shot(page, `02-selected-${theme}`);
    await handle(page, 'ne').focus();
    await shot(page, `03-handle-focus-${theme}`);
    // Mid-drag: the outline follows the pointer.
    const right = DETAIL.left + DETAIL.width;
    const a = await at(page, right, DETAIL.top);
    const b = await at(page, right + 25, DETAIL.top - 40);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await expect.poll(async () => (await rectOf(page)).top).toBeCloseTo(DETAIL.top - 40, -1);
    await shot(page, `04-resizing-${theme}`);
    await page.mouse.up();
    expect(await axe(page)).toEqual([]);
  });
