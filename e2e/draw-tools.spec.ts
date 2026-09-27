import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-09 (D-03, §7.1, M3-Q6): the note, text, drawing, ink and link tools make
// standard annotations with appearances, authored from the profile, saved in
// the narrow tail and read back.

interface Listed {
  id: string;
  page: number;
  type: number;
  author: string | null;
  contents: string | null;
}

// PdfAnnotationSubtype values.
const T = {
  TEXT: 1,
  LINK: 2,
  FREETEXT: 3,
  LINE: 4,
  SQUARE: 5,
  CIRCLE: 6,
  POLYGON: 7,
  POLYLINE: 8,
  INK: 15,
};

const view = (page: Page) => page.getByTestId('document-view');
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array = simplePdf(2)): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'draw.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** Screen point of a page point (top-left origin) on page 1. */
async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 6) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function clicks(page: Page, pts: [number, number][], dbl = true) {
  for (const [i, p] of pts.entries()) {
    const s = await at(page, ...p);
    // As a person does: the pointer travels to the point, then clicks.
    await page.mouse.move(s.x, s.y, { steps: 5 });
    if (dbl && i === pts.length - 1) await page.mouse.dblclick(s.x, s.y);
    else await page.mouse.click(s.x, s.y);
  }
}

async function tool(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Comment' }).click();
  const b = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function savedTail(page: Page, id: string): Promise<string> {
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  return Buffer.from(saved.tail, 'base64').toString('latin1');
}

const CASES: { name: string; type: number; subtype: string; draw: (p: Page) => Promise<void> }[] = [
  {
    name: 'Rectangle',
    type: T.SQUARE,
    subtype: 'Square',
    draw: (p) => drag(p, [100, 100], [220, 180]),
  },
  { name: 'Oval', type: T.CIRCLE, subtype: 'Circle', draw: (p) => drag(p, [100, 100], [220, 180]) },
  { name: 'Line', type: T.LINE, subtype: 'Line', draw: (p) => drag(p, [100, 100], [300, 140]) },
  { name: 'Arrow', type: T.LINE, subtype: 'Line', draw: (p) => drag(p, [100, 100], [300, 140]) },
  { name: 'Pencil', type: T.INK, subtype: 'Ink', draw: (p) => drag(p, [100, 100], [300, 200], 20) },
  {
    name: 'Polyline',
    type: T.POLYLINE,
    subtype: 'PolyLine',
    draw: (p) =>
      clicks(p, [
        [100, 100],
        [200, 160],
        [300, 100],
      ]),
  },
  {
    name: 'Polygon',
    type: T.POLYGON,
    subtype: 'Polygon',
    draw: (p) =>
      clicks(p, [
        [100, 100],
        [200, 160],
        [300, 100],
      ]),
  },
  {
    name: 'Cloud',
    type: T.POLYGON,
    subtype: 'Polygon',
    draw: (p) =>
      clicks(p, [
        [100, 100],
        [200, 200],
        [300, 100],
      ]),
  },
];

for (const c of CASES) {
  test(`${c.name}: draw → standard annotation with an appearance, saved and read back`, async ({
    page,
  }) => {
    const id = await open(page);
    await tool(page, c.name);
    await c.draw(page);
    await expect.poll(async () => (await list(page, id)).map((a) => a.type)).toEqual([c.type]);
    expect((await list(page, id))[0]?.author).toBe('Ana de Vries');
    const tail = await savedTail(page, id);
    expect(tail).toMatch(new RegExp(`/Subtype\\s*/${c.subtype}\\b`));
    expect(tail).toMatch(/\/AP\s*<<\s*\/N/);
    expect(tail).toMatch(/\/T\s*\(Ana de Vries\)/);
    expect(tail).not.toContain('EPDFCustom');
    if (c.name === 'Arrow') expect(tail).toMatch(/\/LE\s*\[\s*\/None\s*\/OpenArrow/);
    if (c.name === 'Cloud') expect(tail).toMatch(/\/BE\s*<<[^>]*\/S\s*\/C/);
    if (c.name === 'Polyline' || c.name === 'Polygon')
      expect(tail).toMatch(/\/Vertices\s*\[(\s*[\d.]+){6}\s*\]/);
    // Undo removes it (M3-05).
    await view(page).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await list(page, id)).length).toBe(0);
  });
}

test('Shift keeps a line horizontal and a rectangle square', async ({ page }) => {
  const id = await open(page);
  await tool(page, 'Line');
  await page.keyboard.down('Shift');
  await drag(page, [100, 100], [300, 140]);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await list(page, id)).length).toBe(1);
  const line = (await cap(page, 'annotate', 'list', id)) as {
    rect: { size: { height: number } };
  }[];
  // Dragged 40 pt down, drawn horizontal: the rect is only as tall as the stroke's allowance.
  expect(line[0]?.rect.size.height).toBeLessThan(30);
  await drag(page, [100, 200], [300, 240]);
  await expect.poll(async () => (await list(page, id)).length).toBe(2);
  const both = (await cap(page, 'annotate', 'list', id)) as {
    rect: { size: { height: number } };
  }[];
  expect(Math.max(...both.map((l) => l.rect.size.height))).toBeGreaterThan(40);
});

test('polyline: Enter finishes, Esc drops the one in progress and keeps the tool', async ({
  page,
}) => {
  const id = await open(page);
  await tool(page, 'Polyline');
  await clicks(
    page,
    [
      [100, 100],
      [200, 160],
      [300, 100],
    ],
    false,
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'polyline');
  expect(await list(page, id)).toEqual([]);
  await clicks(
    page,
    [
      [100, 100],
      [200, 160],
      [300, 100],
    ],
    false,
  );
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await list(page, id)).map((a) => a.type)).toEqual([T.POLYLINE]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'select');
});

test('keyboard: N then Enter places a note, T then Enter a text box (M3-Q6)', async ({ page }) => {
  const id = await open(page);
  await view(page).focus();
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  const note = page.getByRole('dialog', { name: 'Note' });
  await note.getByLabel('Note text').fill('Check this dimension');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await list(page, id)).map((a) => [a.type, a.contents]))
    .toEqual([[T.TEXT, 'Check this dimension']]);
  await view(page).focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.keyboard.press('Enter');
  const box = page.getByRole('dialog', { name: 'Text box' });
  await box.getByLabel('Text').fill('Revised per RFI 12');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await list(page, id)).map((a) => [a.type, a.contents]).sort())
    .toEqual([
      [T.TEXT, 'Check this dimension'],
      [T.FREETEXT, 'Revised per RFI 12'],
    ]);
  const tail = await savedTail(page, id);
  expect(tail).toMatch(/\/Subtype\s*\/FreeText/);
  expect(tail).toMatch(/\/Contents\s*\(Revised per RFI 12\)/);
  expect(tail).toMatch(/\/Subtype\s*\/Text\b/);
});

test('Link: draw → page 2 jumps; a web link asks first (rule 4); javascript: refused', async ({
  page,
}) => {
  const id = await open(page);
  const dialog = page.getByRole('dialog', { name: 'Link' });
  await tool(page, 'Link');
  await drag(page, [100, 100], [250, 130]);
  await dialog.getByLabel('Page (1 to 2)').fill('2');
  await dialog.getByRole('button', { name: 'Create link' }).click();
  await expect(dialog).toBeHidden();

  await drag(page, [100, 200], [250, 230]);
  await dialog.getByLabel('A web address').check();
  await dialog.getByLabel('Web address', { exact: true }).fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Create link' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('Web address', { exact: true }).fill('example.com/spec');
  await dialog.getByRole('button', { name: 'Create link' }).click();
  await expect
    .poll(async () => (await list(page, id)).filter((a) => a.type === T.LINK).length)
    .toBe(2);
  await view(page).focus();
  await page.keyboard.press('Escape');

  const tail = await savedTail(page, id);
  expect(tail).toMatch(/\/Subtype\s*\/Link/);
  expect(tail).toMatch(/\/S\s*\/GoTo/);
  expect(tail).toMatch(/\/URI\s*\(https:\/\/example\.com\/spec\)/);

  await page.getByRole('button', { name: /example\.com\/spec/ }).click();
  await expect(page.getByRole('dialog')).toContainText('https://example.com/spec');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Link to page 2', exact: true }).click();
  await expect(
    page
      .getByRole('contentinfo', { name: 'Status bar' })
      .getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('2');
});
