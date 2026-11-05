import { inflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { customColor, pickColor } from './support/colors.ts';
import { expect, test } from './support/fixtures.ts';

// M6-06 (ADR-021 D-37, D-38 f; beta review B4): the Properties pane is a
// property grid — General, Style and Text sections — and every field
// round-trips through a narrow save and a reopen (PDFium readback). Flags:
// Read only, Printable, Locked; the reviewer's mark; review history. Locked
// comments are not moved, resized or deleted. With a comment tool on, the
// pane edits that tool's defaults; the comment menu has the flags and "Make
// Current Properties Default".

interface Obj {
  id: string;
  type: number;
  inReplyToId?: string;
  flags?: string[];
  subject?: string;
  contents?: string;
  strokeColor?: string;
  color?: string;
  opacity?: number;
  strokeWidth?: number;
  strokeStyle?: number;
  blendMode?: number;
  rotation?: number;
  fontFamily?: number;
  fontSize?: number;
  fontColor?: string;
  textAlign?: number;
  verticalAlign?: number;
  state?: string;
  stateModel?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const byId = async (page: Page, id: string, annot: string) =>
  (await objects(page, id)).find((o) => o.id === annot);
const pane = (page: Page) => page.getByTestId('properties-pane');
const field = (page: Page, name: string) => pane(page).getByLabel(name, { exact: true });

async function open(page: Page, bytes: Uint8Array, name = 'grid.pdf'): Promise<string> {
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

async function setup(page: Page) {
  const bytes = simplePdf(1);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  const id = await open(page, bytes);
  const sq = (await cap(page, 'annotate', 'createSquare', id, 0, 60, 60)) as string;
  const box = (await cap(page, 'annotate', 'create', id, 0, {
    type: 3, // FreeText
    rect: { origin: { x: 260, y: 60 }, size: { width: 160, height: 40 } },
    contents: 'Check the weld',
    fontFamily: 4, // Helvetica
    fontSize: 10,
    fontColor: '#FF0000',
    color: 'transparent',
    textAlign: 0,
    verticalAlign: 0,
  })) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(2);
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  return { id, sq, box, bytes };
}

async function commit(input: Locator, value: string) {
  await input.fill(value);
  await input.press('Enter');
}

/** Screen point of a page point (top-left origin) on page 1. */
async function at(page: Page, x: number, y: number) {
  const r = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!r) throw new Error('page not laid out');
  const k = r.width / 595;
  return { x: r.x + x * k, y: r.y + y * k };
}

test('General, Style and Text: every field round-trips through save and reopen @smoke', async ({
  page,
}) => {
  const { id, sq, box, bytes } = await setup(page);
  await cap(page, 'annotate', 'selectMany', id, [sq]);
  const sections = pane(page).getByRole('heading', { level: 3 });
  await expect(sections).toHaveText(['General', 'Style']);
  // Read-only facts.
  await expect(field(page, 'Name')).toHaveValue(sq);
  await expect(field(page, 'Author')).toHaveValue('Ana de Vries');
  // No /CreationDate on this one (made without a date): the row is empty.
  await expect(field(page, 'Created')).toHaveValue('');

  // General.
  await field(page, 'Subject').fill('Weld size');
  await field(page, 'Comment text').fill('Use 6 mm');
  await field(page, 'Comment text').blur();
  // Style.
  await expect(field(page, 'Fill color')).toBeEnabled();
  await pickColor(pane(page), 'Fill color', 'Lime');
  await pickColor(pane(page), 'Stroke color', 'Blue');
  await field(page, 'Line style').selectOption({ label: 'Dashed' });
  await commit(field(page, 'Line width'), '3');
  await commit(field(page, 'Opacity'), '50');
  await field(page, 'Blend mode').selectOption({ label: 'Multiply' });
  await commit(field(page, 'Rotation'), '30');
  await field(page, 'Printable').uncheck();
  await expect
    .poll(async () => {
      const o = await byId(page, id, sq);
      return [
        o?.subject,
        o?.contents,
        o?.color,
        o?.strokeColor,
        o?.strokeStyle,
        o?.strokeWidth,
        o?.opacity,
        o?.blendMode,
        o?.rotation,
        o?.flags?.includes('print'),
      ];
    })
    .toEqual(['Weld size', 'Use 6 mm', '#00ff00', '#0000ff', 2, 3, 0.5, 1, 30, false]);

  // Text: a text box shows the Text section.
  await cap(page, 'annotate', 'selectMany', id, [box]);
  await expect(sections).toHaveText(['General', 'Style', 'Text']);
  await expect(field(page, 'Created')).not.toHaveValue('');
  await field(page, 'Font').selectOption({ label: 'Times' });
  await field(page, 'Bold').check();
  await field(page, 'Italic').check();
  await commit(field(page, 'Font size'), '14');
  await customColor(pane(page), 'Text color', '#123456');
  await field(page, 'Alignment').selectOption({ label: 'Center' });
  await field(page, 'Vertical alignment').selectOption({ label: 'Middle' });
  await expect
    .poll(async () => {
      const o = await byId(page, id, box);
      return [o?.fontFamily, o?.fontSize, o?.fontColor, o?.textAlign, o?.verticalAlign];
    })
    .toEqual([10, 14, '#123456', 1, 1]); // Times-BoldItalic

  // Flags and mark on the text box: Marked is a hidden state reply; Locked last.
  await field(page, 'Marked').check();
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.stateModel === 'Marked').length)
    .toBe(1);
  await pane(page)
    .getByRole('button', { name: /^Show 1 entry/ })
    .click();
  await expect(pane(page).getByRole('list', { name: 'Review history' })).toContainText(
    'Marked, Ana de Vries',
  );
  await field(page, 'Locked').check();
  await expect(pane(page).getByRole('status')).toHaveText(
    'This comment is locked. Clear Locked to change it.',
  );
  await expect(field(page, 'Font size')).toBeDisabled();
  await expect(field(page, 'Locked')).toBeEnabled();

  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/Subj\s*\(Weld size\)/);
  expect(tail).toMatch(/\/BM\s*\/Multiply/);
  // /State and /StateModel are text strings (PDF 32000-1 table 172), as Acrobat writes them.
  expect(tail).toMatch(/\/State\s*\(Marked\)\s*\/StateModel\s*\(Marked\)/);
  // Locked and printable: /F 4 + 128; the rectangle no longer prints: /F 0.
  expect(tail).toMatch(/\/F 132\b[^>]*\/Subtype\s*\/FreeText/);
  expect(tail).toMatch(/\/F 0\b[^>]*\/Subtype\s*\/Square/);
  expect(tail).toMatch(/\/Q\s+1\b/);

  const file = Buffer.concat([Buffer.from(bytes), Buffer.from(saved.tail, 'base64')]);
  await drop(page, [{ name: 'saved.pdf', b64: file.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, again)).length).toBe(3);
  const back = await objects(page, again);
  const s = back.find((o) => o.id === sq);
  expect(s).toMatchObject({
    subject: 'Weld size',
    contents: 'Use 6 mm',
    strokeStyle: 2,
    strokeWidth: 3,
    blendMode: 1,
    rotation: 30,
  });
  expect(s?.opacity).toBeCloseTo(0.5, 2); // /CA is stored in 8 bits
  expect(s?.color?.toLowerCase()).toBe('#00ff00');
  expect(s?.strokeColor?.toLowerCase()).toBe('#0000ff');
  expect(s?.flags ?? []).not.toContain('print');
  const b = back.find((o) => o.id === box);
  expect(b).toMatchObject({ fontFamily: 10, fontSize: 14, textAlign: 1, verticalAlign: 1 });
  expect(b?.fontColor?.toLowerCase()).toBe('#123456');
  expect(b?.flags).toEqual(expect.arrayContaining(['print', 'locked']));
  expect(back.find((o) => o.stateModel === 'Marked')).toMatchObject({
    inReplyToId: box,
    state: 'Marked',
  });
  // The reopened grid reads the same.
  await cap(page, 'annotate', 'selectMany', again, [box]);
  await expect(field(page, 'Font')).toHaveValue('times');
  await expect(field(page, 'Bold')).toBeChecked();
  await expect(field(page, 'Marked')).toBeChecked();
  await expect(field(page, 'Locked')).toBeChecked();
});

test('a selection shows Mixed; one change is one undo step; sections collapse; axe clean', async ({
  page,
}) => {
  const { id, sq } = await setup(page);
  const other = (await cap(page, 'annotate', 'createSquare', id, 0, 60, 200)) as string;
  await cap(page, 'annotate', 'update', id, 0, other, { flags: ['print', 'locked'] });
  await cap(page, 'annotate', 'selectMany', id, [sq, other]);
  await expect(pane(page)).toContainText('2 comments selected');
  // Locked on one of them: Mixed (indeterminate), and the style is fixed.
  await expect(field(page, 'Locked')).toHaveJSProperty('indeterminate', true);
  await expect(field(page, 'Line width')).toBeDisabled();
  await field(page, 'Locked').click(); // from Mixed: on for both
  await field(page, 'Locked').uncheck();
  await expect.poll(async () => (await byId(page, id, other))?.flags).toEqual(['print']);
  await commit(field(page, 'Line width'), '5');
  const widths = async () =>
    (await objects(page, id)).filter((o) => o.type === 5).map((o) => o.strokeWidth);
  await expect.poll(widths).toEqual([5, 5]);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(widths).toEqual([2, 2]);

  const style = pane(page).getByRole('button', { name: 'Style' });
  await expect(style).toHaveAttribute('aria-expanded', 'true');
  await style.click();
  await expect(style).toHaveAttribute('aria-expanded', 'false');
  await expect(field(page, 'Line width')).toBeHidden();
  await style.press('Enter');
  await expect(field(page, 'Line width')).toBeVisible();

  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="properties-pane"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('a Locked comment is not moved, resized or deleted; Read only stays selectable and can be cleared', async ({
  page,
}) => {
  const { id, sq } = await setup(page);
  await cap(page, 'annotate', 'select', id, 0, sq);
  await field(page, 'Locked').check();
  await expect.poll(async () => (await byId(page, id, sq))?.flags).toContain('locked');
  const before = (await byId(page, id, sq))?.rect;

  // Drag from the middle of its border: nothing moves.
  const from = await at(page, 60 + 60, 60);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 60, { steps: 8 });
  await page.mouse.up();
  // Arrow keys and Delete do nothing either; the ribbon's Delete says why.
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  expect((await byId(page, id, sq))?.rect).toEqual(before);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+F10');
  const del = page
    .getByRole('menu', { name: 'Comment' })
    .getByRole('menuitem', { name: 'Delete Selected Comments' });
  await expect(del).toHaveAccessibleDescription('The comment is locked');
  await page.keyboard.press('Escape');

  // Unlocked, it moves again.
  await field(page, 'Locked').uncheck();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await byId(page, id, sq))?.rect.origin.x).toBe(61);

  // Read only: the comment stays selectable (the plugin would refuse it), fixed, and is cleared here.
  await field(page, 'Read only').check();
  await cap(page, 'annotate', 'selectMany', id, []);
  await cap(page, 'annotate', 'select', id, 0, sq);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([sq]);
  await expect(pane(page).getByRole('status')).toHaveText(
    'This comment is read only. Clear Read only to change it.',
  );
  await expect(field(page, 'Subject')).toBeDisabled();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ArrowRight');
  expect((await byId(page, id, sq))?.rect.origin.x).toBe(61);
  await field(page, 'Read only').uncheck();
  await expect(field(page, 'Subject')).toBeEnabled();
});

test('the comment menu: Marked, Locked and Printable ticks; Make Current Properties Default; Tool Properties', async ({
  page,
}) => {
  const { id, sq } = await setup(page);
  await expect.poll(() => cap(page, 'annotate', 'toolDefaultsLoaded')).toBe(true);
  await cap(page, 'annotate', 'update', id, 0, sq, { strokeColor: '#00AA00', strokeWidth: 4 });
  // Right click on the rectangle's top edge.
  const p = await at(page, 120, 60);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Comment' });
  await expect(menu).toBeVisible();
  const locked = menu.getByRole('menuitemcheckbox', { name: 'Locked' });
  await expect(locked).toHaveAttribute('aria-checked', 'false');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Printable' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await menu.getByRole('menuitemcheckbox', { name: 'Marked' }).click();
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.stateModel === 'Marked').length)
    .toBe(1);
  await expect(field(page, 'Marked')).toBeChecked();

  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Make Current Properties Default' }).click();
  await expect
    .poll(async () => (await cap(page, 'annotate', 'toolDefaults', 'square')) as Obj)
    .toMatchObject({ strokeColor: '#00AA00', strokeWidth: 4 });

  await page.mouse.click(p.x, p.y, { button: 'right' });
  await locked.click();
  await expect.poll(async () => (await byId(page, id, sq))?.flags).toContain('locked');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(locked).toHaveAttribute('aria-checked', 'true');
  // Printable is fixed while locked; the menu says why.
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Printable' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.keyboard.press('Escape');

  // A tool on: the pane shows and edits its defaults.
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const tool = page.getByTestId('tool-properties');
  await expect(tool).toContainText('Rectangle Tool Properties');
  await expect(tool.getByLabel('Line width', { exact: true })).toHaveValue('4');
  await commit(tool.getByLabel('Line width', { exact: true }), '2.5');
  await tool.getByLabel('Line style', { exact: true }).selectOption({ label: 'Cloudy' });
  await expect
    .poll(async () => (await cap(page, 'annotate', 'toolDefaults', 'square')) as Obj)
    .toMatchObject({ strokeWidth: 2.5, cloudyBorderIntensity: 2 });
  await tool.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect
    .poll(async () => {
      const d = (await cap(page, 'annotate', 'toolDefaults', 'square')) as Obj & {
        cloudyBorderIntensity?: number;
      };
      return [d.strokeColor, d.strokeWidth, d.cloudyBorderIntensity ?? 0];
    })
    .toEqual(['#FF0000', 1, 0]);
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="properties-pane"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

/** The (inflated) content streams of a saved tail. */
function streams(tail: Buffer): string[] {
  const out: string[] = [];
  for (const m of tail.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const raw = Buffer.from(m[1] ?? '', 'latin1');
    try {
      out.push(inflateSync(raw).toString('latin1'));
    } catch {
      out.push(raw.toString('latin1'));
    }
  }
  return out;
}

test('a text box has its own Text color and Border color, saved as Acrobat reads them (ADR-024) @smoke', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  const id = await open(page, bytes);
  const make = (extra: Record<string, unknown>) =>
    cap(page, 'annotate', 'create', id, 0, {
      type: 3, // FreeText
      contents: 'Check the weld',
      fontFamily: 4,
      fontSize: 12,
      fontColor: '#FF0000',
      color: 'transparent',
      textAlign: 0,
      verticalAlign: 0,
      ...extra,
    }) as Promise<string>;
  const box = await make({
    rect: { origin: { x: 60, y: 60 }, size: { width: 160, height: 40 } },
    strokeColor: '#FF0000',
    strokeWidth: 1,
  });
  const typewriter = await make({
    rect: { origin: { x: 60, y: 200 }, size: { width: 160, height: 40 } },
    strokeWidth: 0,
    intent: 'FreeTextTypeWriter',
  });
  await expect.poll(async () => (await objects(page, id)).length).toBe(2);
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();

  await cap(page, 'annotate', 'selectMany', id, [typewriter]);
  await expect(pane(page).getByRole('button', { name: 'Text color', exact: true })).toBeVisible();
  await expect(pane(page).getByRole('button', { name: 'Border color', exact: true })).toHaveCount(
    0,
  );

  await cap(page, 'annotate', 'selectMany', id, [box]);
  await pickColor(pane(page), 'Text color', 'Blue');
  await expect
    .poll(async () => {
      const o = await byId(page, id, box);
      return [o?.fontColor?.toLowerCase(), o?.strokeColor?.toLowerCase()];
    })
    .toEqual(['#0000ff', '#ff0000']);
  await pickColor(pane(page), 'Border color', 'Green');
  await expect
    .poll(async () => (await byId(page, id, box))?.strokeColor?.toLowerCase())
    .toBe('#008000');
  expect((await byId(page, id, box))?.fontColor?.toLowerCase()).toBe('#0000ff');

  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const tailBytes = Buffer.from(saved.tail, 'base64');
  const tail = tailBytes.toString('latin1');
  // /DA: the border colour; /DS: the text colour (Acrobat, PDF-XChange).
  expect(tail).toMatch(/\/DA\s*\(0\s+0?\.50\d*\s+0\s+rg[^)]*\)/); // Green #008000
  expect(tail).toMatch(/\/DS\s*\([^)]*color:#0000FF[^)]*\)/);
  // The appearance draws the text blue.
  const drawn = streams(tailBytes).filter((t) => t.includes('(Check the weld) Tj'));
  expect(drawn.some((t) => /BT\s+0\s+0\s+1\s+rg/.test(t))).toBe(true);

  const file = Buffer.concat([Buffer.from(bytes), tailBytes]);
  await drop(page, [{ name: 'saved.pdf', b64: file.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, again)).length).toBe(2);
  const back = await byId(page, again, box);
  expect([back?.fontColor?.toLowerCase(), back?.strokeColor?.toLowerCase()]).toEqual([
    '#0000ff',
    '#008000',
  ]);

  // The Text Box tool's defaults have both colours too (red on red, D-37).
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Text Box', exact: true })
    .click();
  const tool = page.getByTestId('tool-properties');
  await expect(tool).toContainText('Text Box Tool Properties');
  await pickColor(tool, 'Border color', 'Blue');
  await expect
    .poll(async () => {
      const d = (await cap(page, 'annotate', 'toolDefaults', 'freeText')) as Obj;
      return [d.fontColor?.toLowerCase(), d.strokeColor?.toLowerCase()];
    })
    .toEqual(['#ff0000', '#0000ff']);
});
