import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf, snapSheet } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-02 (D-78, D-77, ADR-035): a measurement in progress survives every view
// change (zoom by wheel, keys and the zoom field, scroll, Space and
// middle-button pan, Previous view); only Esc, another tool or a click on
// another page ends it (a page change says so). Shift locks the angle and
// still snaps. A page without a scale asks once. Self-made sheets only.

interface Obj {
  id: string;
  type: number;
  intent?: string;
  contents?: string;
  vertices?: { x: number; y: number }[];
  linePoints?: { start: { x: number; y: number }; end: { x: number; y: number } };
}
interface Gesture {
  page: number;
  tool: string;
  pts: { x: number; y: number }[];
}

const T = { LINE: 4, POLYGON: 7, POLYLINE: 8 };

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const gesture = async (page: Page) => (await cap(page, 'annotate', 'gesture')) as Gesture | null;

async function open(page: Page, bytes: Uint8Array, name = 'sheet.pdf'): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure' }).click();
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

/** Page point (EmbedPDF, top-left origin) → screen, on page `p`, at the zoom now. */
async function at(page: Page, x: number, y: number, p = 0, width = 600) {
  const box = await page.locator(`[data-page="${String(p)}"] .page-content`).boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / width;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function clickAt(page: Page, x: number, y: number, p = 0, width = 600) {
  const s = await at(page, x, y, p, width);
  await page.mouse.move(s.x, s.y, { steps: 4 });
  await page.mouse.click(s.x, s.y);
}

async function tool(page: Page, name: string) {
  const b = measureTab(page).getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

const zoomNow = async (page: Page) =>
  (await page.locator('[data-page="0"] .page-content').boundingBox())?.width ?? 0;

async function wheelZoom(page: Page, dy: number) {
  const before = await zoomNow(page);
  const c = await at(page, 300, 150);
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, dy);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomNow(page)).not.toBe(before);
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) < 1.5;

test('an Area survives wheel and key zoom, scroll, Space and middle-button pan and Previous View @smoke', async ({
  page,
}) => {
  const id = await open(page, simplePdf(3));
  await setScale(page);
  await tool(page, 'Area');
  const corners = [
    { x: 150, y: 60 },
    { x: 320, y: 60 },
    { x: 320, y: 200 },
    { x: 150, y: 200 },
  ];
  const corner = (i: number) => corners[i] ?? { x: 0, y: 0 };
  const click = (i: number) => clickAt(page, corner(i).x, corner(i).y, 0, 595);
  await click(0);
  await click(1);

  // Ctrl+wheel zoom: the plugin makes new handlers; the points stay.
  await wheelZoom(page, -300);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(2);
  await click(2);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(3);
  await expect(page.getByTestId('measure-live')).toHaveText(/ m²$/);

  // Keys: Ctrl+=.
  await page.getByTestId('document-view').focus();
  const z1 = await zoomNow(page);
  await page.keyboard.press('Control+Equal');
  await expect.poll(() => zoomNow(page)).not.toBe(z1);
  // Scroll down and back up with the wheel.
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, -300);
  // Space held: Hand; a drag pans.
  const mid = await at(page, 400, 300, 0, 595);
  await page.keyboard.down(' ');
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x - 40, mid.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  // The middle button pans in any tool, and places no point.
  const mid2 = await at(page, 400, 300, 0, 595);
  await page.mouse.move(mid2.x, mid2.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(mid2.x + 30, mid2.y - 20, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(3);
  // A jump to page 3 (page 1 may leave the layout), then Previous View back to it.
  const box = page.getByRole('contentinfo', { name: 'Status bar' });
  await box.getByRole('textbox', { name: 'Page number' }).fill('3');
  await box.getByRole('textbox', { name: 'Page number' }).press('Enter');
  await expect(box.getByRole('textbox', { name: 'Page number' })).toHaveValue('3');
  await box.getByRole('button', { name: 'Previous View' }).click();
  await expect(box.getByRole('textbox', { name: 'Page number' })).toHaveValue('1');
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(3);

  // The next click continues the same Area; a click on its first corner closes it.
  // The zoom field back to 100 % and the top of page 1: two more view changes.
  const field = box.getByRole('textbox', { name: 'Zoom', exact: true });
  await field.fill('100');
  await field.press('Enter');
  await cap(page, 'view', 'scrollTo', 0);
  await cap(page, 'view', 'settle');
  await click(3);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(4);
  await click(0);
  let m: Obj | undefined;
  await expect
    .poll(async () => {
      m = (await objects(page, id)).find((o) => o.type === T.POLYGON);
      return m?.vertices?.length ?? 0;
    })
    .toBe(4);
  m?.vertices?.forEach((v, i) => {
    expect(near(v, corner(i)), JSON.stringify(v)).toBe(true);
  });
  expect((await objects(page, id)).filter((o) => o.type === T.POLYGON)).toHaveLength(1);
  expect(await gesture(page)).toBeNull();
});

test('a Distance survives the zoom field and a scroll; Esc ends it, the tool stays', async ({
  page,
}) => {
  const id = await open(page, snapSheet(), 'snap.pdf');
  await setScale(page);
  await tool(page, 'Length');
  await clickAt(page, 150, 30);
  // The zoom field in the status bar.
  const field = page.getByRole('textbox', { name: 'Zoom', exact: true });
  await field.fill('150');
  await field.press('Enter');
  await expect.poll(() => zoomNow(page)).toBeGreaterThan(800);
  await clickAt(page, 320, 30);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(2);
  await clickAt(page, 240, 60);
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.type === T.LINE).length)
    .toBe(1);
  const line = (await objects(page, id)).find((o) => o.type === T.LINE);
  expect(near(line?.linePoints?.start ?? { x: 0, y: 0 }, { x: 150, y: 30 })).toBe(true);
  expect(near(line?.linePoints?.end ?? { x: 0, y: 0 }, { x: 320, y: 30 })).toBe(true);

  // Esc drops one in progress; the tool stays on.
  await clickAt(page, 150, 100);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => gesture(page)).toBeNull();
  await expect(
    measureTab(page).getByRole('button', { name: 'Length', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  // Another tool ends it too.
  await clickAt(page, 150, 100);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(1);
  await tool(page, 'Perimeter');
  await expect.poll(() => gesture(page)).toBeNull();
});

test('a click on another page ends the measurement with a note and starts there', async ({
  page,
}) => {
  const id = await open(page, simplePdf(2));
  await setScale(page);
  await tool(page, 'Perimeter');
  await clickAt(page, 100, 100, 0, 595);
  await clickAt(page, 200, 100, 0, 595);
  const box = page.getByRole('contentinfo', { name: 'Status bar' });
  await box.getByRole('textbox', { name: 'Page number' }).fill('2');
  await box.getByRole('textbox', { name: 'Page number' }).press('Enter');
  await expect(box.getByRole('textbox', { name: 'Page number' })).toHaveValue('2');
  // A view change: the measurement on page 1 is still there.
  await expect.poll(async () => (await gesture(page))?.page).toBe(0);
  await clickAt(page, 100, 100, 1, 595);
  await expect(page.getByTestId('snapshot-toast')).toHaveText(
    'The measurement on page 1 was ended: a measurement stays on one page.',
  );
  await expect.poll(async () => (await gesture(page))?.page).toBe(1);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(1);
  expect((await objects(page, id)).filter((o) => o.type === T.POLYLINE)).toHaveLength(0);
});

test('Shift locks to horizontal and still snaps where it meets a drawn line', async ({ page }) => {
  const id = await open(page, snapSheet(), 'snap.pdf');
  await setScale(page);
  await tool(page, 'Length');
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages[
          `${id}/0`
        ],
    )
    .toBe('ready');
  // A vertical line at user x = 300, y 300…350: page y 250…300. Start at page
  // (230, 275); with Shift, a pointer a little off the horizontal and a little
  // short of the line lands exactly on (300, 275).
  await clickAt(page, 230, 275);
  const target = await at(page, 297, 278);
  await page.keyboard.down('Shift');
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  await page.mouse.click(target.x, target.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(2);
  const g = await gesture(page);
  // Exactly on the line, exactly level with the first point.
  expect(g?.pts[1]?.x).toBeCloseTo(300, 1);
  expect(g?.pts[1]?.y).toBeCloseTo(g?.pts[0]?.y ?? 0, 3);
  await page.keyboard.press('Escape');
});

test('a page with no scale asks once: paper size, then no question on that page @a11y', async ({
  page,
}) => {
  const id = await open(page, simplePdf(1));
  await tool(page, 'Length');
  await clickAt(page, 100, 100, 0, 595);
  const prompt = page.getByRole('region', { name: 'No scale on this page' });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Page 1 has no scale yet');
  // The measurement keeps going while the question waits.
  await clickAt(page, 300, 100, 0, 595);
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(2);
  await prompt.getByRole('button', { name: 'Measure at paper size' }).click();
  await expect(prompt).toBeHidden();
  // 1:1 in mm: the live value is paper millimetres, no longer "uncalibrated".
  const p = await at(page, 300, 100, 0, 595);
  await page.mouse.move(p.x, p.y + 5);
  await expect(page.getByTestId('measure-live')).toHaveText(/^[\d,.]+ mm$/);
  await page.keyboard.press('Escape');
  await clickAt(page, 100, 300, 0, 595);
  await expect(prompt).toBeHidden();
  await page.keyboard.press('Escape');
  expect(await cap(page, 'view', 'dirty', id)).toBe(true);
});

test('closing the question keeps measuring without a scale and does not ask that page again', async ({
  page,
}) => {
  await open(page, simplePdf(1));
  await tool(page, 'Area');
  await clickAt(page, 100, 100, 0, 595);
  const prompt = page.getByRole('region', { name: 'No scale on this page' });
  await prompt.getByRole('button', { name: 'Keep measuring without a scale' }).click();
  await expect(prompt).toBeHidden();
  await clickAt(page, 300, 100, 0, 595);
  await page.mouse.move(...(Object.values(await at(page, 300, 250, 0, 595)) as [number, number]));
  await expect(page.getByTestId('measure-live')).toHaveText(/\(uncalibrated\)$/);
  await page.keyboard.press('Escape');
  await clickAt(page, 200, 200, 0, 595);
  await expect(prompt).toBeHidden();
  await page.keyboard.press('Escape');
});

test('Set scale from the question: the dialog is for that page and the measurement carries on', async ({
  page,
}) => {
  const id = await open(page, simplePdf(1));
  await tool(page, 'Length');
  await clickAt(page, 100, 100, 0, 595);
  const prompt = page.getByRole('region', { name: 'No scale on this page' });
  await prompt.getByRole('button', { name: 'Set scale' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill('100');
  await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await gesture(page))?.pts.length).toBe(1);
  // 150 mm on paper at 1:100.
  await clickAt(page, 100 + 150 * (72 / 25.4), 100, 0, 595);
  await clickAt(page, 250, 100, 0, 595);
  await expect
    .poll(async () => {
      const v = (await objects(page, id)).find((o) => o.type === T.LINE)?.contents ?? '';
      const n = /^([\d.]+) m$/.exec(v)?.[1];
      return n ? Math.abs(Number(n) - 15) < 0.1 : v;
    })
    .toBe(true);
});

test('crossing into a detail viewport turns the live value into a warning', async ({ page }) => {
  await open(page, simplePdf(1));
  await setScale(page);
  // The Measurements pane's Scales section (M14-08).
  await page.locator('[data-rail="rail.measurements"] button').click();
  await page.getByTestId('measure-scales').getByRole('button', { name: 'Add viewport' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scale viewport' });
  // User space 300…550 × 600…800: page points y 42…242 from the top (A4, 842 pt).
  await dialog.getByLabel('Left').fill('300');
  await dialog.getByLabel('Bottom').fill('600');
  await dialog.getByLabel('Right').fill('550');
  await dialog.getByLabel('Top').fill('800');
  await dialog.getByLabel('Paper').fill('1');
  await dialog.getByLabel('Real', { exact: true }).fill('5');
  await dialog.getByLabel('Units').selectOption({ label: 'Millimetres' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await tool(page, 'Length');
  await clickAt(page, 60, 150, 0, 595);
  const live = page.getByTestId('measure-live');
  const outside = await at(page, 250, 150, 0, 595);
  await page.mouse.move(outside.x, outside.y, { steps: 4 });
  await expect(live).toHaveText(/ m$/);
  await expect(live).not.toHaveAttribute('data-warning');
  const inside = await at(page, 400, 150, 0, 595);
  await page.mouse.move(inside.x, inside.y, { steps: 4 });
  await expect(live).toHaveText('Crosses Detail A');
  await expect(live).toHaveAttribute('data-warning', 'true');
  await page.keyboard.press('Escape');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the no-scale question passes axe (${theme})`, { tag: '@a11y' }, async ({ page }) => {
    if (theme === 'dark') await darkTheme(page);
    await open(page, simplePdf(1));
    await tool(page, 'Perimeter');
    await clickAt(page, 100, 100, 0, 595);
    const prompt = page.getByTestId('scale-prompt');
    await expect(prompt).toBeVisible();
    // Every answer is reachable by keyboard.
    for (const name of [
      'Set scale',
      'Calibrate',
      'Measure at paper size',
      'Keep measuring without a scale',
    ])
      await expect(prompt.getByRole('button', { name, exact: true })).toBeEnabled();
    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="scale-prompt"]')
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    await page.keyboard.press('Escape');
  });
}
