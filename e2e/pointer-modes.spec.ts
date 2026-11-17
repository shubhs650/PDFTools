import type { Page } from '@playwright/test';
import { buildPdf, fullFormPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-06 (ADR-028 D-51): comments are picked up in every pointer mode, not only
// in Select and Select Comments. Hand: a click selects, a drag on a comment
// moves it, elsewhere it pans. Select Text: a click selects; on a text markup
// a drag selects the text under it (owner's Q6). Form fields are filled and
// links followed in every mode; locked comments select but do not move; the
// page menu lists Select and checks the current tool.

interface Obj {
  id: string;
  type: number;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const T = { TEXT: 1, FREETEXT: 3, SQUARE: 5, INK: 15, HIGHLIGHT: 9, STAMP: 13 } as const;
const view = (page: Page) => page.getByTestId('document-view');
const menu = (page: Page) => page.getByRole('menu');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const selected = async (page: Page, id: string) =>
  [...(((await cap(page, 'annotate', 'selected', id)) as string[] | null) ?? [])].sort();
const textSelected = async (page: Page) =>
  ((await cap(page, 'view', 'selection')) as { selection: unknown } | null)?.selection != null;

async function open(page: Page, bytes: Uint8Array = simplePdf(2)): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'modes.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+0'); // Fit Page: the whole page in view
  await expect(page.getByRole('textbox', { name: 'Zoom', exact: true })).not.toHaveValue('100%');
  return id;
}

/** Screen point of a page point (top-left origin; the fixtures are 595 pt wide). */
async function at(page: Page, x: number, y: number, p = 0) {
  const box = await page.locator(`[data-page="${String(p)}"] .page-content`).boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function click(page: Page, x: number, y: number, button: 'left' | 'right' = 'left') {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.click(p.x, p.y, { button });
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

const make = (page: Page, id: string, obj: Record<string, unknown>) =>
  cap(page, 'annotate', 'create', id, 0, obj) as Promise<string>;
const box = (x: number, y: number, width: number, height: number) => ({
  origin: { x, y },
  size: { width, height },
});

/** Where each kind lies (page points, top-left origin): a point on it and its id. */
interface Kind {
  name: string;
  id: string;
  /** A point that hits it (its stroke, for ink). */
  hit: [number, number];
  movable: boolean;
}

/** A text box, a highlight over "Page 1", an ink stroke, a sticky note and an image stamp. */
async function comments(page: Page, id: string): Promise<Kind[]> {
  const text = await make(page, id, {
    type: T.FREETEXT,
    rect: box(320, 60, 180, 40),
    contents: 'Text box',
    fontFamily: 4,
    fontSize: 14,
    fontColor: '#000000',
    textAlign: 0,
    verticalAlign: 0,
  });
  // "Page 1" is drawn at 72, 740 (PDF space), 36 pt: y 75…110 from the top.
  const hlBox = box(70, 74, 112, 36);
  const highlight = await make(page, id, {
    type: T.HIGHLIGHT,
    rect: hlBox,
    segmentRects: [hlBox],
    strokeColor: '#FFE14D',
    color: '#FFE14D',
    opacity: 0.5,
  });
  const ink = await make(page, id, {
    type: T.INK,
    rect: box(56, 196, 208, 8),
    inkList: [
      {
        points: [
          { x: 60, y: 200 },
          { x: 260, y: 200 },
        ],
      },
    ],
    strokeColor: '#D93025',
    strokeWidth: 4,
  });
  const note = await make(page, id, {
    type: T.TEXT,
    rect: box(420, 200, 24, 24),
    contents: 'Sticky note',
    strokeColor: '#FFE14D',
    color: '#FFE14D',
  });
  // An image stamp, pasted as an image file is (M7, image stamps).
  await view(page).focus();
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(120, 80);
    const g = c.getContext('2d');
    if (!g) throw new Error('no 2d');
    g.fillStyle = '#2f5fb3';
    g.fillRect(0, 0, 120, 80);
    const file = new File([await c.convertToBlob({ type: 'image/png' })], 'pic.png', {
      type: 'image/png',
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    (document.activeElement ?? document.body).dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });
  await expect
    .poll(async () => (await objects(page, id)).some((o) => o.type === T.STAMP))
    .toBe(true);
  const stamp = (await objects(page, id)).find((o) => o.type === T.STAMP);
  if (!stamp) throw new Error('no stamp');
  // The paste selects the stamp: start from nothing selected.
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page, id)).toEqual([]);
  await expect
    .poll(async () => {
      const list = (await cap(page, 'annotate', 'list', id)) as { commit: string }[];
      return list.every((a) => a.commit === 'synced');
    })
    .toBe(true);
  const c = stamp.rect;
  return [
    { name: 'text box', id: text, hit: [400, 80], movable: true },
    { name: 'highlight', id: highlight, hit: [130, 92], movable: false },
    { name: 'ink', id: ink, hit: [160, 200], movable: true },
    { name: 'sticky note', id: note, hit: [432, 212], movable: true },
    {
      name: 'image stamp',
      id: stamp.id,
      hit: [c.origin.x + c.size.width / 2, c.origin.y + c.size.height / 2],
      movable: true,
    },
  ];
}

async function originOf(page: Page, id: string, annot: string) {
  return (await objects(page, id)).find((o) => o.id === annot)?.rect.origin ?? null;
}

type ToolName = 'Select' | 'Hand' | 'Select Text';

async function useTool(page: Page, tool: ToolName) {
  if (tool === 'Select Text') {
    await page.getByRole('tab', { name: 'Comment', exact: true }).click();
    const b = page.getByRole('button', { name: 'Select Text', exact: true });
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'true');
    return;
  }
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  const b = page.getByRole('button', { name: tool, exact: true }).first();
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** An empty spot of page 1, on screen at Fit Page. */
const EMPTY: [number, number] = [300, 600];

for (const tool of ['Hand', 'Select Text', 'Select'] as const) {
  test(`${tool}: a click selects every kind of comment, a drag on one moves it; a click on the page deselects${tool === 'Hand' ? ' @smoke' : ''}`, async ({
    page,
  }) => {
    const id = await open(page);
    const kinds = await comments(page, id);
    await useTool(page, tool);
    for (const k of kinds) {
      await click(page, ...k.hit);
      await expect
        .poll(() => selected(page, id), { message: `${k.name} selected` })
        .toEqual([k.id]);
      await click(page, ...EMPTY);
      await expect.poll(() => selected(page, id), { message: `${k.name} deselected` }).toEqual([]);
      if (!k.movable) continue;
      // A drag that starts on the (unselected) comment moves it.
      const before = await originOf(page, id, k.id);
      await drag(page, k.hit, [k.hit[0] + 30, k.hit[1] + 40]);
      await expect
        .poll(
          async () => {
            const o = await originOf(page, id, k.id);
            return o && before ? [Math.round(o.x - before.x), Math.round(o.y - before.y)] : null;
          },
          { message: `${k.name} moved` },
        )
        .toEqual([30, 40]);
      expect(await selected(page, id)).toEqual([k.id]);
      await click(page, ...EMPTY);
      await expect.poll(() => selected(page, id)).toEqual([]);
    }
    // The text box opens its editor on a double-click, in every mode.
    const text = kinds[0];
    if (!text) throw new Error('no text box');
    const moved = await originOf(page, id, text.id);
    const p = await at(page, (moved?.x ?? 0) + 60, (moved?.y ?? 0) + 20);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('[data-page="0"] [contenteditable="true"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
}

test('Select Text: a drag over a highlight selects its text; Hand: a drag there pans and a click selects it', async ({
  page,
}) => {
  const id = await open(page);
  const [, highlight] = await comments(page, id);
  if (!highlight) throw new Error('no highlight');
  await useTool(page, 'Select Text');
  await drag(page, [74, 92], [178, 94]);
  await expect.poll(() => textSelected(page)).toBe(true);
  expect(await selected(page, id)).toEqual([]);
  // Over the highlight the pointer is the text cursor (a drag selects text).
  const p = await at(page, 130, 92);
  await page.mouse.move(p.x, p.y);
  const cursorAt = (x: number, y: number) =>
    page.evaluate(
      ([cx, cy]) => {
        const el = document.elementFromPoint(cx ?? 0, cy ?? 0);
        return el ? getComputedStyle(el).cursor : null;
      },
      [x, y],
    );
  expect(await cursorAt(p.x, p.y)).toBe('text');

  // Hand at Fit Width (the page scrolls): a drag on the highlight pans.
  await view(page).press('ControlOrMeta+2');
  await useTool(page, 'Hand');
  const vp = page.locator('.viewport');
  await vp.evaluate((el) => {
    el.scrollTop = 0;
  });
  await drag(page, [130, 92], [130, 40]);
  await expect.poll(() => vp.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await selected(page, id)).toEqual([]);
  // A click on it selects it.
  await vp.evaluate((el) => {
    el.scrollTop = 0;
  });
  await click(page, 130, 92);
  await expect.poll(() => selected(page, id)).toEqual([highlight.id]);
  // Over a comment the pointer is the move cursor, elsewhere the hand.
  const ink = await at(page, 160, 200);
  await page.mouse.move(ink.x, ink.y);
  expect(await cursorAt(ink.x, ink.y)).toBe('move');
  const empty = await at(page, 300, 150);
  expect(await cursorAt(empty.x, empty.y)).toBe('grab');
});

test('Hand: a drag on empty page space pans, never on a comment; double-click opens a sticky note; Tab walks the comments', async ({
  page,
}) => {
  const id = await open(page);
  const kinds = await comments(page, id);
  await view(page).press('ControlOrMeta+2'); // Fit Width: the page scrolls
  await useTool(page, 'Hand');
  const vp = page.locator('.viewport');
  await vp.evaluate((el) => {
    el.scrollTop = 0;
  });
  // A drag on the ink stroke moves it; the view stays.
  await drag(page, [160, 200], [160, 160]);
  expect(await vp.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await selected(page, id)).toEqual([kinds[2]?.id]);
  // Elsewhere it pans.
  await drag(page, [300, 150], [300, 60]);
  await expect.poll(() => vp.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  await vp.evaluate((el) => {
    el.scrollTop = 0;
  });
  // A double-click on the sticky note opens its window.
  const note = await at(page, 432, 212);
  await page.mouse.dblclick(note.x, note.y);
  await expect(page.locator('[data-note-popup]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-note-popup]')).toHaveCount(0);
  // Tab selects the next comment in reading order, as with Select.
  await click(page, 300, 150);
  await expect.poll(() => selected(page, id)).toEqual([]);
  await view(page).focus();
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await selected(page, id)).length).toBe(1);
  const first = await selected(page, id);
  await page.keyboard.press('Tab');
  await expect.poll(() => selected(page, id)).not.toEqual(first);
});

test('Hand and Select Text: a locked comment selects but does not move; form fields are filled, not selected', async ({
  page,
}) => {
  const id = await open(page, fullFormPdf());
  const locked = await make(page, id, {
    type: T.SQUARE,
    rect: box(360, 300, 120, 60),
    color: '#2f5fb3',
    strokeColor: '#2f5fb3',
    strokeWidth: 2,
    strokeStyle: 1,
    flags: ['print', 'locked'],
  });
  await expect.poll(async () => (await objects(page, id)).some((o) => o.id === locked)).toBe(true);
  for (const tool of ['Hand', 'Select Text'] as const) {
    await useTool(page, tool);
    const before = await originOf(page, id, locked);
    await drag(page, [420, 330], [460, 380]);
    await expect.poll(() => selected(page, id)).toEqual([locked]);
    expect(await originOf(page, id, locked)).toEqual(before);
    await click(page, 450, 600);
    await expect.poll(() => selected(page, id)).toEqual([]);
    // The text field "name" (y 118…142 from the top) takes the click and the text.
    const field = page.getByRole('textbox', { name: 'name field' });
    await field.click();
    await expect(field).toBeFocused();
    await field.fill(`typed with ${tool}`);
    await expect(field).toHaveValue(`typed with ${tool}`);
    expect(await selected(page, id)).toEqual([]);
    await page.keyboard.press('Tab');
  }
});

/** Two pages; on page 1 a link to page 2 at y 100…130 from the top. */
function linkPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>',
    { dict: '<< >>', stream: 'BT /F1 24 Tf 72 720 Td (Go to page 2) Tj ET' },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 36 Tf 72 740 Td (Page 2) Tj ET' },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Link /Rect [70 712 260 742] /Border [0 0 0] /Dest [5 0 R /XYZ 0 842 0] >>',
  ]);
}

test('Hand and Select Text: a link is still followed on click', async ({ page }) => {
  await open(page, linkPdf());
  const pageBox = page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });
  for (const tool of ['Hand', 'Select Text'] as const) {
    await view(page).press('Home');
    await expect(pageBox).toHaveValue('1');
    await useTool(page, tool);
    await click(page, 160, 115);
    await expect(pageBox).toHaveValue('2');
  }
});

test('the page menu lists Select first and checks the current tool; a right-click on a comment in Hand or Select Text opens the comment menu', async ({
  page,
}) => {
  const id = await open(page);
  const kinds = await comments(page, id);
  await click(page, ...EMPTY, 'right');
  await expect(menu(page)).toHaveAccessibleName('Page');
  const tools = menu(page).getByRole('menuitemradio');
  await expect(tools).toHaveText([/^Select\s*V$/, /^Hand\s*H$/, 'Select Text', 'Select Comments']);
  await expect(tools.first()).toHaveAttribute('aria-checked', 'true');
  await menu(page).getByRole('menuitemradio', { name: 'Hand' }).click();
  await expect(menu(page)).toHaveCount(0);
  await click(page, ...EMPTY, 'right');
  await expect(menu(page).getByRole('menuitemradio', { name: 'Hand' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    menu(page).getByRole('menuitemradio', { name: 'Select', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  for (const tool of ['Hand', 'Select Text'] as const) {
    await useTool(page, tool);
    for (const k of [kinds[2], kinds[1]]) {
      if (!k) continue;
      await click(page, ...k.hit, 'right');
      await expect(menu(page), `${tool}, ${k.name}`).toHaveAccessibleName('Comment');
      expect(await selected(page, id)).toEqual([k.id]);
      await page.keyboard.press('Escape');
      await click(page, ...EMPTY);
    }
  }
});
