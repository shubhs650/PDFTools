import { inflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M7-05 (ADR-023 D-43 e; review 4b-v; bug B10): while a text box, typewriter
// or callout is being edited, a right click in it (or Shift+F10, the Menu
// key) opens our text menu, not the browser's. Undo/Redo use the editor's own
// history; Cut/Copy/Paste the system clipboard as plain text; Delete and
// Select All act on the editor's selection; Text Style (font, size, bold,
// italic, colour, alignment) changes the whole comment and is saved (/DA,
// /Q); Properties opens the pane. Focus returns to the editor.

interface Listed {
  id: string;
  contents: string | null;
  commit: string;
}

interface Obj {
  id: string;
  contents?: string;
  fontFamily?: number;
  fontSize?: number;
  fontColor?: string;
  strokeColor?: string;
  textAlign?: number;
}

const view = (page: Page) => page.getByTestId('document-view');
const editor = (page: Page) => page.locator('[data-text-comment] [contenteditable="true"]');
const menu = (page: Page) => page.getByRole('menu', { name: 'Text', exact: true });
const item = (page: Page, name: string) => page.getByRole('menuitem', { name, exact: true });
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '');

async function written(page: Page, id: string, expected: string[]) {
  await expect
    .poll(async () => {
      const all = await list(page, id);
      return all.every((a) => a.commit === 'synced') ? all.map((a) => a.contents) : null;
    })
    .toEqual(expected);
}

async function open(page: Page, context: BrowserContext): Promise<string> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
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

async function click(page: Page, x: number, y: number, button: 'left' | 'right' = 'left') {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.click(p.x, p.y, { button });
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
  await page.getByRole('tab', { name: 'Comment' }).click();
  const b = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** The (inflated) content streams of a saved tail. */
function streams(tail: Buffer): string[] {
  const out: string[] = [];
  const text = tail.toString('latin1');
  for (const m of text.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const raw = Buffer.from(m[1] ?? '', 'latin1');
    try {
      out.push(inflateSync(raw).toString('latin1'));
    } catch {
      out.push(raw.toString('latin1'));
    }
  }
  return out;
}

interface Case {
  name: string;
  make: (p: Page) => Promise<void>;
  /** A page point inside its text. */
  text: [number, number];
}

const CASES: Case[] = [
  { name: 'Text Box', make: (p) => drag(p, [100, 100], [300, 140]), text: [130, 112] },
  { name: 'Typewriter', make: (p) => click(p, 160, 120), text: [170, 120] },
  {
    name: 'Callout',
    make: async (p) => {
      await click(p, 80, 300);
      await click(p, 140, 240);
      await drag(p, [180, 200], [360, 240]);
    },
    text: [200, 212],
  },
];

for (const c of CASES) {
  test(`${c.name}: a right click in the text opens the text menu; its edit items act on the editor${c.name === 'Text Box' ? ' @smoke' : ''}`, async ({
    page,
    context,
  }) => {
    const id = await open(page, context);
    await tool(page, c.name);
    await c.make(page);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Hello world');

    // A right click in the text: our menu, with the keys shown.
    await click(page, ...c.text, 'right');
    await expect(menu(page)).toBeVisible();
    await expect(item(page, 'Undo')).toContainText('Ctrl+Z');
    await expect(item(page, 'Cut')).toContainText('Ctrl+X');
    await expect(item(page, 'Select All')).toContainText('Ctrl+A');
    await expect(item(page, 'Text Style')).toBeVisible();
    await expect(item(page, 'Properties')).toBeVisible();
    // Nothing selected (the click put the caret in the text): no Cut, Copy or Delete.
    await expect(item(page, 'Copy')).toHaveAttribute('aria-disabled', 'true');
    // Select All, then Copy: the clipboard has the text; the editor the focus.
    await item(page, 'Select All').click();
    await expect(menu(page)).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    expect(await selectedText(page)).toBe('Hello world');
    await click(page, ...c.text, 'right');
    await item(page, 'Copy').click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('Hello world');
    // Delete empties it; Undo brings it back; Redo empties it again.
    await click(page, ...c.text, 'right');
    // The right click inside the selection keeps it.
    await item(page, 'Delete').click();
    await expect(editor(page)).toHaveText('');
    await click(page, ...c.text, 'right');
    await item(page, 'Undo').click();
    await expect(editor(page)).toHaveText('Hello world');
    await click(page, ...c.text, 'right');
    await item(page, 'Redo').click();
    await expect(editor(page)).toHaveText('');
    // Paste: plain text from the clipboard, at the caret.
    await page.evaluate(() => navigator.clipboard.writeText('Pasted note'));
    await click(page, ...c.text, 'right');
    await item(page, 'Paste').click();
    await expect(editor(page)).toHaveText('Pasted note');
    // Cut: selected text to the clipboard, gone from the editor.
    await page.keyboard.press('Shift+Home');
    await click(page, ...c.text, 'right');
    await item(page, 'Cut').click();
    await expect(editor(page)).toHaveText('');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('Pasted note');
    await page.keyboard.type('Kept');
    // Still editing all along: Esc writes it once.
    await page.keyboard.press('Escape');
    await written(page, id, ['Kept']);
  });
}

/** Opens Text Style ▸ (and a submenu of it) from a right click in the text. */
async function textStyle(page: Page, c: Case, sub?: string) {
  await click(page, ...c.text, 'right');
  await item(page, 'Text Style').hover();
  const style = page.getByRole('menu', { name: 'Text Style' });
  await expect(style).toBeVisible();
  if (!sub) return style;
  await style.getByRole('menuitem', { name: sub, exact: true }).hover();
  const m = page.getByRole('menu', { name: sub, exact: true });
  await expect(m).toBeVisible();
  return m;
}

test('Text Style: font, size, bold, italic, colour and alignment for the whole comment, saved as /DA and /Q and read back @smoke', async ({
  page,
  context,
}) => {
  const id = await open(page, context);
  const [c] = CASES;
  if (!c) throw new Error('no case');
  await tool(page, c.name);
  await c.make(page);
  await page.keyboard.type('Revised per RFI 12');
  const style = async () => (await objects(page, id))[0];

  // The current style is ticked: Helvetica, 12 pt? (the tool's defaults), left.
  const fonts = await textStyle(page, c, 'Font');
  await expect(fonts.getByRole('menuitemradio', { name: 'Helvetica' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await fonts.getByRole('menuitemradio', { name: 'Courier' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await expect.poll(async () => (await style())?.fontFamily).toBe(0); // Courier

  const sizes = await textStyle(page, c, 'Size');
  await sizes.getByRole('menuitemradio', { name: '18 pt' }).click();
  await expect.poll(async () => (await style())?.fontSize).toBe(18);

  const s1 = await textStyle(page, c);
  await s1.getByRole('menuitemcheckbox', { name: 'Bold' }).click();
  await expect.poll(async () => (await style())?.fontFamily).toBe(1); // Courier-Bold
  const s2 = await textStyle(page, c);
  await expect(s2.getByRole('menuitemcheckbox', { name: 'Bold' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await s2.getByRole('menuitemcheckbox', { name: 'Italic' }).click();
  await expect.poll(async () => (await style())?.fontFamily).toBe(2); // Courier-BoldOblique (PdfStandardFont)

  const colors = await textStyle(page, c, 'Text Color');
  // New text comments are red (D-37): blue is a change.
  await expect(colors.getByRole('menuitemradio', { name: 'Red', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await colors.getByRole('menuitemradio', { name: 'Blue', exact: true }).click();
  await expect.poll(async () => (await style())?.fontColor?.toLowerCase()).toBe('#0000ff');

  const s3 = await textStyle(page, c);
  await s3.getByRole('menuitemradio', { name: 'Align Center' }).click();
  await expect.poll(async () => (await style())?.textAlign).toBe(1);

  // The typed text was never lost, and the editor kept the focus.
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveText('Revised per RFI 12');
  await page.keyboard.press('Escape');
  await written(page, id, ['Revised per RFI 12']);

  // Saved: /DA has the font, size and the border colour, /DS the text colour, /Q the alignment.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(saved.mode).toBe('narrow');
  const tailBytes = Buffer.from(saved.tail, 'base64');
  const tail = tailBytes.toString('latin1');
  expect(tail).toMatch(/\/DA\s*\([^)]*18(\.0+)?\s+Tf[^)]*\)/);
  // The border keeps its red (/DA, as Acrobat reads it); the text colour is in /DS (ADR-024).
  expect(tail).toMatch(/\/DA\s*\([^)]*1(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+rg[^)]*\)/);
  expect(tail).toMatch(/\/DS\s*\([^)]*color:#0000FF[^)]*\)/);
  // The appearance draws the text blue (PDFium's own, its text colour changed).
  const drawn = streams(tailBytes).filter((t) => t.includes('(Revised per RFI 12) Tj'));
  expect(drawn.some((t) => /BT\s+0\s+0\s+1\s+rg/.test(t))).toBe(true);
  expect(tail).toMatch(/\/Q\s*1/);

  // Read back from the saved file.
  const full = Buffer.concat([Buffer.from(simplePdf(2)), tailBytes]);
  await drop(page, [{ name: 'reopened.pdf', b64: full.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, again)).length).toBe(1);
  expect((await objects(page, again))[0]).toMatchObject({
    contents: 'Revised per RFI 12',
    fontFamily: 2,
    fontSize: 18,
    textAlign: 1,
  });
  expect((await objects(page, again))[0]?.fontColor?.toLowerCase()).toBe('#0000ff');
  expect((await objects(page, again))[0]?.strokeColor?.toLowerCase()).toBe('#ff0000');
});

test('keyboard: Shift+F10 and the Menu key open it at the caret; arrows, Enter and Esc; focus back in the editor; axe clean', async ({
  page,
  context,
}) => {
  const id = await open(page, context);
  await tool(page, 'Text Box');
  await drag(page, [100, 100], [300, 140]);
  await page.keyboard.type('alpha beta');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await selectedText(page)).toBe('beta');

  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  // The first item has the focus; the browser's menu never shows (ours replaced it).
  await expect(item(page, 'Undo')).toBeFocused();
  const { violations } = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
  expect(violations).toEqual([]);
  // Esc: closed, the editor has the focus and its selection back.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  expect(await selectedText(page)).toBe('beta');

  // The Menu key; down to Cut (Undo, Redo, Cut) and Enter.
  await page.keyboard.press('ContextMenu');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Cut')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveText('alpha ');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('beta');

  // Text Style from the keyboard: Right opens a submenu, Enter picks.
  await page.keyboard.press('Shift+F10');
  await item(page, 'Text Style').focus();
  await page.keyboard.press('ArrowRight');
  const style = page.getByRole('menu', { name: 'Text Style' });
  await expect(style.getByRole('menuitem', { name: 'Font' })).toBeFocused();
  // Font, Size, Bold.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(style.getByRole('menuitemcheckbox', { name: 'Bold' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await expect.poll(async () => (await objects(page, id))[0]?.fontFamily).toBe(5); // Helvetica-Bold

  // Properties: the edit is written and the pane shows the comment.
  await page.keyboard.press('Shift+F10');
  await item(page, 'Properties').click();
  await written(page, id, ['alpha ']);
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await expect(view(page)).toBeFocused();
});

test('outside an edit, right-clicking a selected text comment still opens the comment menu', async ({
  page,
  context,
}) => {
  const id = await open(page, context);
  await tool(page, 'Text Box');
  await drag(page, [100, 100], [300, 140]);
  await page.keyboard.type('Note');
  await page.keyboard.press('Escape');
  await written(page, id, ['Note']);
  await click(page, 130, 112, 'right');
  await expect(page.getByRole('menu', { name: 'Comment', exact: true })).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
});

test('a file that denies copying: Cut and Copy are off and say why; the rest works (rule 9)', async ({
  page,
  context,
}) => {
  test.skip(!hasQpdf(), 'qpdf makes the restricted fixture');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const marked = Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>',
      '<< /Type /Annot /Subtype /FreeText /NM (ft-1) /F 4 /Rect [100 700 300 740] /Contents (Fixed text) /DA (/Helv 12 Tf 0 g) >>',
    ]),
  );
  const restricted = qpdfEncrypt(marked, '', 'owner', ['256', '--extract=n']);
  await page.goto('/');
  await drop(page, [{ name: 'restricted.pdf', b64: Buffer.from(restricted).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  // Select Comments and Select Text left Home in M7-09 (Comment tab).
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page.getByRole('button', { name: 'Select Comments', exact: true }).click();
  // Page y of the box's middle: 842 − 720.
  const p = await at(page, 150, 122);
  await page.mouse.dblclick(p.x, p.y);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+a');
  await click(page, 150, 122, 'right');
  await expect(menu(page)).toBeVisible();
  for (const name of ['Cut', 'Copy']) {
    const it = item(page, name);
    await expect(it).toHaveAttribute('aria-disabled', 'true');
    await expect(it).toHaveAttribute('title', /security settings/);
  }
  await expect(item(page, 'Delete')).not.toHaveAttribute('aria-disabled', 'true');
  await item(page, 'Delete').click();
  await expect(editor(page)).toHaveText('');
  await page.keyboard.type('New text');
  await page.keyboard.press('Escape');
  await written(page, id, ['New text']);
});
