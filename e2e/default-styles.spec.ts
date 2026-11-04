import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-03 (ADR-021 D-37, beta review B6): new comments are red, 10 pt text and
// 1 pt lines and borders, no fill; highlight and sticky note stay yellow. Read
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
  contents?: string;
}

const T = { TEXT: 1, FREETEXT: 3, LINE: 4, SQUARE: 5, CIRCLE: 6, POLYGON: 7, POLYLINE: 8, INK: 15 };

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
    for (const o of free) {
      expect(o.fontColor?.toUpperCase(), o.intent).toBe(RED);
      expect(o.fontSize, o.intent).toBe(10);
    }
    const box = free.find((o) => !o.intent);
    const callout = free.find((o) => o.intent === 'FreeTextCallout');
    const typewriter = free.find((o) => o.intent === 'FreeTextTypeWriter');
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
  for (const o of texts) {
    expect(o).toMatch(/\/DA\s*\([^)]*\b10(\.0+)?\s+Tf/);
    expect(o).toMatch(/\/DA\s*\([^)]*\b1(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+rg/);
  }
  expect(texts.filter((o) => /\/IT\s*\/FreeTextTypeWriter\b/.test(o))).toHaveLength(1);
  expect(texts.filter((o) => /\/IT\s*\/FreeTextCallout\b/.test(o))).toHaveLength(1);

  const file = Buffer.concat([Buffer.from(bytes), Buffer.from(saved.tail, 'base64')]);
  await drop(page, [{ name: 'saved.pdf', b64: file.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, again)).length).toBe(SHAPES.length + 3);
  check(await objects(page, again));
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
  const note = page.getByRole('dialog', { name: 'Note' });
  await note.getByLabel('Note text').fill('Yellow');
  await page.keyboard.press('Enter');
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
