import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M7-02 (ADR-023 D-43 a, d; review 4b-i, 4b-iii; bugs B1–B3): a new text box,
// typewriter or callout is selected and edits at once with "Type here"
// selected; its text is written on every way out of the editor — Esc, a click
// elsewhere, a tool change, Ctrl+S — as one undo step, and saved.

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
    // On the leader line: a click on a callout's box does not reach it yet (B4, M7-03).
    text: [110, 270],
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
