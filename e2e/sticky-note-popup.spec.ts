import AxeBuilder from '@axe-core/playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { hasQpdf } from './fixtures/encrypted.ts';
import { buildPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M7-06 (ADR-023 D-44; review 4c, bug B12): a sticky note has its own window
// on the page — several lines of text (Enter = new line), author and date,
// replies, status, lock, a menu — that moves, resizes, follows the page, and
// is saved as a standard /Popup (spike S23: /Parent, /Rect, /Open).

interface Obj {
  id: string;
  type: number;
  contents?: string;
  inReplyToId?: string;
  flags?: string[];
  state?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}
const TEXT = 1;

const SHOTS = process.env.M7_06_SHOTS;
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const view = (page: Page) => page.getByTestId('document-view');
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const notes = async (page: Page, id: string) =>
  (await objects(page, id)).filter((o) => o.type === TEXT && !o.inReplyToId);
const popup = (page: Page) => page.getByRole('dialog', { name: /^Sticky note by / });

async function open(page: Page, bytes: Uint8Array = simplePdf(2), name = 'notes.pdf') {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
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

/** Sticky Note tool, one click at (x, y): the note and its window. */
async function placeNote(page: Page, id: string, x = 100, y = 120): Promise<Obj> {
  await page.getByRole('tab', { name: 'Comment' }).click();
  const b = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Sticky Note', exact: true });
  await b.click();
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await notes(page, id)).length).toBe(1);
  const [note] = await notes(page, id);
  if (!note) throw new Error('no note');
  return note;
}

/** Back to the Select tool (the Sticky Note tool stays on after a note is placed). */
async function selectTool(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'select');
}

async function saved(page: Page, id: string) {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(s).toMatchObject({ mode: 'narrow', fellBack: false });
  return s.tail;
}

test('a new note opens its window: three lines, saved as /Contents and a standard /Popup, reopened open @smoke', async ({
  page,
}) => {
  const bytes = simplePdf(2);
  const id = await open(page, bytes);
  await placeNote(page, id);
  const win = popup(page);
  await expect(win).toBeVisible();
  const text = win.getByRole('textbox', { name: 'Note text' });
  await expect(text).toBeFocused();
  await expect(win).toContainText('Sticky Note');
  await expect(win).toContainText('Ana de Vries');
  // Enter is a new line; Ctrl+Enter saves (the window stays).
  await page.keyboard.type('Check weld size');
  await page.keyboard.press('Enter');
  await page.keyboard.type('at grid C4');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and C5');
  await shot(page, '01-new-note-typed-1280');
  await page.keyboard.press('Control+Enter');
  await expect
    .poll(async () => (await notes(page, id))[0]?.contents)
    .toBe('Check weld size\nat grid C4\nand C5');
  await expect(win).toBeVisible();
  // The document is changed by the note, not by opening its window.
  const tail = Buffer.from(await saved(page, id), 'base64').toString('latin1');
  expect(tail).toMatch(/\/Contents\s*\(Check weld size\\nat grid C4\\nand C5\)/);
  expect(tail).toMatch(/\/Subtype\s*\/Popup/);
  expect(tail).toMatch(/\/Popup\s+\d+\s+0\s+R/);
  expect(tail).toMatch(/\/Parent\s+\d+\s+0\s+R/);
  expect(tail).toMatch(/\/Open\s+true/);

  // Reopened: the three lines, and the window open where it was.
  const before = await win.boundingBox();
  const file = Buffer.concat([Buffer.from(bytes), Buffer.from(tail, 'latin1')]);
  await drop(page, [{ name: 'reopened.pdf', b64: file.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(async () => (await notes(page, again))[0]?.contents)
    .toBe('Check weld size\nat grid C4\nand C5');
  const back = popup(page);
  await expect(back).toBeVisible();
  await expect(back.getByRole('textbox', { name: 'Note text' })).toHaveValue(
    'Check weld size\nat grid C4\nand C5',
  );
  const after = await back.boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
});

test('click outside saves; Esc saves and closes; double-click and Enter reopen it', async ({
  page,
}) => {
  const id = await open(page);
  const note = await placeNote(page, id);
  const win = popup(page);
  const text = win.getByRole('textbox', { name: 'Note text' });
  await page.keyboard.type('First line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second line');
  await selectTool(page);
  // A click on the page outside the window saves the text.
  await text.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('.');
  const away = await at(page, 400, 600);
  await page.mouse.click(away.x, away.y);
  await expect
    .poll(async () => (await notes(page, id))[0]?.contents)
    .toBe('First line\nSecond line.');
  expect(await notes(page, id)).toHaveLength(1);
  // Esc saves and closes.
  await text.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);
  await expect
    .poll(async () => (await notes(page, id))[0]?.contents)
    .toBe('First line\nSecond line.!');
  // A double-click on the note opens it again, the caret in the text.
  const icon = await at(
    page,
    note.rect.origin.x + note.rect.size.width / 2,
    note.rect.origin.y + note.rect.size.height / 2,
  );
  await page.mouse.dblclick(icon.x, icon.y);
  await expect(win).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Note text' })).toBeFocused();
  await win.getByRole('button', { name: 'Close' }).click();
  await expect(win).toHaveCount(0);
  // Enter on the selected note opens it too.
  await cap(page, 'annotate', 'select', id, 0, note.id);
  await view(page).focus();
  await page.keyboard.press('Enter');
  await expect(win).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Note text' })).toBeFocused();
});

test('Reply, Set Status, Lock and Delete from the window; Open Popup in the Comments pane', async ({
  page,
}) => {
  const id = await open(page);
  await placeNote(page, id);
  const win = popup(page);
  await page.keyboard.type('Please confirm');
  // Reply: in the window and in the Comments pane.
  await win.getByRole('button', { name: 'Reply' }).click();
  const reply = win.getByRole('textbox', { name: 'Reply text' });
  await expect(reply).toBeFocused();
  await page.keyboard.type('Confirmed on site');
  await page.keyboard.press('Control+Enter');
  await expect(win.getByRole('list', { name: 'Replies' })).toContainText('Confirmed on site');
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.inReplyToId && !o.state).length)
    .toBe(1);
  // Set Status ▸ Accepted: the indicator shows it.
  await win.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Set Status' }).click();
  await page.getByRole('menuitem', { name: 'Accepted' }).click();
  await expect(win.locator('.note-popup-status')).toContainText('Accepted');
  await shot(page, '02-reply-status-1280');
  // The Comments pane shows the reply under the note.
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Comments Pane' })
    .click();
  const list = page.getByRole('listbox', { name: 'Comments' });
  await expect(list).toContainText('Confirmed on site');
  // Lock: the text can't change, the note is Locked.
  const lock = win.getByRole('button', { name: 'Lock' });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByRole('textbox', { name: 'Note text' })).toHaveAttribute('readonly', '');
  await expect.poll(async () => (await notes(page, id))[0]?.flags ?? []).toContain('locked');
  await win.getByRole('button', { name: 'Options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  // Close it; Open Popup from the card's menu brings it back.
  await win.getByRole('button', { name: 'Close' }).click();
  await expect(win).toHaveCount(0);
  await list.getByRole('option').filter({ hasText: 'Please confirm' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open Popup' }).click();
  await expect(win).toBeVisible();
  // Delete from the window's menu: the note and its thread go (asked first: it has replies).
  await win.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /Delete/ }));
  await confirm.getByRole('button', { name: /^Delete/ }).click();
  await expect.poll(async () => (await notes(page, id)).length).toBe(0);
  await expect(win).toHaveCount(0);
});

test('move and resize: saved as the /Popup rect; the window stays by its note at every zoom', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  const note = await placeNote(page, id, 80, 100);
  const win = popup(page);
  await page.keyboard.type('Moved note');
  await page.keyboard.press('Control+Enter');
  // Drag the header 120 px right and 60 px down.
  const head = win.locator('.note-popup-header');
  const hb = await head.boundingBox();
  if (!hb) throw new Error('no header');
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const moved = await win.boundingBox();
  expect((moved?.x ?? 0) - hb.x).toBeGreaterThan(110);
  // The grip resizes it.
  const grip = win.getByRole('button', { name: 'Resize window' });
  const gb = await grip.boundingBox();
  if (!gb) throw new Error('no grip');
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + 60, gb.y + 40, { steps: 4 });
  await page.mouse.up();
  const sized = await win.boundingBox();
  expect((sized?.width ?? 0) - (moved?.width ?? 0)).toBeGreaterThan(50);
  // Keyboard: the move handle and the grip take the arrow keys.
  await win.getByRole('button', { name: 'Move window' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await win.boundingBox())?.y).toBeGreaterThan((sized?.y ?? 0) + 4);
  // Moving made a change: the document is dirty.
  await expect.poll(() => cap(page, 'view', 'dirty', id)).toBe(true);
  await shot(page, '03-moved-resized-1280');

  // Zoom in and out: the window keeps its offset from the note (scaled) and its size.
  const offset = async () => {
    const icon = await page
      .locator(`[data-page="0"] [data-annotation-id="${note.id}"]`)
      .boundingBox();
    const w = await win.boundingBox();
    return { dx: (w?.x ?? 0) - (icon?.x ?? 0), dy: (w?.y ?? 0) - (icon?.y ?? 0), w: w?.width ?? 0 };
  };
  const z1 = await offset();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Zoom In' }).first().click();
  await expect.poll(async () => (await offset()).dx).toBeGreaterThan(z1.dx + 5);
  const z2 = await offset();
  expect(z2.w).toBeCloseTo(z1.w, 0);
  await shot(page, '04-zoomed-in-1280');

  // Saved: the /Popup rect is where it was put (and the note is unchanged).
  const tail = Buffer.from(await saved(page, id), 'base64').toString('latin1');
  const rect = /\/Parent\s+\d+\s+0\s+R\s*\/Rect\s*\[\s*([\d.\s-]+)\]/.exec(tail);
  expect(rect).not.toBeNull();
  const [l, b, r, t] = (rect?.[1] ?? '').trim().split(/\s+/).map(Number);
  expect((r ?? 0) - (l ?? 0)).toBeGreaterThan(240 + 50);
  expect((t ?? 0) - (b ?? 0)).toBeGreaterThan(168 + 30);
});

test('an Acrobat-made note: its pop-up is read (open, where it was), edits keep it; keyboard and axe', async ({
  page,
}) => {
  const bytes = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [5 0 R 6 0 R] /Contents 4 0 R >>',
    { dict: '<< >>', stream: '' },
    '<< /Type /Annot /Subtype /Text /Rect [100 700 120 720] /Name /Comment /Contents (From Acrobat\\rsecond line) /T (Bo) /NM (acro-1) /Popup 6 0 R /C [1 1 0] /F 28 /M (D:20260101120000Z) >>',
    '<< /Type /Annot /Subtype /Popup /Rect [140 560 380 720] /Parent 5 0 R /Open true /F 28 >>',
  ]);
  const id = await open(page, bytes, 'acrobat.pdf');
  const win = popup(page);
  await expect(win).toBeVisible();
  await expect(win).toContainText('Bo');
  // Where the file has it: top-left at (140, 842 - 720) on the page.
  const p = await at(page, 140, 122);
  const box = await win.boundingBox();
  expect(Math.abs((box?.x ?? 0) - p.x)).toBeLessThan(2);
  expect(Math.abs((box?.y ?? 0) - p.y)).toBeLessThan(2);
  expect(box?.width).toBeCloseTo(240, 0);
  // Opening it changed nothing.
  await expect.poll(() => cap(page, 'view', 'dirty', id)).toBe(false);

  // Keyboard: every control in the window is reachable and named.
  const text = win.getByRole('textbox', { name: 'Note text' });
  await text.focus();
  const names: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    names.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent ??
          '',
      ),
    );
  }
  expect(names).toEqual(['Options', 'Lock', 'Reply', 'Resize window']);
  // Reading the note (its CR line ends shown as lines) did not change it.
  await expect(text).toHaveValue('From Acrobat\nsecond line');
  expect(await cap(page, 'view', 'dirty', id)).toBe(false);
  const { violations } = await new AxeBuilder({ page }).include('.note-popup').analyze();
  expect(violations).toEqual([]);
  await shot(page, '05-acrobat-note-1280');

  // An edit of its text keeps the pop-up, /Open and its rect.
  await text.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('third line');
  await page.keyboard.press('Control+Enter');
  await expect
    .poll(async () => (await notes(page, id))[0]?.contents)
    .toBe('From Acrobat\nsecond line\nthird line');
  const tail = Buffer.from(await saved(page, id), 'base64').toString('latin1');
  expect(tail).toMatch(/\/Popup\s+6\s+0\s+R/);
  expect(tail).not.toMatch(/\/Subtype\s*\/Popup/); // the pop-up itself was not rewritten
});

// The owner's interop file (e2e/interop/CHECKLIST.md §M7 T): with
// M7_INTEROP_OUT=1 it is written to e2e/fixtures/self-made/m7-interop/.
test('interop file: an open note with three lines, a reply and a status, moved; a closed note', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, bytes, 'interop.pdf');
  await placeNote(page, id, 80, 120);
  const win = popup(page);
  await page.keyboard.type('Check weld size');
  await page.keyboard.press('Enter');
  await page.keyboard.type('at grid C4');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and C5');
  await page.keyboard.press('Control+Enter');
  await win.getByRole('button', { name: 'Reply' }).click();
  await page.keyboard.type('Confirmed on site');
  await page.keyboard.press('Control+Enter');
  await win.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Set Status' }).click();
  await page.getByRole('menuitem', { name: 'Accepted' }).click();
  await win.getByRole('button', { name: 'Move window' }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  // A second note, its window closed.
  // The Sticky Note tool is still on.
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'textComment');
  const p = await at(page, 480, 140);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await notes(page, id)).length).toBe(2);
  const second = page.getByRole('dialog', { name: /^Sticky note by / }).nth(1);
  await expect(second.getByRole('textbox', { name: 'Note text' })).toBeFocused();
  await page.keyboard.type('Closed note');
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(1);
  await expect
    .poll(async () => (await notes(page, id)).map((n) => n.contents).sort())
    .toEqual(['Check weld size\nat grid C4\nand C5', 'Closed note']);

  const tail = Buffer.from(await saved(page, id), 'base64');
  const file = Buffer.concat([Buffer.from(bytes), tail]);
  const text = tail.toString('latin1');
  expect(text.match(/\/Subtype\s*\/Popup/g)).toHaveLength(2);
  expect(text).toMatch(/\/Open\s+true/);
  expect(text).toMatch(/\/Open\s+false/);
  if (hasQpdf()) {
    const dir = mkdtempSync(join(tmpdir(), 'triya-m7-06-'));
    writeFileSync(join(dir, 'f.pdf'), file);
    expect([0, 3]).toContain(spawnSync('qpdf', ['--check', join(dir, 'f.pdf')]).status);
  }
  if (process.env.M7_INTEROP_OUT === '1') {
    const out = 'e2e/fixtures/self-made/m7-interop';
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'sticky-note-popups__ctrl-s.pdf'), file);
  }
});
