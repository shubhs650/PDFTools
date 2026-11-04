import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M7-02 (ADR-023 D-43 a, d; review 4b-i, 4b-iii; bugs B1–B3): a new text box,
// typewriter or callout is selected and edits at once with "Type here"
// selected; its text is written on every way out of the editor — Esc, a click
// elsewhere, a tool change, Ctrl+S — as one undo step, and saved.
// M7-03 (D-43 b, c, f; review 4b-iv, 4b-v; bugs B4–B6, B11): a press anywhere
// on one selects it and a drag moves it; Delete, undo; a double-click edits at
// the clicked character, Enter and F2 edit the selected one; a callout in one
// drag; locked comments and restricted files refuse.

interface Listed {
  id: string;
  type: number;
  contents: string | null;
  commit: string;
}

const FREETEXT = 3;

const view = (page: Page) => page.getByTestId('document-view');
const editor = (page: Page) => page.locator('[data-text-comment] [contenteditable="true"]');
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];
const contents = async (page: Page, id: string) => (await list(page, id)).map((a) => a.contents);
/**
 * The comments' text, once written to the Render worker. The next change waits
 * for it: the plugin marks a comment written when a commit ends even if it
 * changed meanwhile, so a change made during a commit never reaches the file
 * (the cause of B13, fixed in M7-04).
 */
async function written(page: Page, id: string, expected: string[]) {
  await expect
    .poll(async () => {
      const all = await list(page, id);
      return all.every((a) => a.commit === 'synced') ? all.map((a) => a.contents) : null;
    })
    .toEqual(expected);
}
const selected = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'selected', id)) as string[] | null) ?? [];
const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');

async function open(page: Page): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'text.pdf', b64: Buffer.from(simplePdf(2)).toString('base64') }]);
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

async function click(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.click(p.x, p.y);
}

async function dblclick(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.dblclick(p.x, p.y);
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

const ribbon = (page: Page) => page.getByRole('toolbar', { name: 'Comment commands' });

async function tool(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Comment' }).click();
  const b = ribbon(page).getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function savedTail(page: Page, id: string): Promise<string> {
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(saved.mode).toBe('narrow');
  return Buffer.from(saved.tail, 'base64').toString('latin1');
}

interface Case {
  name: string;
  /** Makes the comment with the mouse (the tool is on). */
  make: (p: Page) => Promise<void>;
  /** A page point that opens its editor on a double-click. */
  text: [number, number];
}

const CASES: Case[] = [
  {
    name: 'Text Box',
    make: (p) => drag(p, [100, 100], [300, 140]),
    text: [140, 112],
  },
  {
    // A click places a typewriter at its default size.
    name: 'Typewriter',
    make: (p) => click(p, 160, 120),
    text: [150, 120],
  },
  {
    // Arrow tip, knee, then the box.
    name: 'Callout',
    make: async (p) => {
      await click(p, 80, 300);
      await click(p, 140, 240);
      await drag(p, [180, 200], [360, 240]);
    },
    // In its box (B4, M7-03).
    text: [260, 220],
  },
];

/** Opens the editor of the (only) text comment again and puts the caret at its end. */
async function reopen(page: Page, c: Case) {
  await dblclick(page, ...c.text);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+End');
}

for (const c of CASES) {
  test(`${c.name}: starts editing with "Type here" selected; Esc keeps the text (B1, B3)${c.name === 'Callout' ? ' @smoke' : ''}`, async ({
    page,
  }) => {
    const id = await open(page);
    await tool(page, c.name);
    await c.make(page);
    await expect.poll(async () => (await list(page, id)).map((a) => a.type)).toEqual([FREETEXT]);
    const [made] = await list(page, id);
    // Selected, editing, the placeholder selected: the first key replaces it.
    await expect(editor(page)).toBeFocused();
    expect(await selected(page, id)).toEqual([made?.id]);
    expect(await selectedText(page)).toBe('Type here');
    await page.keyboard.type('Hello');
    // Esc writes it and leaves the editor; the comment stays selected.
    await page.keyboard.press('Escape');
    await written(page, id, ['Hello']);
    await expect(editor(page)).toHaveCount(0);
    expect(await selected(page, id)).toEqual([made?.id]);
    await expect(view(page)).toBeFocused();
    // The second Esc deselects.
    await page.keyboard.press('Escape');
    await expect.poll(() => selected(page, id)).toEqual([]);
    // One undo step for the edit, one for the creation.
    await page.keyboard.press('Control+z');
    await written(page, id, ['Type here']);
    await page.keyboard.press('Control+y');
    await written(page, id, ['Hello']);
    const tail = await savedTail(page, id);
    expect(tail).toMatch(/\/Contents\s*\(Hello\)/);
  });

  test(`${c.name}: a click elsewhere, a tool change and Ctrl+S keep the edit too (B2)`, async ({
    page,
  }) => {
    const id = await open(page);
    await tool(page, c.name);
    await c.make(page);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Hello');
    // A click on an empty part of the page.
    await click(page, 450, 600);
    await written(page, id, ['Hello']);
    await expect(editor(page)).toHaveCount(0);
    expect(await list(page, id)).toHaveLength(1);
    // Edit again; Esc; a tool change.
    await page.keyboard.press('Escape');
    await reopen(page, c);
    await page.keyboard.type(' world');
    await tool(page, 'Rectangle');
    await written(page, id, ['Hello world']);
    // Edit again; Ctrl+S. (Esc in the ribbon only returns to the document.)
    await view(page).focus();
    await page.keyboard.press('Escape');
    await reopen(page, c);
    await page.keyboard.type('!');
    await page.keyboard.press('Control+s');
    await written(page, id, ['Hello world!']);
    // Each edit is one undo step.
    await page.keyboard.press('Escape');
    await view(page).focus();
    await page.keyboard.press('Control+z');
    await written(page, id, ['Hello world']);
    await page.keyboard.press('Control+y');
    await written(page, id, ['Hello world!']);
    // Reselected, it shows the written text.
    await reopen(page, c);
    await expect(editor(page)).toHaveText('Hello world!');
    await page.keyboard.press('Escape');
    expect(await contents(page, id)).toEqual(['Hello world!']);
    const tail = await savedTail(page, id);
    expect(tail).toMatch(/\/Contents\s*\(Hello world!\)/);
  });
}

test('keyboard: T then Enter edits a new text box in place; emptied, it keeps an empty /Contents', async ({
  page,
}) => {
  const id = await open(page);
  await view(page).focus();
  await page.keyboard.press('t');
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'freeText');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  expect(await selectedText(page)).toBe('Type here');
  await page.keyboard.type('Revised per RFI 12');
  await page.keyboard.press('Escape');
  await written(page, id, ['Revised per RFI 12']);
  // Emptied: the comment stays, with no text. (Mid-page: where T, Enter puts it.)
  await dblclick(page, 230, 420);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await written(page, id, ['']);
  await page.keyboard.press('Control+z');
  await written(page, id, ['Revised per RFI 12']);
});

// --- M7-03: select, move, edit at the click, callout in one drag -------------

interface Obj {
  id: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
  rectangleDifferences?: { left: number; top: number; right: number; bottom: number };
  calloutLine?: { x: number; y: number }[];
  contents?: string;
  flags?: string[];
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

/** A text comment's box (a callout's without its line), page points. */
function boxOf(o: Obj) {
  const rd = o.rectangleDifferences ?? { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    x: o.rect.origin.x + rd.left,
    y: o.rect.origin.y + rd.top,
    w: o.rect.size.width - rd.left - rd.right,
    h: o.rect.size.height - rd.top - rd.bottom,
  };
}
const centreOf = (o: Obj): [number, number] => {
  const b = boxOf(o);
  return [b.x + b.w / 2, b.y + b.h / 2];
};

/** Makes the comment, types "Hello", and leaves it unselected with the Select tool on. */
async function made(page: Page, c: Case): Promise<{ id: string; obj: Obj }> {
  const id = await open(page);
  await tool(page, c.name);
  await c.make(page);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await written(page, id, ['Hello']);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page, id)).toEqual([]);
  const [obj] = await objects(page, id);
  if (!obj) throw new Error('no comment');
  return { id, obj };
}

/** Numbers after the first `key` array in the saved tail. */
function numbersAfter(tail: string, key: string): number[] {
  const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(tail);
  return m?.[1] ? m[1].trim().split(/\s+/).map(Number) : [];
}

/** The screen box of character `i` of the comment's text. */
async function charBox(page: Page, i: number) {
  return page.evaluate((n) => {
    const span = document.querySelector('[data-text-comment] span[tabindex]');
    const text = span?.firstChild;
    if (!text) return null;
    const r = document.createRange();
    r.setStart(text, n);
    r.setEnd(text, n + 1);
    const b = r.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  }, i);
}

const near = (a: number, b: number) => Math.abs(a - b) < 1.5;

for (const c of CASES) {
  test(`${c.name}: a press selects it, a drag moves it, Delete removes it (B4–B6)${c.name === 'Text Box' ? ' @smoke' : ''}`, async ({
    page,
  }) => {
    const { id, obj } = await made(page, c);
    const [cx, cy] = centreOf(obj);
    // One press and drag on the unselected comment: selected and moved.
    await drag(page, [cx, cy], [cx + 40, cy + 30]);
    await expect
      .poll(async () => {
        const [o] = await objects(page, id);
        return o ? [o.rect.origin.x - obj.rect.origin.x, o.rect.origin.y - obj.rect.origin.y] : [];
      })
      .toEqual([expect.closeTo(40, 0), expect.closeTo(30, 0)]);
    expect(await selected(page, id)).toEqual([obj.id]);
    await written(page, id, ['Hello']);
    const [moved] = await objects(page, id);
    if (obj.calloutLine) {
      // The box and the whole line move together.
      expect(
        moved?.calloutLine?.map((p, i) =>
          [p.x - (obj.calloutLine?.[i]?.x ?? 0), p.y - (obj.calloutLine?.[i]?.y ?? 0)].map(
            Math.round,
          ),
        ),
      ).toEqual(obj.calloutLine.map(() => [40, 30]));
    }
    // Selected, it shows the move pointer; the keys reach it.
    const p = await at(page, cx + 40, cy + 30);
    expect(
      await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x ?? 0, y ?? 0);
          return el ? getComputedStyle(el).cursor : null;
        },
        [p.x, p.y],
      ),
    ).toBe('move');
    await expect(view(page)).toBeFocused();
    // Saved where it was moved to (PDF x is the page x here).
    const tail = await savedTail(page, id);
    expect(near(numbersAfter(tail, 'Rect')[0] ?? NaN, obj.rect.origin.x + 40)).toBe(true);
    if (obj.calloutLine)
      expect(near(numbersAfter(tail, 'CL')[0] ?? NaN, (obj.calloutLine[0]?.x ?? 0) + 40)).toBe(
        true,
      );
    // Delete removes it; Ctrl+Z brings it back where it was moved to.
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await list(page, id)).length).toBe(0);
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await objects(page, id))[0]?.rect.origin.x)
      .toBeCloseTo(obj.rect.origin.x + 40, 0);
  });

  test(`${c.name}: a double-click edits at the clicked character; a drag in the editor selects text`, async ({
    page,
  }) => {
    const { id, obj } = await made(page, c);
    // Between "He" and "llo".
    const ch = await charBox(page, 2);
    if (!ch) throw new Error('no text');
    await page.mouse.move(ch.x + 1, ch.y + ch.h / 2, { steps: 4 });
    await page.mouse.dblclick(ch.x + 1, ch.y + ch.h / 2);
    await expect(editor(page)).toBeFocused();
    await expect.poll(() => selectedText(page)).toBe('');
    await page.keyboard.type('X');
    await expect(editor(page)).toHaveText('HeXllo');
    // A drag inside the editor selects text and leaves the comment in place.
    const first = await charBox(page, 0);
    const third = await charBox(page, 2);
    if (!first || !third) throw new Error('no text');
    await page.mouse.move(first.x + 0.5, first.y + first.h / 2);
    await page.mouse.down();
    await page.mouse.move(third.x + third.w - 0.5, third.y + third.h / 2, { steps: 5 });
    await page.mouse.up();
    expect(await selectedText(page)).toBe('HeX');
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await written(page, id, ['HeXllo']);
    expect((await objects(page, id))[0]?.rect).toEqual(obj.rect);
    // Out of the editor, the keys act on the comment again (B6).
    await expect(view(page)).toBeFocused();
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await list(page, id)).length).toBe(0);
  });
}

test('Enter and F2 edit the selected text comment, with the caret at the end', async ({ page }) => {
  const [box] = CASES;
  if (!box) throw new Error('no case');
  const { id, obj } = await made(page, box);
  await cap(page, 'annotate', 'select', id, 0, obj.id);
  await view(page).focus();
  await page.keyboard.press('F2');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await written(page, id, ['Hello!']);
  // Still selected after Esc: Enter edits it again (not a new text box).
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('?');
  await page.keyboard.press('Escape');
  await written(page, id, ['Hello!?']);
  expect(await list(page, id)).toHaveLength(1);
});

test('Callout: one drag from the point to the box makes the arrow, the knee and the box (B11) @smoke', async ({
  page,
}) => {
  const id = await open(page);
  await tool(page, 'Callout');
  await expect(page.getByTestId('tool-hint')).toHaveText(
    'Drag from the point to the text box position',
  );
  await drag(page, [80, 300], [220, 220]);
  await expect.poll(async () => (await list(page, id)).map((a) => a.type)).toEqual([FREETEXT]);
  // It edits at once, as after the three clicks.
  await expect(editor(page)).toBeFocused();
  expect(await selectedText(page)).toBe('Type here');
  await page.keyboard.type('Check this');
  await page.keyboard.press('Escape');
  await written(page, id, ['Check this']);
  const [o] = await objects(page, id);
  const line = o?.calloutLine ?? [];
  expect(line).toHaveLength(3);
  const [tip, knee, join] = line;
  // The tip where the drag started; the box beside where it ended; the knee before it.
  expect(near(tip?.x ?? NaN, 80) && near(tip?.y ?? NaN, 300)).toBe(true);
  if (!o) throw new Error('no callout');
  const b = boxOf(o);
  expect(near(b.x, 220)).toBe(true);
  expect(near(b.y + b.h / 2, 220)).toBe(true);
  expect(near(join?.x ?? NaN, 220) && near(join?.y ?? NaN, 220)).toBe(true);
  expect(knee?.x).toBeLessThan(220);
  expect(knee?.x).toBeGreaterThan(80);
  expect(near(knee?.y ?? NaN, 220)).toBe(true);
  const tail = await savedTail(page, id);
  expect(numbersAfter(tail, 'CL')).toHaveLength(6);
  // The three clicks still work, with the tool still on.
  await click(page, 420, 330);
  await click(page, 470, 290);
  await click(page, 500, 260);
  await expect.poll(async () => (await list(page, id)).length).toBe(2);
});

test('a locked text comment neither moves nor edits (M6-06)', async ({ page }) => {
  const [box] = CASES;
  if (!box) throw new Error('no case');
  const { id, obj } = await made(page, box);
  await cap(page, 'annotate', 'update', id, 0, obj.id, { flags: ['print', 'locked'] });
  await expect.poll(async () => (await objects(page, id))[0]?.flags).toContain('locked');
  const [cx, cy] = centreOf(obj);
  await drag(page, [cx, cy], [cx + 40, cy + 30]);
  expect(await selected(page, id)).toEqual([obj.id]);
  await page.waitForTimeout(300);
  expect((await objects(page, id))[0]?.rect).toEqual(obj.rect);
  await page.keyboard.press('F2');
  await page.keyboard.press('Enter');
  await dblclick(page, cx, cy);
  await page.waitForTimeout(300);
  await expect(editor(page)).toHaveCount(0);
  expect(await contents(page, id)).toEqual(['Hello']);
});

test('a file that denies annotating: a text comment neither moves nor edits (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf makes the restricted fixture');
  const marked = Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>',
      '<< /Type /Annot /Subtype /FreeText /NM (ft-1) /F 4 /Rect [100 700 300 740] /Contents (Fixed) /DA (/Helv 12 Tf 0 g) >>',
    ]),
  );
  const restricted = qpdfEncrypt(marked, '', 'owner', ['256', '--annotate=n', '--modify=none']);
  await page.goto('/');
  await drop(page, [{ name: 'restricted.pdf', b64: Buffer.from(restricted).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  const [before] = await objects(page, id);
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Select Comments', exact: true }).click();
  // Page y of the box's middle: 842 − 720.
  await drag(page, [200, 122], [240, 152]);
  await page.waitForTimeout(300);
  expect((await objects(page, id))[0]?.rect).toEqual(before?.rect);
  await dblclick(page, 200, 122);
  await view(page).focus();
  await page.keyboard.press('F2');
  await page.waitForTimeout(300);
  await expect(editor(page)).toHaveCount(0);
  expect(await contents(page, id)).toEqual(['Fixed']);
});
