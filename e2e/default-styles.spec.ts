import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-03 (ADR-021 D-37, beta review B6): new comments are red, 10 pt text and
// 1 pt lines and borders, no fill; highlight and sticky note stay yellow.
// M7-07 (D-37 amendment): the typewriter writes black Courier, and the three
// highlights (Highlight, Highlight Area, Free Highlight) are 50 % opaque. Read
// back from the saved file (/C, /BS /W, /DA) and from the reopened file
// (PDFium). The user's own defaults persist in IndexedDB and Clear all local
// data resets them.

interface Obj {
  id: string;
  type: number;
  intent?: string;
  strokeColor?: string;
  color?: string;
  fontColor?: string;
  fontSize?: number;
  strokeWidth?: number;
  opacity?: number;
  fontFamily?: number;
  blendMode?: number;
  contents?: string;
}

const T = {
  TEXT: 1,
  FREETEXT: 3,
  LINE: 4,
  SQUARE: 5,
  CIRCLE: 6,
  POLYGON: 7,
  POLYLINE: 8,
  HIGHLIGHT: 9,
  INK: 15,
};
/** PdfStandardFont.Courier. */
const COURIER = 0;

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array): Promise<string> {
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'styles.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await expect.poll(() => cap(page, 'annotate', 'toolDefaultsLoaded')).toBe(true);
  return id;
}

/** Screen point of a page point (top-left origin) on page 1. */
async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 8) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function clicks(page: Page, pts: [number, number][]) {
  for (const [i, p] of pts.entries()) {
    const s = await at(page, ...p);
    await page.mouse.move(s.x, s.y, { steps: 5 });
    if (i === pts.length - 1) await page.mouse.dblclick(s.x, s.y);
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

/** Esc out of any text being edited and back to the Select tool. */
async function done(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');
}

const SHAPES: { name: string; type: number; draw: (p: Page) => Promise<void> }[] = [
  { name: 'Rectangle', type: T.SQUARE, draw: (p) => drag(p, [40, 40], [140, 100]) },
  { name: 'Oval', type: T.CIRCLE, draw: (p) => drag(p, [180, 40], [280, 100]) },
  { name: 'Line', type: T.LINE, draw: (p) => drag(p, [320, 40], [420, 100]) },
  { name: 'Arrow', type: T.LINE, draw: (p) => drag(p, [440, 40], [540, 100]) },
  { name: 'Pencil', type: T.INK, draw: (p) => drag(p, [40, 160], [140, 220], 20) },
  {
    name: 'Polyline',
    type: T.POLYLINE,
    draw: (p) =>
      clicks(p, [
        [180, 160],
        [230, 220],
        [280, 160],
      ]),
  },
  {
    name: 'Polygon',
    type: T.POLYGON,
    draw: (p) =>
      clicks(p, [
        [320, 160],
        [370, 220],
        [420, 160],
      ]),
  },
  {
    name: 'Cloud',
    type: T.POLYGON,
    draw: (p) =>
      clicks(p, [
        [440, 160],
        [490, 230],
        [540, 160],
      ]),
  },
];

const RED = '#FF0000';
/** Where M7-07's screenshots go (unset: none). */
const SHOTS = process.env.M7_07_SHOTS;

test('each tool makes red comments: 1 pt lines and borders, 10 pt text; saved and reopened @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const bytes = simplePdf(1);
  const id = await open(page, bytes);

  for (const [i, s] of SHAPES.entries()) {
    await tool(page, s.name);
    await s.draw(page);
    await expect.poll(async () => (await objects(page, id)).length).toBe(i + 1);
    await done(page);
  }
  // Kept above y = 350 pt: at fit width the rest of page 1 is below the 800 px window.
  // Text box: a click on the page. Callout: arrow tip, knee, then the box.
  await tool(page, 'Text Box');
  const tb = await at(page, 40, 280);
  await page.mouse.click(tb.x, tb.y);
  await expect.poll(async () => (await objects(page, id)).length).toBe(SHAPES.length + 1);
  await done(page);
  await tool(page, 'Callout');
  for (const [x, y] of [
    [250, 340],
    [320, 300],
    [440, 290],
  ] as const) {
    const p = await at(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 5 });
    await page.mouse.click(p.x, p.y);
  }
  await expect.poll(async () => (await objects(page, id)).length).toBe(SHAPES.length + 2);
  await done(page);
  // Typewriter: its own button since M6-08.
  await tool(page, 'Typewriter');
  const tw = await at(page, 40, 330);
  await page.mouse.click(tw.x, tw.y);
  await expect.poll(async () => (await objects(page, id)).length).toBe(SHAPES.length + 3);
  await done(page);

  const check = (all: Obj[]) => {
    const free = all.filter((o) => o.type === T.FREETEXT);
    const shapes = all.filter((o) => o.type !== T.FREETEXT);
    expect(shapes.map((o) => o.type).sort()).toEqual(SHAPES.map((s) => s.type).sort());
    for (const o of shapes) {
      expect(o.strokeColor?.toUpperCase(), `type ${String(o.type)}`).toBe(RED);
      expect(o.strokeWidth, `type ${String(o.type)}`).toBe(1);
      if (o.type !== T.INK) expect(o.color ?? 'transparent').toBe('transparent');
    }
    expect(free).toHaveLength(3);
    for (const o of free) expect(o.fontSize, o.intent).toBe(10);
    const box = free.find((o) => !o.intent);
    const callout = free.find((o) => o.intent === 'FreeTextCallout');
    const typewriter = free.find((o) => o.intent === 'FreeTextTypeWriter');
    for (const o of [box, callout]) expect(o?.fontColor?.toUpperCase()).toBe(RED);
    // M7-07: black Courier.
    expect(typewriter?.fontColor?.toUpperCase()).toBe('#000000');
    expect(typewriter?.fontFamily).toBe(COURIER);
    for (const o of [box, callout]) {
      expect(o?.strokeColor?.toUpperCase()).toBe(RED);
      expect(o?.strokeWidth).toBe(1);
    }
    expect(typewriter?.strokeWidth ?? 0).toBe(0);
  };
  check(await objects(page, id));

  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  // Eight lines and shapes with a red /C and a 1 pt border; three FreeTexts at 10 pt.
  const annots = tail.split(/\bendobj\b/).filter((o) => /\/Type\s*\/Annot\b/.test(o));
  const shapes = annots.filter((o) =>
    /\/Subtype\s*\/(Square|Circle|Line|Ink|PolyLine|Polygon)\b/.test(o),
  );
  expect(shapes).toHaveLength(SHAPES.length);
  for (const o of shapes) {
    expect(o).toMatch(/\/C\s*\[\s*1(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s*\]/);
    expect(o).toMatch(/\/BS\s*<<[^>]*\/W\s+1(\.0+)?\b/);
    expect(o).toMatch(/\/AP\s*<<\s*\/N/);
  }
  const texts = annots.filter((o) => /\/Subtype\s*\/FreeText\b/.test(o));
  expect(texts).toHaveLength(3);
  for (const o of texts) expect(o).toMatch(/\/DA\s*\([^)]*\b10(\.0+)?\s+Tf/);
  const typed = texts.filter((o) => /\/IT\s*\/FreeTextTypeWriter\b/.test(o));
  expect(typed).toHaveLength(1);
  for (const o of texts.filter((x) => !typed.includes(x)))
    expect(o).toMatch(/\/DA\s*\([^)]*\b1(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+rg/);
  // The typewriter: the standard Courier in black. PDFium names the font
  // resource /FXF_Courier in /DA (as /FXF_Helvetica for a text box) and writes
  // "font: Courier" in /DS; the appearance's font is /BaseFont /Courier.
  expect(typed[0]).toMatch(/\/DA\s*\([^)]*\/\w*Cour\w*\s+10(\.0+)?\s+Tf[^)]*\)/);
  expect(typed[0]).toMatch(/\/DS\s*\([^)]*font:\s*Courier\b/);
  expect(tail).toMatch(/\/BaseFont\s*\/Courier\b/);
  expect(typed[0]).toMatch(
    /\/DA\s*\([^)]*(\b0(\.0+)?\s+g\b|\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+rg)/,
  );
  expect(texts.filter((o) => /\/IT\s*\/FreeTextCallout\b/.test(o))).toHaveLength(1);

  const file = Buffer.concat([Buffer.from(bytes), Buffer.from(saved.tail, 'base64')]);
  await drop(page, [{ name: 'saved.pdf', b64: file.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, again)).length).toBe(SHAPES.length + 3);
  check(await objects(page, again));
});

// Also the owner's interop file (e2e/interop/CHECKLIST.md §M7 U): with
// M7_INTEROP_OUT=1 it is written to e2e/fixtures/self-made/m7-interop/.
test('Highlight, Highlight Area and Free Highlight are 50 % opaque: saved /CA 0.5 and reopened (M7-07) @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  // Highlight: a drag over "Page 1" (72, 740; 36 pt) with the tool on.
  await tool(page, 'Highlight');
  await drag(page, [66, 90], [190, 90]);
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  await done(page);
  await tool(page, 'Highlight Area');
  await drag(page, [300, 150], [420, 200]);
  await expect.poll(async () => (await objects(page, id)).length).toBe(2);
  await done(page);
  await tool(page, 'Free Highlight');
  await drag(page, [60, 220], [240, 250], 20);
  await expect.poll(async () => (await objects(page, id)).length).toBe(3);
  await done(page);
  // And a typewriter (black Courier) for the interop file.
  await tool(page, 'Typewriter');
  const tw = await at(page, 300, 90);
  await page.mouse.click(tw.x, tw.y);
  await page.keyboard.type('Typewriter: black Courier');
  await done(page);
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.type === T.FREETEXT)?.contents)
    .toBe('Typewriter: black Courier');
  // The page tiles overlap by a few pixels; the half-transparent area shows no
  // darker seam where they meet (it crosses a column and a row seam here).
  const a = await at(page, 304, 154);
  const b = await at(page, 416, 196);
  const shot = await page.screenshot({
    clip: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y },
  });
  const spread = await page.evaluate(
    async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      if (!g) return 255;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i + 2] ?? 0; // blue: what the yellow takes away
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  );
  expect(spread).toBeLessThanOrEqual(4);

  const check = (all: Obj[]) => {
    const hl = all.find((o) => o.type === T.HIGHLIGHT);
    const area = all.find((o) => o.type === T.SQUARE);
    const free = all.find((o) => o.type === T.INK);
    expect(hl?.opacity).toBeCloseTo(0.5, 2);
    expect(hl?.strokeColor?.toUpperCase()).toBe('#FFE14D');
    expect(area?.opacity).toBeCloseTo(0.5, 2);
    expect(area?.strokeWidth).toBe(0);
    expect(area?.color?.toUpperCase()).toBe('#FFE14D');
    expect(free?.opacity).toBeCloseTo(0.5, 2);
    expect(free?.strokeWidth).toBe(14);
    expect(free?.strokeColor?.toUpperCase()).toBe('#FFCD45');
    const typewriter = all.find((o) => o.type === T.FREETEXT);
    expect(typewriter?.fontColor?.toUpperCase()).toBe('#000000');
    expect(typewriter?.fontFamily).toBe(COURIER);
  };
  check(await objects(page, id));

  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  const annots = tail.split(/\bendobj\b/).filter((o) => /\/Type\s*\/Annot\b/.test(o));
  const marks = annots.filter((o) => /\/Subtype\s*\/(Highlight|Square|Ink)\b/.test(o));
  expect(marks).toHaveLength(3);
  // PDFium keeps the alpha as a byte: 128 / 255 = .50196.
  for (const o of marks) expect(o).toMatch(/\/CA\s+0?\.50\d*\b/);

  const file = Buffer.concat([Buffer.from(bytes), Buffer.from(saved.tail, 'base64')]);
  await drop(page, [{ name: 'saved.pdf', b64: file.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, again)).length).toBe(4);
  check(await objects(page, again));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-page-highlights-typewriter-1280.png` });
  if (process.env.M7_INTEROP_OUT === '1') {
    const out = 'e2e/fixtures/self-made/m7-interop';
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'default-styles__ctrl-s.pdf'), file);
  }
});

test('the sticky note stays yellow (highlight: tests/annotate/toolDefaults.test.ts)', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1));
  expect(((await cap(page, 'annotate', 'toolDefaults', 'textComment')) as Obj).strokeColor).toBe(
    '#FFCD45',
  );
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('n');
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'textComment');
  await page.keyboard.press('Enter');
  // The note's window opens, the caret in its text (M7-06); Ctrl+Enter saves.
  const note = page.getByRole('dialog', { name: /^Sticky note by / });
  await expect(note.getByRole('textbox', { name: 'Note text' })).toBeFocused();
  await page.keyboard.type('Yellow');
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => (await objects(page, id)).map((o) => o.type)).toEqual([T.TEXT]);
  expect((await objects(page, id))[0]?.strokeColor?.toUpperCase()).toBe('#FFCD45');
});

test('the user’s own default applies to the next comment, survives a reload, and Clear all local data resets it', async ({
  page,
}) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
  await page.goto('/');
  let id = await open(page, simplePdf(1));
  await cap(page, 'annotate', 'setToolDefaults', 'square', {
    strokeColor: '#0000FF',
    strokeWidth: 3,
  });
  await expect
    .poll(async () => (await cap(page, 'annotate', 'toolDefaults', 'square')) as Obj)
    .toMatchObject({ strokeColor: '#0000FF', strokeWidth: 3 });
  // The other tools keep the shipped defaults.
  expect(await cap(page, 'annotate', 'toolDefaults', 'circle')).toMatchObject({
    strokeColor: RED,
    strokeWidth: 1,
  });

  await page.reload();
  id = await open(page, simplePdf(1));
  await tool(page, 'Rectangle');
  await drag(page, [40, 40], [140, 100]);
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  expect((await objects(page, id))[0]).toMatchObject({ strokeColor: '#0000FF', strokeWidth: 3 });
  await done(page);

  // The Privacy page lists the store; Settings → Clear all local data resets it.
  const backstage = page.getByTestId('backstage');
  const section = async (name: string) => {
    if (!(await backstage.isVisible())) await page.getByTestId('file-tab').click();
    await backstage.getByRole('button', { name, exact: true }).click();
    await expect(backstage.getByRole('heading', { name, exact: true })).toBeVisible();
  };
  await section('Privacy');
  const table = backstage
    .getByTestId('privacy')
    .getByRole('table', { name: 'Data Triya PDF keeps on this device' });
  await expect(table.getByRole('cell', { name: /pdftools › toolDefaults/ })).toBeVisible();
  await section('Settings');
  await backstage.getByRole('button', { name: 'Clear all local data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(backstage.getByTestId('local-data').getByRole('status')).toHaveText(
    'Local data cleared.',
  );
  // At once for the open document's tools, too.
  await expect
    .poll(async () => (await cap(page, 'annotate', 'toolDefaults', 'square')) as Obj)
    .toMatchObject({ strokeColor: RED, strokeWidth: 1 });
  await page.keyboard.press('Escape');

  await page.reload();
  await open(page, simplePdf(1));
  expect(await cap(page, 'annotate', 'toolDefaults', 'square')).toMatchObject({
    strokeColor: RED,
    strokeWidth: 1,
  });
});

/** Writes records straight into the app's IndexedDB store (as an older version left them). */
async function seed(page: Page, store: string, records: Record<string, unknown>) {
  await page.evaluate(
    async ([name, recs]) => {
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const req = indexedDB.open('pdftools');
        req.onsuccess = () => {
          ok(req.result);
        };
        req.onerror = () => {
          fail(req.error ?? new Error('open'));
        };
      });
      await new Promise<void>((ok, fail) => {
        const tx = db.transaction(name, 'readwrite');
        for (const [k, v] of Object.entries(recs)) tx.objectStore(name).put(v, k);
        tx.oncomplete = () => {
          ok();
        };
        tx.onerror = () => {
          fail(tx.error ?? new Error('tx'));
        };
      });
      db.close();
    },
    [store, records] as const,
  );
}

interface Stored {
  id: string;
  name: string;
  props: Record<string, unknown>;
  preset?: string;
}

test('M7-07: v2 highlight presets move to 50 %, the user’s own values stay; the window shows the new defaults and Reset All restores them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  // The app has made its database; then put in what M6-17 … M7-06 stored.
  await open(page, simplePdf(1));
  const tints: [string, string][] = [
    ['red', '#FF9C9C'],
    ['purple', '#E2A6F0'],
    ['indigo', '#B6A8F5'],
    ['blue', '#9CCBFF'],
    ['green', '#A4EBA4'],
    ['yellow', '#FFE14D'],
  ];
  const v2 = tints.map(([preset, hex]) => ({
    id: `preset:${preset}`,
    name: '',
    // The user made Purple fully opaque; the rest are as v2 shipped them.
    props: { strokeColor: hex, color: hex, ...(preset === 'purple' ? { opacity: 1 } : {}) },
    preset,
  }));
  await seed(page, 'commentStyles', { highlight: { v: 2, styles: v2 } });
  // The user's own Highlight Area default: 80 %.
  await seed(page, 'toolDefaults', { highlightArea: { v: 1, props: { opacity: 0.8 } } });
  await page.reload();
  await open(page, simplePdf(1));

  const styles = async () =>
    ((await cap(page, 'annotate', 'commentStyles')) as Record<string, Stored[] | undefined>)
      .highlight ?? [];
  await expect
    .poll(async () => (await styles()).map((s) => [s.preset, s.props.opacity]))
    .toEqual([
      ['red', 0.5],
      ['purple', 1],
      ['indigo', 0.5],
      ['blue', 0.5],
      ['green', 0.5],
      ['yellow', 0.5],
    ]);
  const styleOf = async (t: string) =>
    (await cap(page, 'annotate', 'styleOf', t)) as Record<string, unknown>;
  expect(await styleOf('highlight')).toMatchObject({ opacity: 0.5 });
  expect(await styleOf('inkHighlighter')).toMatchObject({ opacity: 0.5 });
  expect(await styleOf('highlightArea')).toMatchObject({ opacity: 0.8 });
  expect(await styleOf('typewriter')).toMatchObject({ fontColor: '#000000', fontFamily: COURIER });

  // The Comment Styles Palette window shows them.
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page.getByRole('button', { name: 'Highlight styles', exact: true }).click();
  const menu = page.getByRole('menu', { name: /styles$/ });
  await expect(menu.locator('[data-current]')).toHaveAttribute('aria-label', 'Yellow');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-highlight-palette-1366.png` });
  await menu.getByRole('menuitem', { name: 'Comment Styles Palette…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Comment Styles Palette' });
  await expect(dialog).toBeVisible();
  const tools = dialog.getByRole('listbox', { name: 'Comment tools' });
  const props = dialog.getByTestId('style-properties');
  await expect(props.getByLabel('Opacity')).toHaveValue('50');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-window-highlight-50-1366.png` });
  await tools.getByRole('option', { name: 'Highlight Area', exact: true }).click();
  await expect(props.getByLabel('Opacity')).toHaveValue('80');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-window-highlight-area-user-80-1366.png` });
  await tools.getByRole('option', { name: 'Typewriter', exact: true }).click();
  await expect(props.getByLabel('Font', { exact: true })).toHaveValue('courier');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-window-typewriter-1366.png` });

  // Reset All: the shipped 50 % again, and Purple back to its preset.
  await dialog.getByRole('button', { name: 'Reset All' }).click();
  await page
    .getByRole('dialog', { name: 'Reset all comment styles?' })
    .getByRole('button', { name: 'Reset All' })
    .click();
  await expect.poll(() => styleOf('highlightArea')).toMatchObject({ opacity: 0.5 });
  await expect
    .poll(async () => (await styles()).find((s) => s.preset === 'purple')?.props.opacity)
    .toBe(0.5);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // The typewriter's ribbon palette marks Black as current.
  await page.getByRole('button', { name: 'Typewriter styles', exact: true }).click();
  await expect(
    page.getByRole('menu', { name: /styles$/ }).locator('[data-current]'),
  ).toHaveAttribute('aria-label', 'Black');
  await page.keyboard.press('Escape');
});
