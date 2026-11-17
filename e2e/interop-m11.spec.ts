import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-09: the interop pack §M11 (e2e/interop/CHECKLIST.md §M11, ADR-028 D-52,
// D-55). Text comments in one family of every font group (M11-07), a line of
// engineering symbols drawn from the fallback fonts, a callout and a typewriter
// in library fonts; and a drawing with its pages cropped (O9). Each file is
// saved with Ctrl+S's narrow save, checked here (fonts embedded as subsets, /DS
// names the family, /CropBox written) and reopened. With M11_INTEROP_OUT=1 they
// are written to OUT for the owner's run in Acrobat Reader and PDF-XChange:
// `npm run owner:interop:m11`.

const OUT = 'e2e/fixtures/self-made/m11-interop';
const AUTHOR = 'Triya PDF Interop';
const FREETEXT = 3;
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

interface Obj {
  id: string;
  contents?: string;
  libraryFont?: string;
  commit?: string;
}

function keep(name: string, bytes: Uint8Array): void {
  if (process.env.M11_INTEROP_OUT !== '1') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
}

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
  return id;
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

/** "ABCDEF+Tinos-Regular" → "Tinos-Regular", for every subset font in a saved tail. */
const embedded = (tail: string): string[] =>
  [...tail.matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([!-~]+?)(?=[\s/>])/gu)].map((m) => m[1] ?? '');

const box = (
  i: number,
  font: string,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  type: FREETEXT,
  rect: { origin: { x: 48, y: 130 + i * 62 }, size: { width: 500, height: 44 } },
  contents: text,
  fontFamily: 4,
  libraryFont: font,
  fontSize: 16,
  fontColor: '#1F3A93',
  strokeColor: '#E44234',
  strokeWidth: 1,
  color: 'transparent',
  textAlign: 0,
  verticalAlign: 0,
  ...extra,
});

/** One family of every picker group, in its own script where it has one, plus symbols. */
const COMMENTS: { font: string; ps: string; text: string }[] = [
  { font: 'carlito', ps: 'carlito', text: 'X1 Carlito (as Calibri): Revision C, 42 mm' },
  { font: 'arimo', ps: 'arimo', text: 'X1 Arimo (as Arial): Pump P-101 duty point' },
  { font: 'ibmplexsans', ps: 'ibmplexsans', text: 'X1 IBM Plex Sans: level 2 slab' },
  { font: 'barlowcondensed', ps: 'barlowcondensed', text: 'X1 Barlow Condensed: narrow' },
  { font: 'b612', ps: 'b612', text: 'X1 B612: technical drawing note' },
  { font: 'sourceserif4', ps: 'sourceserif4', text: 'X1 Source Serif 4: specification' },
  { font: 'jetbrainsmono', ps: 'jetbrainsmono', text: 'X1 JetBrains Mono: TAG-0042' },
  { font: 'caveat', ps: 'caveat', text: 'X1 Caveat: check on site' },
  { font: 'notosansdeva', ps: 'notosansdevanagari', text: 'X1 नमस्ते: परियोजना संशोधन' },
  { font: 'notosanssc', ps: 'notosanssc', text: 'X1 中文：二层结构计算' },
  { font: 'carlito', ps: 'notosansmath', text: 'X2 ⌀ 150 ± 0.5 mm, 45°, 10 Ω, 3 m², Δ 2 µm' },
];

test('M11 interop file: text comments in every font group, symbols, saved and reopened', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const original = simplePdf(1);
  const id = await open(page, original, 'fonts.pdf');
  for (const [i, c] of COMMENTS.entries())
    await cap(page, 'annotate', 'create', id, 0, box(i, c.font, c.text));
  await expect
    .poll(async () => {
      const all = await list(page, id);
      return all.length === COMMENTS.length && all.every((a) => a.commit === 'synced');
    })
    .toBe(true);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);

  const { file, tail } = await save(page, id, original);
  const fonts = embedded(tail).map((f) => f.toLowerCase());
  for (const c of COMMENTS)
    expect(
      fonts.some((f) => f.startsWith(c.ps)),
      `${c.ps} in ${fonts.join(', ')}`,
    ).toBe(true);
  expect(tail).toMatch(/\/Subtype\s*\/Type0/u);
  keep('fonts-library__ctrl-s.pdf', file);

  // Reopened: every comment keeps its family.
  await page.goto('/');
  const again = await open(page, file, 'fonts-reopened.pdf');
  await expect.poll(async () => (await objects(page, again)).length).toBe(COMMENTS.length);
  const back = await objects(page, again);
  for (const c of COMMENTS)
    expect(back.find((o) => o.contents === c.text)?.libraryFont, c.text).toBe(c.font);
});

test('M11 interop file: a drawing cropped with Crop Pages, saved as /CropBox', async ({ page }) => {
  await page.goto('/');
  const original = simplePdf(3);
  const id = await open(page, original, 'sheet.pdf');
  await page.getByRole('tab', { name: 'Organize' }).click();
  await page
    .getByRole('toolbar', { name: 'Organize commands' })
    .getByRole('button', { name: 'Crop Pages' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const [side, v] of [
    ['Top', '20'],
    ['Bottom', '20'],
    ['Left', '10'],
    ['Right', '10'],
  ] as const)
    await dialog.getByLabel(side, { exact: true }).fill(v);
  await dialog.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(dialog).toBeHidden();
  const sizes = async (doc: string) =>
    ((await cap(page, 'pages', 'info', doc)) as { w: number; h: number }[]).map((p) => [p.w, p.h]);
  await expect
    .poll(() => sizes(id))
    .toEqual([
      [538, 729],
      [538, 729],
      [538, 729],
    ]);
  const { file, tail } = await save(page, id, original);
  expect(tail.match(/\/CropBox/g)).toHaveLength(3);
  keep('cropped__ctrl-s.pdf', file);
  await page.goto('/');
  const again = await open(page, file, 'cropped.pdf');
  expect(await sizes(again)).toEqual([
    [538, 729],
    [538, 729],
    [538, 729],
  ]);
});
