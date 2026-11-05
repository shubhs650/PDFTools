import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { hasQpdf } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { pickColor } from './support/colors.ts';
import { expect, test } from './support/fixtures.ts';

// M7-12: the interop pack §M7 (e2e/interop/CHECKLIST.md §M7, ADR-023 D-43,
// ADR-024). Text comments made, edited and moved with the mouse and the
// keyboard as a user does — a text box written with Esc, a typewriter, a
// callout drawn in one drag and written by a click elsewhere, each moved by
// a drag on its box and edited again with a double-click, growing to hold its
// text (B15) — and a text box and
// a callout with blue text on a red border, set in the Properties pane. Each
// file is saved with Ctrl+S, checked with qpdf and reopened here. With
// M7_INTEROP_OUT=1 they are written to OUT for the owner's run in Acrobat
// Reader and PDF-XChange. The pack's other §M7 files (sticky note pop-ups,
// default styles, a pasted image) are made by their own specs; `npm run
// owner:interop:m7` runs all of them.

const OUT = 'e2e/fixtures/self-made/m7-interop';
const AUTHOR = 'Triya PDF Interop';
const FREETEXT = 3;
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const tmp = mkdtempSync(join(tmpdir(), 'triya-m7-interop-'));
let seq = 0;

interface Obj {
  id: string;
  type: number;
  intent?: string;
  contents?: string;
  commit?: string;
  fontColor?: string;
  fontFamily?: number;
  strokeColor?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
  rectangleDifferences?: { left: number; top: number; right: number; bottom: number };
  calloutLine?: { x: number; y: number }[];
}

/** qpdf --check: 0 clean, 3 warnings only; 'absent' without qpdf. */
function qpdfStatus(bytes: Uint8Array): number | null | 'absent' {
  if (!hasQpdf()) return 'absent';
  const file = join(tmp, `f${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

function keep(name: string, bytes: Uint8Array): void {
  if (process.env.M7_INTEROP_OUT !== '1') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
}

const view = (page: Page) => page.getByTestId('document-view');
const editor = (page: Page) => page.locator('[data-text-comment] [contenteditable="true"]');
const pane = (page: Page) => page.getByTestId('properties-pane');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Obj[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await cap(page, 'annotate', 'setProfile', AUTHOR);
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  // Fit Page: every page point the test uses is on screen.
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+0');
  return id;
}

/** The comments' text once every comment is written to the Render worker. */
async function written(page: Page, id: string, expected: string[]) {
  await expect
    .poll(async () => {
      const all = await list(page, id);
      return all.every((a) => a.commit === 'synced') ? all.map((a) => a.contents).sort() : null;
    })
    .toEqual([...expected].sort());
}

/** The page's box once the layout has settled (opening a pane re-fits the zoom). */
async function pageBox(page: Page) {
  const content = page.locator('[data-page="0"] .page-content');
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await content.boundingBox());
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
  const box = await content.boundingBox();
  if (!box) throw new Error('page not laid out');
  return box;
}

async function at(page: Page, x: number, y: number) {
  const box = await pageBox(page);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
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

async function tool(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  const b = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

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

async function newest(page: Page, id: string, before: string[]): Promise<Obj> {
  let found: Obj | undefined;
  await expect
    .poll(async () => {
      found = (await objects(page, id)).find((o) => !before.includes(o.id));
      return found?.type;
    })
    .toBe(FREETEXT);
  if (!found) throw new Error('no new comment');
  return found;
}

/** Ctrl+S (narrow, verified) appended to the original; qpdf-checked. */
async function save(page: Page, id: string, original: Uint8Array): Promise<Buffer> {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  const file = Buffer.concat([Buffer.from(original), Buffer.from(s.tail, 'base64')]);
  expect([0, 3, 'absent']).toContain(qpdfStatus(file));
  return file;
}

/**
 * Makes a text comment with its tool, types `text` over the selected
 * "Type here" and leaves the editor with `leave` (Esc or a click elsewhere);
 * then moves it by a drag on its box (dx, dy) and adds `more` after a
 * double-click on it. Returns the comment as saved in the model.
 */
async function makeEditMove(
  page: Page,
  id: string,
  c: {
    tool: string;
    make: () => Promise<void>;
    text: string;
    leave: 'escape' | 'click';
    move: [number, number];
    more: string;
  },
): Promise<Obj> {
  const before = (await objects(page, id)).map((o) => o.id);
  await tool(page, c.tool);
  await c.make();
  const made = await newest(page, id, before);
  // It edits at once with "Type here" selected (B3): the typing replaces it.
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(c.text);
  if (c.leave === 'escape') {
    await page.keyboard.press('Escape'); // B1: Esc keeps the text
  } else {
    await click(page, 560, 820); // B2: a click elsewhere keeps it too
  }
  await expect(editor(page)).toHaveCount(0);
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === made.id)?.contents)
    .toBe(c.text);
  // Back to Select, nothing selected.
  await view(page).focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([]);
  // A press on its box selects it and a drag moves it (B4, B5).
  const now = (await objects(page, id)).find((o) => o.id === made.id) ?? made;
  const [cx, cy] = centreOf(now);
  await drag(page, [cx, cy], [cx + c.move[0], cy + c.move[1]]);
  await expect
    .poll(async () => {
      const o = (await objects(page, id)).find((x) => x.id === made.id);
      return o ? [o.rect.origin.x - now.rect.origin.x, o.rect.origin.y - now.rect.origin.y] : [];
    })
    .toEqual([expect.closeTo(c.move[0], 0), expect.closeTo(c.move[1], 0)]);
  // A double-click edits it again; Ctrl+End puts the caret at the end.
  await dblclick(page, cx + c.move[0], cy + c.move[1]);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(c.more);
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === made.id)?.contents)
    .toBe(c.text + c.more);
  await page.keyboard.press('Escape');
  const done = (await objects(page, id)).find((o) => o.id === made.id);
  if (!done) throw new Error('comment lost');
  return done;
}

test('M7 interop: text comments edited and moved with the mouse (D-43; B1–B5, B11, B15)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const original = simplePdf(1);
  const id = await open(page, original, 'text-comments.pdf');

  const box = await makeEditMove(page, id, {
    tool: 'Text Box',
    make: () => drag(page, [60, 140], [300, 190]),
    text: 'Text box: written with Esc',
    leave: 'escape',
    move: [20, 40],
    more: ', moved, edited again',
  });
  const typewriter = await makeEditMove(page, id, {
    tool: 'Typewriter',
    make: () => click(page, 70, 330),
    text: 'Typewriter: black Courier',
    leave: 'escape',
    move: [30, 30],
    more: ', moved',
  });
  const callout = await makeEditMove(page, id, {
    tool: 'Callout',
    // One drag from the point it marks to where its box goes (B11).
    make: () => drag(page, [80, 560], [260, 470]),
    text: 'Callout: written by a click elsewhere',
    leave: 'click',
    move: [40, -30],
    more: ', moved',
  });
  expect(typewriter.intent).toBe('FreeTextTypeWriter');
  // B15: it grew to hold its one line (32 Courier characters at 10 pt), not cut off.
  expect(typewriter.rect.size.width).toBeGreaterThanOrEqual(32 * 6);
  expect(callout.intent).toBe('FreeTextCallout');
  expect(callout.calloutLine).toHaveLength(3);
  await written(page, id, [
    'Text box: written with Esc, moved, edited again',
    'Typewriter: black Courier, moved',
    'Callout: written by a click elsewhere, moved',
  ]);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);
  const file = await save(page, id, original);
  const tail = file.subarray(original.length).toString('latin1');
  expect(tail).toMatch(/\/Contents\s*\(Callout: written by a click elsewhere, moved\)/);
  expect(tail).toMatch(/\/IT\s*\/FreeTextCallout/);
  expect(tail).toMatch(/\/IT\s*\/FreeTextTypeWriter/);

  // Reopened here: the same text in the same places.
  await page.goto('/');
  const again = await open(page, file, 'text-comments-reopened.pdf');
  await expect.poll(async () => (await objects(page, again)).length).toBe(3);
  const back = await objects(page, again);
  for (const o of [box, typewriter, callout]) {
    const r = back.find((b) => b.contents === o.contents);
    expect(r, o.contents).toBeDefined();
    expect(r?.rect.origin.x).toBeCloseTo(o.rect.origin.x, 0);
    expect(r?.rect.origin.y).toBeCloseTo(o.rect.origin.y, 0);
  }
  keep('text-comments__ctrl-s.pdf', file);
});

test('M7 interop: a text box and a callout with blue text on a red border (ADR-024)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const original = simplePdf(1);
  const id = await open(page, original, 'text-colors.pdf');

  const make = async (name: string, gesture: () => Promise<void>, text: string) => {
    const before = (await objects(page, id)).map((o) => o.id);
    await tool(page, name);
    await gesture();
    const o = await newest(page, id, before);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type(text);
    await page.keyboard.press('Escape');
    await view(page).focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    return o.id;
  };
  const box = await make(
    'Text Box',
    () => drag(page, [60, 140], [320, 190]),
    'Text box: blue text, red border',
  );
  const callout = await make(
    'Callout',
    () => drag(page, [80, 420], [260, 330]),
    'Callout: blue text, red border',
  );

  // The Properties pane: Text color Blue, Border color Red, for each one.
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  await expect(pane(page)).toBeVisible();
  for (const c of [box, callout]) {
    const o = (await objects(page, id)).find((x) => x.id === c);
    if (!o) throw new Error('lost');
    await click(page, ...centreOf(o));
    await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([c]);
    await pickColor(pane(page), 'Text color', 'Blue');
    await pickColor(pane(page), 'Border color', 'Red');
    await expect
      .poll(async () => {
        const x = (await objects(page, id)).find((y) => y.id === c);
        return [x?.fontColor?.toLowerCase(), x?.strokeColor?.toLowerCase()];
      })
      .toEqual(['#0000ff', '#ff0000']);
  }
  await view(page).focus();
  await page.keyboard.press('Escape');
  await written(page, id, ['Text box: blue text, red border', 'Callout: blue text, red border']);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);
  const file = await save(page, id, original);
  // /DA: the border colour (red); /DS: the text colour (blue), as Acrobat writes them (ADR-024).
  const tail = file.subarray(original.length).toString('latin1');
  expect(tail.match(/\/DA\s*\(1\s+0\s+0\s+rg[^)]*\)/g)).toHaveLength(2);
  expect(tail.match(/\/DS\s*\([^)]*color:#0000FF[^)]*\)/g)).toHaveLength(2);

  // Reopened here: both keep blue text on a red border.
  await page.goto('/');
  const again = await open(page, file, 'text-colors-reopened.pdf');
  await expect.poll(async () => (await objects(page, again)).length).toBe(2);
  for (const o of await objects(page, again)) {
    expect(o.fontColor?.toLowerCase(), o.contents).toBe('#0000ff');
    expect(o.strokeColor?.toLowerCase(), o.contents).toBe('#ff0000');
  }
  keep('text-colors__ctrl-s.pdf', file);
});
