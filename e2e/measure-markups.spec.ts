import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { v110MeasurementsPdf } from './fixtures/measure-v110.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-03 (D-73, D-74, ADR-035 Amendment 1): each measuring tool makes one
// markup with its value drawn in its own appearance. Length, Polylength,
// Perimeter and Area by clicks; Label, caption place, fill and caption drag in
// the Properties pane and on the page; Home's Measure split button; the bar
// that updates measurements saved by 1.1.0 (one undo step); axe light and dark.

interface Obj {
  id: string;
  type: number;
  intent?: string;
  contents?: string;
  subject?: string;
  color?: string;
  inReplyToId?: string;
  vertices?: { x: number; y: number }[];
  measure?: {
    tool: string;
    cap?: string;
    label?: string;
    fill?: string;
    capOffset?: { x: number; y: number };
  };
}

const T = { FREETEXT: 3, LINE: 4, POLYGON: 7, POLYLINE: 8 };
const SHOTS = '/mnt/project-files/m14-03';

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

// Screenshots for people to look at (owner's rule): at device scale 2.
test.use({ deviceScaleFactor: 2 });

async function shot(page: Page, name: string) {
  // The appearance after the last edit is drawn by the Render worker.
  await page.waitForTimeout(600);
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } catch {
    await page.screenshot({ path: `test-results/m14-03/${name}.png` });
  }
}

async function open(page: Page, bytes: Uint8Array = simplePdf(1), tab = 'Measure') {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: tab, exact: true }).click();
  return id;
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
    await page.mouse.move(s.x, s.y, { steps: 4 });
    await page.mouse.click(s.x, s.y);
  }
}

async function tool(page: Page, name: string) {
  const b = measureTab(page).getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** The measurement of `type` made in this session, once its value is in. */
async function made(page: Page, id: string, type: number, n = 1) {
  const find = (all: Obj[]) => all.filter((o) => o.type === type && !!o.measure && !!o.contents);
  await expect.poll(async () => find(await objects(page, id)).length).toBe(n);
  const list = find(await objects(page, id));
  const m = list[n - 1];
  if (!m) throw new Error('measurement missing');
  return m;
}

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

test('the four measuring tools each make one markup with its value in it @smoke', async ({
  page,
}) => {
  const id = await open(page);
  const bar = measureTab(page);
  // The Length group (Length, Polylength, Perimeter) and the Area group (D-73).
  await expect(page.getByRole('group', { name: 'Length' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Area' })).toBeVisible();
  for (const name of ['Length', 'Polylength', 'Perimeter', 'Area'])
    await expect(bar.getByRole('button', { name, exact: true }), name).toBeVisible();

  await tool(page, 'Length');
  await clicks(page, [
    [80, 150],
    [280, 150],
  ]);
  await page.keyboard.press('Enter');
  const len = await made(page, id, T.LINE);
  expect(len.measure).toEqual({ tool: 'length', cap: 'top' });
  expect(len.subject).toBe('Length');

  // Polylength stays open; a double-click finishes it.
  await tool(page, 'Polylength');
  await clicks(page, [
    [80, 260],
    [180, 320],
  ]);
  const end = await at(page, 280, 260);
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.dblclick(end.x, end.y);
  const poly = await made(page, id, T.POLYLINE);
  expect(poly.measure?.tool).toBe('polylength');
  expect(poly.subject).toBe('Polylength');
  expect(poly.vertices).toHaveLength(3);

  // Perimeter always closes: its first vertex repeats at the end.
  await tool(page, 'Perimeter');
  await clicks(page, [
    [330, 260],
    [480, 260],
    [480, 360],
  ]);
  await page.keyboard.press('Enter');
  const per = await made(page, id, T.POLYLINE, 2);
  expect(per.measure?.tool).toBe('perimeter');
  expect(per.vertices).toHaveLength(4);
  expect(per.vertices?.[3]).toEqual(per.vertices?.[0]);

  // Area: straight edges, a light see-through fill kept in the markup (no /IC).
  await tool(page, 'Area');
  await clicks(page, [
    [330, 60],
    [500, 60],
    [500, 200],
    [330, 200],
  ]);
  await page.keyboard.press('Enter');
  const area = await made(page, id, T.POLYGON);
  expect(area.measure).toMatchObject({ tool: 'area', fill: '#E44234' });
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === area.id)?.color)
    .toBe('transparent');
  await page.keyboard.press('Escape');

  // One markup each: no text boxes.
  const all = await objects(page, id);
  expect(all.filter((o) => o.type === T.FREETEXT)).toEqual([]);
  expect(all).toHaveLength(4);
  await page.mouse.move(10, 10);
  await shot(page, 'four-tools');
});

test('Properties pane: Label, caption In line, fill; a dragged caption, put back; axe light', async ({
  page,
}) => {
  const id = await open(page);
  await tool(page, 'Length');
  await clicks(page, [
    [100, 200],
    [400, 200],
  ]);
  await page.keyboard.press('Enter');
  const len = await made(page, id, T.LINE);
  await page.keyboard.press('Escape');
  await run(page, 'view.propertiesPane');
  await cap(page, 'annotate', 'select', id, 0, len.id);
  const pane = page.getByTestId('measure-info');
  await expect(pane).toBeVisible();

  // The Label goes in front of the value (Q27); the subject stays the tool's name.
  await pane.getByLabel('Label', { exact: true }).fill('Wall W1');
  await pane.getByLabel('Label', { exact: true }).press('Tab');
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === len.id)?.contents)
    .toMatch(/^Wall W1: /);
  // The caption In line (/CP /Inline).
  await pane.getByLabel('Caption').selectOption({ label: 'In the line' });
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === len.id)?.measure?.cap)
    .toBe('inline');
  // One undo puts the caption back above.
  await cap(page, 'annotate', 'undo', id);
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === len.id)?.measure?.cap)
    .toBe('top');

  // The caption is draggable; the keyboard moves it too.
  const handle = page.getByTestId('caption-handle');
  await expect(handle).toHaveAccessibleName('Move the caption of this measurement');
  const box = await handle.boundingBox();
  if (!box) throw new Error('no caption handle');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === len.id)?.measure?.capOffset)
    .toBeDefined();
  await handle.focus();
  await page.keyboard.press('Shift+ArrowUp');
  await shot(page, 'caption-dragged');
  await pane.getByRole('button', { name: 'Put the caption back' }).click();
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === len.id)?.measure?.capOffset)
    .toBeUndefined();

  // An Area's fill is the Style section's Fill, kept in the markup.
  await tool(page, 'Area');
  await clicks(page, [
    [100, 300],
    [300, 300],
    [300, 400],
  ]);
  await page.keyboard.press('Enter');
  const area = await made(page, id, T.POLYGON);
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'select', id, 0, area.id);
  await expect(pane).toBeVisible();
  await expect(pane.getByLabel('Caption')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
  await shot(page, 'properties-light');
});

test('Home’s Measure button shows the last measuring tool; its menu lists all four', async ({
  page,
}) => {
  await open(page, simplePdf(1), 'Home');
  const home = page.getByRole('toolbar', { name: 'Home commands' });
  await expect(home.getByRole('button', { name: 'Length', exact: true })).toBeVisible();
  await home.getByRole('button', { name: 'Measuring tools' }).click();
  const menu = page.getByRole('menu', { name: 'Measuring tools' });
  for (const name of ['Length', 'Polylength', 'Perimeter', 'Area'])
    await expect(menu.getByRole('menuitemcheckbox', { name, exact: true })).toBeVisible();
  await menu.getByRole('menuitemcheckbox', { name: 'Area', exact: true }).click();
  // The face follows the last tool used, pressed while it is on.
  const face = home.getByRole('button', { name: 'Area', exact: true });
  await expect(face).toHaveAttribute('aria-pressed', 'true');
  await face.click();
  await expect(face).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  const comment = page.getByRole('toolbar', { name: 'Comment commands' });
  await expect(comment.getByRole('button', { name: 'Area', exact: true })).toBeVisible();
  await shot(page, 'comment-measure-button');
});

test('a 1.1.0 file: the bar updates each measurement and its text box into one markup; one undo; axe dark', async ({
  page,
}) => {
  await darkTheme(page);
  const id = await open(page, v110MeasurementsPdf(), 'Home');
  const bar = page.getByTestId('old-measurements-bar');
  await expect(bar).toContainText('2 measurements saved by an earlier version of Triya PDF');
  expect(await axe(page)).toEqual([]);
  await shot(page, 'old-measurements-bar-dark');
  expect((await objects(page, id)).filter((o) => o.type === T.FREETEXT)).toHaveLength(2);

  await page.getByRole('button', { name: 'Update old measurements' }).click();
  await expect(bar).toContainText('2 measurements updated');
  await expect
    .poll(async () => (await objects(page, id)).map((o) => o.type).sort())
    .toEqual([T.LINE, T.POLYGON]);
  const all = await objects(page, id);
  expect(all.find((o) => o.type === T.LINE)?.measure).toEqual({ tool: 'length', cap: 'top' });
  expect(all.find((o) => o.type === T.POLYGON)?.measure?.tool).toBe('area');
  await shot(page, 'old-measurements-updated-dark');

  // One undo puts both pairs back as they were.
  await cap(page, 'annotate', 'undo', id);
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.type === T.FREETEXT).length)
    .toBe(2);
  await expect(bar).toContainText('2 measurements saved by an earlier version');

  // Its × closes the bar for this document.
  await page
    .getByRole('region', { name: 'Measurements from an earlier version' })
    .getByRole('button', { name: 'Close this message' })
    .click();
  await expect(bar).toHaveCount(0);
});
