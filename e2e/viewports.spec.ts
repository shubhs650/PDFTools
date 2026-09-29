import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-17 (§7.4, ADR-007): scale viewports ("Detail A 1:5") written as page /VP
// entries in the single Ctrl+S revision; measurements use the viewport they are
// in, the page scale outside, and are flagged when they span viewports.

interface Obj {
  id: string;
  type: number;
  intent?: string;
  contents?: string;
}

const LINE = 4;
const MM = 72 / 25.4;
const H = 842; // simplePdf is A4: user y → EmbedPDF y = H - y

const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const props = (page: Page) => page.getByTestId('properties-pane');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure' }).click();
  return id;
}

/** View → Properties Pane, then back to Measure (the viewport list shows there). */
async function propertiesPane(page: Page) {
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  await page.getByRole('tab', { name: 'Measure' }).click();
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

/** A distance measurement drawn, then set to user-space points a → b. */
async function distance(page: Page, id: string, a: [number, number], b: [number, number]) {
  const button = measureTab(page).getByRole('button', { name: 'Distance', exact: true });
  await button.click();
  const before = new Set((await objects(page, id)).map((o) => o.id));
  const p = await at(page, 100, 150);
  const q = await at(page, 200, 150);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await page.mouse.up();
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
  return m.id;
}

const contentsOf = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot)?.contents ?? null;

test('Detail A 1:5: added from the keyboard, plate measured inside, a spanning line flagged, saved and read back', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  await setScale(page);
  await propertiesPane(page);
  await expect(props(page)).toContainText('No scale viewports on this page.');

  // Keyboard path: Add viewport in the Properties pane, box typed.
  await props(page).getByRole('button', { name: 'Add viewport' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scale viewport' });
  await expect(dialog.getByLabel('Name')).toHaveValue('Detail A');
  await dialog.getByLabel('Left').fill('300');
  await dialog.getByLabel('Bottom').fill('400');
  await dialog.getByLabel('Right').fill('550');
  await dialog.getByLabel('Top').fill('700');
  await dialog.getByLabel('Paper').fill('1');
  await dialog.getByLabel('Real', { exact: true }).fill('5');
  await dialog.getByLabel('Units').selectOption({ label: 'Millimetres' });
  await dialog.getByLabel('Decimal places').selectOption({ value: '1' });
  await expect(dialog.getByRole('status')).toHaveText('Scale 1 : 5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(props(page)).toContainText('Detail A · 1 : 5');
  await expect(page.getByTestId('viewport-outline')).toHaveCount(1);
  await expect(page.getByTestId('viewport-outline')).toContainText('Detail A 1 : 5');

  // The 80 mm plate inside the detail is 400 mm; outside, the page's 1:100.
  const plate = await distance(page, id, [320, 450], [320 + 80 * MM, 450]);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('400.0 mm');
  const outside = await distance(page, id, [50, 100], [50 + 200 * MM, 100]);
  await expect.poll(() => contentsOf(page, id, outside)).toBe('20.00 m');
  const span = await distance(page, id, [100, 200], [320, 450]);
  await expect(page.getByTestId('measure-spans')).toHaveCount(1);
  await cap(page, 'annotate', 'select', id, 0, span);
  await expect(page.getByTestId('measure-info')).toContainText('Spans the page and Detail A');

  // Undo removes the viewport (the plate is re-valued at the page scale), redo restores it.
  await cap(page, 'annotate', 'select', id, 0, plate);
  await page.keyboard.press('Escape');
  await props(page).getByRole('button', { name: 'Edit Detail A' }).click();
  await page
    .getByRole('dialog', { name: 'Edit scale viewport' })
    .getByLabel('Real', { exact: true })
    .fill('10');
  await page
    .getByRole('dialog', { name: 'Edit scale viewport' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect.poll(() => contentsOf(page, id, plate)).toBe('800.0 mm');
  await cap(page, 'annotate', 'undo', id);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('400.0 mm');
  await cap(page, 'annotate', 'redo', id);
  await expect.poll(() => contentsOf(page, id, plate)).toBe('800.0 mm');

  const s = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(s).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(s.tail, 'base64');
  const text = tail.toString('latin1');
  expect(text).toMatch(/\/Name\s*\(Detail A\)/);
  expect(text).toMatch(/\/R\s*\(1 mm = 10 mm\)/);
  expect(text).toMatch(/\/R\s*\(1 m = 100 m\)/);

  // Reopened: the viewport is read back and listed; the plate keeps its value.
  const id2 = await open(page, Buffer.concat([Buffer.from(bytes), tail]));
  await propertiesPane(page);
  await expect(props(page)).toContainText('Detail A · 1 : 10');
  await expect
    .poll(async () => (await objects(page, id2)).map((o) => o.contents))
    .toContain('800.0 mm');
});

test('the Scale Viewport tool: drag a rectangle, the dialog opens with its box; delete undoes', async ({
  page,
}) => {
  const id = await open(page, simplePdf(1));
  await measureTab(page).getByRole('button', { name: 'Scale Viewport' }).click();
  const a = await at(page, 100, 100);
  const b = await at(page, 300, 250);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Scale viewport' });
  await expect(dialog).toBeVisible();
  // Page points 100…300 across; y flipped: 842 − 250 … 842 − 100.
  await expect(dialog.getByLabel('Left')).toHaveValue(/^(99|100)/);
  await expect(dialog.getByLabel('Top')).toHaveValue(/^74[12]/);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('viewport-outline')).toHaveCount(1);
  await propertiesPane(page);
  await props(page).getByRole('button', { name: 'Delete Detail A' }).click();
  await expect(page.getByTestId('viewport-outline')).toHaveCount(0);
  await cap(page, 'annotate', 'undo', id);
  await expect(page.getByTestId('viewport-outline')).toHaveCount(1);
});
