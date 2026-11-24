import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-16 (§7.4, ADR-007, M3-Q2): Distance, Perimeter and Area draw EmbedPDF
// line/polyline/polygon annotations, placed by clicks (M13-10: a Distance's
// dimension line beside its points, stored as /LL and /LLE); the value goes to /Contents and a grouped
// FreeText label, and /IT, /Measure, /Cap are staged for the single Ctrl+S
// revision. Values follow vertex edits (in the same undo step) and the scale.

interface Obj {
  id: string;
  type: number;
  intent?: string;
  contents?: string;
  inReplyToId?: string;
  replyType?: number;
  linePoints?: { start: { x: number; y: number }; end: { x: number; y: number } };
  vertices?: { x: number; y: number }[];
  leader?: { ll: number; lle: number; llo: number };
  rect?: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const T = { FREETEXT: 3, LINE: 4, POLYGON: 7, POLYLINE: 8 };
const GROUP = 2;
const MM = 72 / 25.4; // points per paper millimetre

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array = simplePdf(1)): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure' }).click();
  return id;
}

async function setScale(page: Page, real: string, units: string, decimals: string) {
  await measureTab(page).getByRole('button', { name: 'Set Scale' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill(real);
  await dialog.getByLabel('Units').selectOption({ label: units });
  await dialog.getByLabel('Decimal places').selectOption({ value: decimals });
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
}

async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function tool(page: Page, name: string) {
  const b = measureTab(page).getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function clicks(page: Page, pts: [number, number][]) {
  for (const p of pts) {
    const s = await at(page, ...p);
    await page.mouse.move(s.x, s.y, { steps: 5 });
    await page.mouse.click(s.x, s.y);
  }
}

/** The measurement of `type` and its grouped label, once both exist. */
async function measured(page: Page, id: string, type: number) {
  await expect
    .poll(async () => {
      const all = await objects(page, id);
      const m = all.find((o) => o.type === type && o.intent?.endsWith('Dimension'));
      const label = all.find((o) => o.inReplyToId === m?.id && o.replyType === GROUP);
      return m && label && label.contents === m.contents ? m.contents : null;
    })
    .not.toBeNull();
  const all = await objects(page, id);
  const m = all.find((o) => o.type === type && o.intent?.endsWith('Dimension'));
  const label = all.find((o) => o.inReplyToId === m?.id);
  if (!m || !label) throw new Error('measurement or label missing');
  return { m, label };
}

async function contentsOf(page: Page, id: string, annot: string) {
  return (await objects(page, id)).find((o) => o.id === annot)?.contents ?? null;
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

// A 200 × 100 mm rectangle on paper: 20 × 10 m at 1:100.
const R = [
  { x: 100, y: 500 },
  { x: 100 + 200 * MM, y: 500 },
  { x: 100 + 200 * MM, y: 500 - 100 * MM },
  { x: 100, y: 500 - 100 * MM },
];

test('Distance at 1:100: live value, value and label, vertex edit in one undo step, saved and read back @smoke', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  await setScale(page, '100', 'Metres', '2');
  await tool(page, 'Distance');

  // M13-10: click the first point, click the second (the value next to the pointer, in
  // the page's scale), move sideways to set the dimension line, click to place it.
  const a = await at(page, 100, 300);
  const b = await at(page, 300, 300);
  const side = await at(page, 220, 340);
  await page.mouse.move(a.x, a.y);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await expect(page.getByTestId('measure-live')).toHaveText(/^\d+\.\d\d m$/);
  await page.mouse.click(b.x, b.y);
  // Nothing is placed yet: the leader lines follow the pointer, the value stays.
  expect(await cap(page, 'annotate', 'list', id)).toEqual([]);
  await page.mouse.move(side.x, side.y, { steps: 6 });
  await expect(page.getByTestId('measure-leaders').locator('line')).toHaveCount(2);
  await expect(page.getByTestId('measure-live')).toHaveText(/^\d+\.\d\d m$/);
  await page.mouse.click(side.x, side.y);
  await expect(page.getByTestId('measure-live')).toBeHidden();
  await expect(page.getByTestId('measure-leaders')).toHaveCount(0);

  const { m, label } = await measured(page, id, T.LINE);
  expect(m.contents).toMatch(/^\d+\.\d\d m$/);
  expect(label.type).toBe(T.FREETEXT);
  // The measured points stay the line; the offset is the leader (40 pt, down the page).
  expect(m.linePoints?.start.y).toBeCloseTo(300, 0);
  expect(m.linePoints?.end.y).toBeCloseTo(300, 0);
  expect(m.leader?.ll).toBeCloseTo(40, 0);
  // The label sits over the dimension line, not over the measured points.
  expect((await objects(page, id)).find((o) => o.id === label.id)?.rect?.origin.y).toBeGreaterThan(
    300,
  );

  // A vertex edit re-values the measurement and its label; one undo takes all back.
  const before = m.contents;
  await cap(page, 'annotate', 'update', id, 0, m.id, {
    linePoints: { start: R[0], end: R[1] },
  });
  await expect.poll(() => contentsOf(page, id, m.id)).toBe('20.00 m');
  await expect.poll(() => contentsOf(page, id, label.id)).toBe('20.00 m');
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(() => contentsOf(page, id, m.id)).toBe(before);
  await expect.poll(() => contentsOf(page, id, label.id)).toBe(before);
  await cap(page, 'annotate', 'redo', id);
  await expect.poll(() => contentsOf(page, id, m.id)).toBe('20.00 m');

  // Selecting the label selects the measurement alone (its vertices stay editable).
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'select', id, 0, label.id);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([m.id]);

  const { file, tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/IT\s*\/LineDimension/);
  expect(tail).toMatch(/\/Measure\s*<<[^]*\/Subtype\s*\/RL/);
  expect(tail).toMatch(/\/R\s*\(1 m = 100 m\)/);
  expect(tail).toMatch(/\/Cap\s*true/);
  expect(tail).toMatch(/\/Contents\s*\(20\.00 m\)/);
  expect(tail).toMatch(/\/RT\s*\/Group/);
  // The offset as the standard leader line entries, so other viewers draw it.
  expect(tail).toMatch(/\/LL\s+40(\.\d+)?\b/);
  expect(tail).toMatch(/\/LLE\s+3\b/);

  // Reopened: still a measurement with its value and its leader lines.
  const id2 = await open(page, file);
  const back = await measured(page, id2, T.LINE);
  expect(back.m.intent).toBe('LineDimension');
  expect(back.m.contents).toBe('20.00 m');
  expect(back.m.leader?.ll).toBeCloseTo(40, 0);
});

test('Distance: Esc drops a half-placed one; Enter places it with no offset; the old drag still works', async ({
  page,
}) => {
  const id = await open(page);
  await tool(page, 'Distance');
  await expect(page.getByTestId('tool-hint')).toContainText('Click two points');
  const live = page.getByTestId('measure-live');

  // Esc after the second point: nothing placed, the tool stays on.
  await clicks(page, [
    [100, 300],
    [300, 300],
  ]);
  const side = await at(page, 200, 260);
  await page.mouse.move(side.x, side.y, { steps: 4 });
  await expect(page.getByTestId('measure-leaders')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(live).toHaveCount(0);
  expect(await cap(page, 'annotate', 'list', id)).toEqual([]);
  await expect(
    measureTab(page).getByRole('button', { name: 'Distance', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Enter after the second point (pointer on the line): a plain dimension, no leader lines.
  await clicks(page, [
    [100, 150],
    [300, 150],
  ]);
  await page.keyboard.press('Enter');
  const first = await measured(page, id, T.LINE);
  expect(first.m.leader).toBeUndefined();

  // Press at the first point, drag to the second, release; then the offset, above.
  const a = await at(page, 100, 250);
  const b = await at(page, 300, 250);
  const up = await at(page, 200, 220);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(live).toBeVisible();
  await page.mouse.move(up.x, up.y, { steps: 4 });
  await page.mouse.click(up.x, up.y);
  await expect
    .poll(async () =>
      (await objects(page, id)).filter((o) => o.type === T.LINE).map((o) => o.leader?.ll ?? 0),
    )
    .toHaveLength(2);
  const lines = (await objects(page, id)).filter((o) => o.type === T.LINE);
  const dragged = lines.find((o) => o.id !== first.m.id);
  // Above a line drawn left to right is anticlockwise: a negative /LL.
  expect(dragged?.leader?.ll).toBeCloseTo(-30, 0);
  expect(dragged?.linePoints?.start.x).toBeCloseTo(100, 0);
  expect(dragged?.linePoints?.end.x).toBeCloseTo(300, 0);
});

test('Perimeter and Area are placed by clicks: double-click, a click on the first corner, Esc', async ({
  page,
}) => {
  const id = await open(page);
  await tool(page, 'Perimeter');
  await expect(page.getByTestId('tool-hint')).toContainText('double-click or press Enter');
  await clicks(page, [
    [100, 200],
    [200, 250],
  ]);
  const c = await at(page, 300, 200);
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.mouse.dblclick(c.x, c.y);
  const per = await measured(page, id, T.POLYLINE);
  expect(per.m.vertices).toHaveLength(3);

  await tool(page, 'Area');
  await expect(page.getByTestId('tool-hint')).toContainText('click the first one');
  await clicks(page, [
    [350, 150],
    [500, 150],
    [500, 280],
    [350, 150],
  ]);
  const area = await measured(page, id, T.POLYGON);
  expect(area.m.vertices).toHaveLength(3);

  // Esc drops a half-drawn area.
  await clicks(page, [
    [350, 320],
    [500, 320],
  ]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('measure-live')).toHaveCount(0);
  expect((await objects(page, id)).filter((o) => o.type === T.POLYGON)).toHaveLength(1);
});

test('Perimeter and Area: click, Enter finishes; exact S2 values; a new scale re-values them', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  await setScale(page, '100', 'Metres', '2');

  await tool(page, 'Perimeter');
  await clicks(page, [
    [100, 200],
    [200, 250],
    [300, 200],
  ]);
  await page.keyboard.press('Enter');
  const per = await measured(page, id, T.POLYLINE);
  expect(per.m.contents).toMatch(/^\d+\.\d\d m$/);

  await tool(page, 'Area');
  await clicks(page, [
    [350, 150],
    [500, 150],
    [500, 280],
  ]);
  await page.keyboard.press('Enter');
  const area = await measured(page, id, T.POLYGON);
  expect(area.m.contents).toMatch(/^\d+\.\d\d m²$/);
  await page.keyboard.press('Escape');

  // The S2 table: 60.00 m around, 200.00 m² inside.
  await cap(page, 'annotate', 'update', id, 0, per.m.id, { vertices: [...R, R[0]] });
  await cap(page, 'annotate', 'update', id, 0, area.m.id, { vertices: R });
  await expect.poll(() => contentsOf(page, id, per.m.id)).toBe('60.00 m');
  await expect.poll(() => contentsOf(page, id, area.m.id)).toBe('200.00 m²');

  // The same paper geometry at 1:5 in millimetres (the S2 detail): 5,000 / 1,000 × …
  await setScale(page, '5', 'Millimetres', '1');
  await expect.poll(() => contentsOf(page, id, per.m.id)).toBe('3,000.0 mm');
  await expect.poll(() => contentsOf(page, id, area.m.id)).toBe('500,000.0 mm²');
  await expect.poll(() => contentsOf(page, id, per.label.id)).toBe('3,000.0 mm');

  const { tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/IT\s*\/PolyLineDimension/);
  expect(tail).toMatch(/\/IT\s*\/PolygonDimension/);
  expect(tail).toMatch(/\/R\s*\(1 mm = 5 mm\)/);
  expect(tail).toMatch(/\/Contents\s*\(3,000\.0 mm\)/);
});

// Pre-release audit bugs 3 and 8: a half-drawn perimeter is dropped, with its live value,
// when another tool is chosen or another tab is shown.
test('another tool or another tab drops a half-drawn perimeter and its live value', async ({
  page,
}) => {
  const id = await open(page);
  const live = page.getByTestId('measure-live');
  const halfDrawn = async () => {
    await tool(page, 'Perimeter');
    const a = await at(page, 100, 200);
    const b = await at(page, 200, 250);
    const c = await at(page, 300, 200);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.mouse.move(c.x, c.y, { steps: 4 });
    await expect(live).toBeVisible();
  };
  await halfDrawn();
  await tool(page, 'Area');
  await expect(live).toHaveCount(0);
  await expect(page.locator('[data-page="0"] svg polyline')).toHaveCount(0);

  await drop(page, [{ name: 'other.pdf', b64: Buffer.from(simplePdf(2)).toString('base64') }]);
  await expect(page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(
    2,
  );
  const docTabs = page.getByRole('tablist', { name: 'Open documents' });
  await docTabs.getByRole('tab', { name: /^sheet\.pdf/ }).click();
  await halfDrawn();
  await docTabs.getByRole('tab', { name: /^other\.pdf/ }).click();
  await expect(live).toHaveCount(0);
  expect(await cap(page, 'annotate', 'list', id)).toEqual([]);
});

test('without a scale the value is marked uncalibrated and no /Measure is written', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  await tool(page, 'Distance');
  const a = await at(page, 100, 300);
  const b = await at(page, 100 + 50 * MM, 300);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await expect(page.getByTestId('measure-live')).toHaveText(/\(uncalibrated\)$/);
  await page.mouse.click(b.x, b.y);
  await page.mouse.click(b.x, b.y);
  const { m } = await measured(page, id, T.LINE);
  expect(m.contents).toMatch(/^\d+\.\d mm \(uncalibrated\)$/);
  const { tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/IT\s*\/LineDimension/);
  expect(tail).not.toMatch(/\/Measure/);
});

test('an encrypted file (AES-256) saves its measurement with the measure keys', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
  const bytes = qpdfEncrypt(simplePdf(1), '', 'owner', ['256']);
  const id = await open(page, bytes);
  await setScale(page, '100', 'Metres', '2');
  await tool(page, 'Distance');
  await clicks(page, [
    [100, 300],
    [300, 300],
    [200, 330],
  ]);
  const { m } = await measured(page, id, T.LINE);
  const { file } = await save(page, id, bytes);
  const id2 = await open(page, file);
  const back = await measured(page, id2, T.LINE);
  expect(back.m.contents).toBe(m.contents);
  expect(back.m.intent).toBe('LineDimension');
});
