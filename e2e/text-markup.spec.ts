import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-08 (D-03, §7.1, rules 6 and 9): the text markup tools. Markups are made
// from a text selection — tool first (drag with the tool on) or selection first
// (drag or Ctrl+A, then the command or its key) — and saved as standard
// annotations with /QuadPoints, /T from the reviewer profile and the selected
// text in /Contents when copying is allowed; never EmbedPDF's /EPDFCustom.

interface Listed {
  id: string;
  page: number;
  type: number;
  author: string | null;
  contents: string | null;
}

// PdfAnnotationSubtype values.
const HIGHLIGHT = 9;
const UNDERLINE = 10;
const STRIKEOUT = 12;
const CARET = 14;

const view = (page: Page) => page.getByTestId('document-view');
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];

async function open(page: Page, name: string, bytes: Uint8Array, reviewer = 'Ana de Vries') {
  await page.goto('/');
  if (reviewer) await cap(page, 'annotate', 'setProfile', reviewer);
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  // The plugin's (empty) annotation load has finished.
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** Drags over "Page 1" of simplePdf (72, 740; 36 pt Helvetica). */
async function dragPage1(page: Page) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  const y = box.y + (842 - 752) * s;
  await page.mouse.move(box.x + 66 * s, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 190 * s, y, { steps: 8 });
  await page.mouse.up();
}

/** Saves (M1-21 flow) and returns the whole saved file and its incremental tail. */
async function save(page: Page, id: string, original: Uint8Array) {
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(saved.tail, 'base64');
  return { file: Buffer.concat([Buffer.from(original), tail]), tail: tail.toString('latin1') };
}

const quads = (tail: string): number[][] =>
  [...tail.matchAll(/\/QuadPoints\s*\[([^\]]*)\]/g)].map((m) =>
    (m[1] ?? '').trim().split(/\s+/).map(Number),
  );

test('Highlight tool: on until Esc; drag makes a highlight saved with quads, /T and /Contents', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, 'simple.pdf', bytes);
  await page.getByRole('tab', { name: 'Comment' }).click();
  const highlight = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Highlight', exact: true });
  await highlight.click();
  await expect(highlight).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'highlight');

  await dragPage1(page);
  await expect.poll(async () => (await list(page, id)).map((a) => a.type)).toEqual([HIGHLIGHT]);
  const [made] = await list(page, id);
  expect(made).toMatchObject({ author: 'Ana de Vries', contents: 'Page 1' });
  // Still on: a second drag makes a second markup.
  await dragPage1(page);
  await expect.poll(async () => (await list(page, id)).length).toBe(2);
  await view(page).focus();
  await page.keyboard.press('Escape');
  await expect(highlight).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'select');

  const { file, tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/Subtype\s*\/Highlight/);
  expect(tail).toMatch(/\/T\s*\(Ana de Vries\)/);
  expect(tail).toMatch(/\/Contents\s*\(Page 1\)/);
  expect(tail).not.toContain('EPDFCustom');
  const [q] = quads(tail);
  expect(q).toHaveLength(8);
  // The quad spans "Page 1": x from about 72 to about 175, around y 740–770.
  expect(Math.min(...(q ?? []).filter((_, i) => i % 2 === 0))).toBeCloseTo(72, -1);

  // Reopened: the same highlights come back from the file.
  const again = await open(page, 'saved.pdf', file);
  await expect
    .poll(async () => (await list(page, again)).map((a) => [a.type, a.author, a.contents]))
    .toEqual([
      [HIGHLIGHT, 'Ana de Vries', 'Page 1'],
      [HIGHLIGHT, 'Ana de Vries', 'Page 1'],
    ]);
});

test('keyboard: Ctrl+A then U underlines the page; the reviewer is asked first', async ({
  page,
}) => {
  const id = await open(page, 'simple.pdf', simplePdf(1), '');
  await view(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('u');
  const dialog = page.getByRole('dialog', { name: 'Who is reviewing?' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('Bo Li');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await list(page, id)).map((a) => [a.type, a.author, a.contents]))
    .toEqual([[UNDERLINE, 'Bo Li', 'Page 1']]);
  // Made from the selection: the tool itself did not turn on.
  await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'select');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await list(page, id)).length).toBe(0);
});

test('Replace Text: a caret with the typed text and a strikeout grouped with it', async ({
  page,
}) => {
  const bytes = simplePdf(1);
  const id = await open(page, 'simple.pdf', bytes);
  await view(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: 'Text to insert' });
  await dialog.getByLabel('Inserted text').fill('Sheet 1');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () =>
      (await list(page, id))
        .map((a) => [a.type, a.contents])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    )
    .toEqual([
      [STRIKEOUT, 'Page 1'],
      [CARET, 'Sheet 1'],
    ]);
  const { tail } = await save(page, id, bytes);
  expect(tail).toMatch(/\/Subtype\s*\/Caret/);
  expect(tail).toMatch(/\/Contents\s*\(Sheet 1\)/);
  expect(tail).toMatch(/\/IT\s*\/StrikeOutTextEdit/);
  expect(tail).toMatch(/\/RT\s*\/Group/);
  expect(tail).toMatch(/\/IRT\s+\d+ 0 R/);
});

test('a rotated page: Ctrl+A then G highlights the rotated line', async ({ page }) => {
  const rotated = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 24 Tf 72 760 Td (Rotated text) Tj ET' },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
  const id = await open(page, 'rotated.pdf', rotated);
  await view(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('g');
  await expect
    .poll(async () => (await list(page, id)).map((a) => [a.type, a.contents]))
    .toEqual([[HIGHLIGHT, 'Rotated text']]);
  const { tail } = await save(page, id, rotated);
  const [q] = quads(tail);
  // In unrotated page space the text runs along x from 72, at y ≈ 760.
  const xs = (q ?? []).filter((_, i) => i % 2 === 0);
  const ys = (q ?? []).filter((_, i) => i % 2 === 1);
  expect(Math.min(...xs)).toBeGreaterThan(60);
  expect(Math.max(...xs)).toBeGreaterThan(180);
  expect(Math.min(...ys)).toBeGreaterThan(740);
  expect(Math.max(...ys)).toBeLessThan(800);
});

test('copying denied: the markup is made without the text (rule 9)', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf makes the encrypted fixture');
  const noCopy = qpdfEncrypt(simplePdf(1), '', 'owner', ['256', '--extract=n']);
  const id = await open(page, 'no-copy.pdf', noCopy);
  await view(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('k');
  await expect
    .poll(async () => (await list(page, id)).map((a) => [a.type, a.contents]))
    .toEqual([[STRIKEOUT, null]]);
});
