import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-07 (D-52, ADR-028 and its S26 amendment; rules 1, 4, 6, 12): the font
// library for text comments. A comment in a family of every picker group is
// drawn with its own embedded font (Type0, from our own origin), saved,
// reopened with its family, flattened, and its text is still found by Find.
// The font list: groups, type-ahead, Recently used, the editor in the face.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const FREETEXT = 3;

interface Obj {
  id: string;
  type: number;
  contents?: string;
  libraryFont?: string;
  fontFamily?: number;
  commit?: string;
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Obj[] | null) ?? [];
const pane = (page: Page) => page.getByTestId('properties-pane');

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** Every comment written to the Render worker. */
async function written(page: Page, id: string, n: number) {
  await expect
    .poll(async () => {
      const all = await list(page, id);
      return all.length === n && all.every((a) => a.commit === 'synced');
    })
    .toBe(true);
}

/** One family of every picker group, with text it draws (its own script where it has one). */
const GROUPS = [
  { group: 'office', font: 'tinos', name: 'Tinos', text: 'Tinos office 42 mm' },
  { group: 'sans', font: 'inter', name: 'Inter', text: 'Inter sans 42 mm' },
  { group: 'narrow', font: 'barlowcondensed', name: 'Barlow Condensed', text: 'Barlow narrow 42' },
  { group: 'technical', font: 'b612', name: 'B612', text: 'B612 technical 42' },
  { group: 'serif', font: 'sourceserif4', name: 'Source Serif 4', text: 'Source serif 42 mm' },
  { group: 'mono', font: 'jetbrainsmono', name: 'JetBrains Mono', text: 'JetBrains mono 42' },
  { group: 'hand', font: 'caveat', name: 'Caveat', text: 'Caveat hand 42 mm' },
  { group: 'hindi', font: 'notosansdeva', name: 'Noto Sans Devanagari', text: 'नमस्ते Hindi 42' },
  { group: 'chinese', font: 'notosanssc', name: 'Noto Sans SC', text: '你好 Chinese 42' },
] as const;

const freeText = (i: number, font: string, text: string) => ({
  type: FREETEXT,
  rect: { origin: { x: 60, y: 50 + i * 82 }, size: { width: 320, height: 56 } },
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
});

/** The fonts embedded in a saved tail: "ABCDEF+Tinos-Regular" → "Tinos-Regular". */
const embedded = (tail: string): string[] =>
  [...tail.matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([!-~]+?)(?=[\s/>])/gu)].map((m) => m[1] ?? '');

test('a comment in every font group: drawn, saved, reopened, flattened, still found by Find @smoke', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (/\.ttf(\?|$)/u.test(r.url())) fontRequests.push(r.url());
  });
  await page.goto('/');
  const original = simplePdf(1);
  const id = await open(page, original, 'fonts.pdf');
  for (const [i, g] of GROUPS.entries())
    await cap(page, 'annotate', 'create', id, 0, freeText(i, g.font, g.text));
  await written(page, id, GROUPS.length);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);

  // Saved: each comment's appearance embeds its family (subset, Type0), and /DS names it.
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  const tail = Buffer.from(s.tail, 'base64').toString('latin1');
  const fonts = embedded(tail).map((f) => f.toLowerCase());
  for (const g of GROUPS) {
    const ps = g.name.replace(/\s/gu, '').toLowerCase();
    expect(
      fonts.some((f) => f.startsWith(ps)),
      `${g.name} in ${fonts.join(', ')}`,
    ).toBe(true);
    const family = g.name.includes(' ') ? `'${g.name}'` : g.name;
    expect(tail).toContain(`font: ${family} 16pt`);
  }
  expect(tail).toMatch(/\/Subtype\s*\/Type0/u);
  expect(tail).toMatch(/\/FontFile2/u);
  // Rule 4: the font files come from our own origin only.
  const origin = new URL(page.url()).origin;
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const u of fontRequests) expect(new URL(u).origin).toBe(origin);

  // Reopened: every comment keeps its family.
  const file = Buffer.concat([Buffer.from(original), Buffer.from(s.tail, 'base64')]);
  await page.goto('/');
  const again = await open(page, file, 'fonts-reopened.pdf');
  await expect.poll(async () => (await objects(page, again)).length).toBe(GROUPS.length);
  const back = await objects(page, again);
  for (const g of GROUPS)
    expect(back.find((o) => o.contents === g.text)?.libraryFont, g.name).toBe(g.font);

  // Flattened, saved and reopened: the text is page content, and Find finds it.
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Flatten Comments' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Flatten Comments' });
  await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await objects(page, again)).length).toBe(0);
  const flat = Buffer.from((await cap(page, 'save', 'saveRewrite', again)) as string, 'base64');
  await page.goto('/');
  const flatId = await open(page, flat, 'fonts-flat.pdf');
  for (const q of [
    'Tinos office',
    'JetBrains mono',
    'Caveat hand',
    'Hindi 42',
    'Chinese 42',
    '你好',
    'नमस्ते',
  ]) {
    const r = (await cap(page, 'search', 'run', flatId, q)) as { summary: { totalHits: number } };
    expect(r.summary.totalHits, q).toBe(1);
  }
});

test('the font list: groups, type-ahead, Recently used; the editor draws in the face; accessible', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const id = await open(page, simplePdf(1), 'picker.pdf');
  const box = (await cap(page, 'annotate', 'create', id, 0, {
    ...freeText(1, '', 'Pick a font'),
  })) as string;
  await written(page, id, 1);
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane', exact: true }).click();
  await cap(page, 'annotate', 'select', id, 0, box);

  const button = pane(page).getByRole('button', { name: 'Font Helvetica' });
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('ArrowDown');
  const listbox = page.getByRole('listbox', { name: 'Font' });
  await expect(listbox).toBeFocused();
  // Standard first, then every group, each name in its own face.
  const groups = await listbox
    .locator('[data-group]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  expect(groups).toEqual([
    'standard',
    'office',
    'sans',
    'narrow',
    'technical',
    'serif',
    'mono',
    'hand',
    'hindi',
    'chinese',
    // Fonts on this computer (M11-08·O5, D-54): Chromium can list them.
    'system',
  ]);
  await expect(listbox.getByRole('option', { name: 'Helvetica' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const { violations } = await new AxeBuilder({ page }).include('.ui-font-popup').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // Type-ahead jumps to the name; Enter chooses it.
  await page.keyboard.type('jetb');
  await expect(listbox.locator('[data-active]')).toHaveAttribute('data-font', 'jetbrainsmono');
  await page.keyboard.press('Enter');
  await expect(listbox).toHaveCount(0);
  await expect.poll(async () => (await objects(page, id))[0]?.libraryFont).toBe('jetbrainsmono');
  // Its /DA fallback is Courier (PDFium's own appearance, other viewers' redraw).
  expect((await objects(page, id))[0]?.fontFamily).toBe(0);
  const chosen = pane(page).getByRole('button', { name: 'Font JetBrains Mono' });
  await expect(chosen).toBeFocused();

  // Recently used heads the list now.
  await page.keyboard.press('Enter');
  await expect(listbox.locator('[data-group="recent"] [data-font="jetbrainsmono"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
  await expect(chosen).toBeFocused();

  // The editor draws the text in the chosen face.
  await written(page, id, 1);
  await page.getByTestId('document-view').focus();
  await cap(page, 'annotate', 'select', id, 0, box);
  await page.keyboard.press('F2');
  const editor = page.locator('[data-text-comment] [contenteditable="true"]');
  await expect(editor).toBeFocused();
  const family = await editor.evaluate((e) => getComputedStyle(e).fontFamily);
  expect(family).toContain('Triya JetBrains Mono');
  await expect
    .poll(() =>
      page.evaluate(() => document.fonts.check('16px "Triya JetBrains Mono"', 'Pick a font')),
    )
    .toBe(true);
});
