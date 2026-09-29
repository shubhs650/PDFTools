import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-20: the interop pack §M3 (e2e/interop/CHECKLIST.md §M3, ADR-001 B16):
// files made by the real app — one per annotation type, replies and review
// states, stamps, measurements with and without scale viewports, and
// encrypted variants — each saved with Ctrl+S (narrow tail, verified) and
// checked with qpdf. With M3_INTEROP_OUT=1 they are written to OUT.

const OUT = 'e2e/fixtures/self-made/m3-interop';
const MM = 72 / 25.4;
const T = {
  TEXT: 1,
  FREETEXT: 3,
  LINE: 4,
  SQUARE: 5,
  CIRCLE: 6,
  POLYGON: 7,
  POLYLINE: 8,
  HIGHLIGHT: 9,
  UNDERLINE: 10,
  SQUIGGLY: 11,
  STRIKEOUT: 12,
  CARET: 14,
  INK: 15,
};
const RED = '#E44234';
const shape = { color: 'transparent', strokeColor: RED, strokeWidth: 2, strokeStyle: 1 };
const rect = (x: number, y: number, w: number, h: number) => ({
  origin: { x, y },
  size: { width: w, height: h },
});

function qpdfCheck(bytes: Buffer): number | null | 'absent' {
  if (!hasQpdf()) return 'absent';
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-m3-interop-')), 'saved.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

function keep(name: string, bytes: Buffer): void {
  if (process.env.M3_INTEROP_OUT !== '1') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
}

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'PDFTools Interop');
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

const count = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as unknown[]).length;

async function save(page: Page, id: string, original: Uint8Array): Promise<Buffer> {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(s).toMatchObject({ mode: 'narrow', fellBack: false });
  const file = Buffer.concat([Buffer.from(original), Buffer.from(s.tail, 'base64')]);
  expect([0, 3, 'absent']).toContain(qpdfCheck(file));
  return file;
}

async function setScale(page: Page, real: string, units: string, decimals: string) {
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Set Scale' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill(real);
  await dialog.getByLabel('Units').selectOption({ label: units });
  await dialog.getByLabel('Decimal places').selectOption({ value: decimals });
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
}

/** A 200 × 100 mm rectangle (EmbedPDF points, top-left) and its measurements. */
async function measurements(page: Page, id: string, x0: number, y0: number, w: number, h: number) {
  const r = [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
  await cap(page, 'annotate', 'measure', id, 0, 'distance', [r[0], r[1]]);
  await cap(page, 'annotate', 'measure', id, 0, 'perimeter', [...r, r[0]]);
  await cap(page, 'annotate', 'measure', id, 0, 'area', r);
}

test('M3 interop: one file per annotation type', async ({ page }) => {
  const original = simplePdf(1);
  const id = await open(page, original, 'types.pdf');
  const make = (obj: Record<string, unknown>) => cap(page, 'annotate', 'create', id, 0, obj);
  await make({ type: T.SQUARE, rect: rect(60, 120, 100, 50), ...shape, contents: 'Square' });
  await make({ type: T.CIRCLE, rect: rect(200, 120, 100, 50), ...shape, contents: 'Oval' });
  await make({
    type: T.LINE,
    rect: rect(56, 196, 208, 18),
    linePoints: { start: { x: 60, y: 200 }, end: { x: 260, y: 210 } },
    lineEndings: { start: 0, end: 5 },
    ...shape,
    contents: 'Arrow',
  });
  await make({
    type: T.POLYLINE,
    rect: rect(56, 236, 208, 48),
    vertices: [
      { x: 60, y: 240 },
      { x: 160, y: 280 },
      { x: 260, y: 240 },
    ],
    ...shape,
    contents: 'Polyline',
  });
  await make({
    type: T.POLYGON,
    rect: rect(296, 196, 108, 88),
    vertices: [
      { x: 300, y: 200 },
      { x: 400, y: 200 },
      { x: 350, y: 280 },
    ],
    ...shape,
    contents: 'Polygon',
  });
  await make({
    type: T.POLYGON,
    rect: rect(420, 190, 130, 100),
    vertices: [
      { x: 430, y: 200 },
      { x: 540, y: 200 },
      { x: 540, y: 280 },
      { x: 430, y: 280 },
    ],
    cloudyBorderIntensity: 2,
    ...shape,
    contents: 'Cloud',
  });
  await make({
    type: T.INK,
    rect: rect(56, 316, 208, 48),
    inkList: [
      {
        points: [
          { x: 60, y: 340 },
          { x: 110, y: 320 },
          { x: 160, y: 360 },
          { x: 260, y: 330 },
        ],
      },
    ],
    strokeColor: RED,
    strokeWidth: 2,
    contents: 'Pencil',
  });
  await make({
    type: T.FREETEXT,
    rect: rect(300, 320, 200, 30),
    contents: 'Text box',
    fontFamily: 4,
    fontSize: 12,
    fontColor: '#000000',
    textAlign: 0,
    verticalAlign: 0,
  });
  await make({
    type: T.TEXT,
    rect: rect(60, 400, 24, 24),
    contents: 'Sticky note',
    strokeColor: '#FFE14D',
  });
  for (const [i, type] of [T.HIGHLIGHT, T.UNDERLINE, T.STRIKEOUT, T.SQUIGGLY].entries()) {
    const box = rect(60 + i * 120, 460, 100, 14);
    await make({
      type,
      rect: box,
      segmentRects: [box],
      strokeColor: type === T.HIGHLIGHT ? '#FFCD45' : RED,
      color: type === T.HIGHLIGHT ? '#FFCD45' : RED,
      contents: ['Highlight', 'Underline', 'Strikeout', 'Squiggly'][i],
    });
  }
  await make({
    type: T.CARET,
    rect: rect(560, 460, 10, 14),
    strokeColor: RED,
    intent: 'Insert',
    contents: 'Inserted text',
  });
  expect(await cap(page, 'annotate', 'stamp', id, 0, 400, 560)).not.toBeNull();
  await expect.poll(() => count(page, id)).toBe(15);
  keep('types__ctrl-s.pdf', await save(page, id, original));
});

test('M3 interop: replies and review states', async ({ page }) => {
  const original = simplePdf(1);
  const id = await open(page, original, 'replies.pdf');
  const root = (await cap(page, 'annotate', 'create', id, 0, {
    type: T.SQUARE,
    rect: rect(60, 120, 200, 80),
    ...shape,
    contents: 'Move the nozzle 50 mm east.',
  })) as string;
  const reply = (parent: string, text: string, author: string) =>
    cap(page, 'annotate', 'create', id, 0, {
      type: T.TEXT,
      rect: rect(60, 120, 24, 24),
      inReplyToId: parent,
      author,
      contents: text,
      flags: ['print', 'noZoom', 'noRotate'],
      strokeColor: '#FFE14D',
    });
  const r1 = (await reply(root, 'Why? It clears the platform.', 'Bo Vendor')) as string;
  await reply(r1, 'It clashes with the ladder.', 'PDFTools Interop');
  for (const [state, author] of [
    ['Rejected', 'Bo Vendor'],
    ['Accepted', 'PDFTools Interop'],
  ] as const)
    await cap(page, 'annotate', 'create', id, 0, {
      type: T.TEXT,
      rect: rect(60, 120, 24, 24),
      inReplyToId: root,
      author,
      state,
      stateModel: 'Review',
      contents: `${state} set by ${author}`,
      flags: ['hidden', 'print', 'noZoom', 'noRotate'],
      strokeColor: '#FFE14D',
    });
  await expect.poll(() => count(page, id)).toBe(5);
  keep('replies-states__ctrl-s.pdf', await save(page, id, original));
});

test('M3 interop: measurements at 1:100, with and without a scale viewport', async ({ page }) => {
  const original = simplePdf(1);
  const id = await open(page, original, 'scaled.pdf');
  await setScale(page, '100', 'Metres', '2');
  await measurements(page, id, 60, 100, 200 * MM, 100 * MM);
  await expect.poll(() => count(page, id)).toBe(6);
  keep('measure-page__ctrl-s.pdf', await save(page, id, original));

  // Detail A 1:5 over the lower right, an 80 × 40 mm plate inside, one line spanning.
  const id2 = await open(page, original, 'detail.pdf');
  await setScale(page, '100', 'Metres', '2');
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page.getByTestId('properties-pane').getByRole('button', { name: 'Add viewport' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scale viewport' });
  for (const [label, v] of [
    ['Left', '300'],
    ['Bottom', '100'],
    ['Right', '560'],
    ['Top', '400'],
    ['Real', '5'],
  ] as const)
    await dialog.getByLabel(label, { exact: true }).fill(v);
  await dialog.getByLabel('Units').selectOption({ label: 'Millimetres' });
  await dialog.getByLabel('Decimal places').selectOption({ value: '1' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  // EmbedPDF y = 842 − user y: the plate at user (320…, 150…) is y 612… from the top.
  await measurements(page, id2, 320, 842 - 150 - 40 * MM, 80 * MM, 40 * MM);
  await cap(page, 'annotate', 'measure', id2, 0, 'distance', [
    { x: 100, y: 500 },
    { x: 330, y: 650 },
  ]);
  await expect.poll(() => count(page, id2)).toBe(8);
  keep('measure-viewport__ctrl-s.pdf', await save(page, id2, original));
});

for (const [name, args] of [
  ['aes256', ['256']],
  ['rc4-128', ['128', '--use-aes=n']],
] as const)
  test(`M3 interop: encrypted (${name}) with a stamp and measurements`, async ({ page }) => {
    test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
    const original = qpdfEncrypt(simplePdf(1), '', 'owner', [...args]);
    const id = await open(page, original, `enc-${name}.pdf`);
    await setScale(page, '100', 'Metres', '2');
    await measurements(page, id, 60, 100, 200 * MM, 100 * MM);
    expect(await cap(page, 'annotate', 'stamp', id, 0, 400, 560)).not.toBeNull();
    await expect.poll(() => count(page, id)).toBe(7);
    keep(`encrypted-${name}__ctrl-s.pdf`, await save(page, id, original));
  });
