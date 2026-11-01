import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-05 (ADR-014): the annotation layer — markups drawn by annotation tiles,
// the plugin's store loaded from the Work worker, Select Objects, edit,
// delete, undo/redo and save.

const S1 = 'e2e/fixtures/self-made/s1-interop';

interface Listed {
  id: string;
  page: number;
  type: number;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const list = (page: Page, id: string) =>
  cap(page, 'annotate', 'list', id) as Promise<Listed[] | null>;

async function openFile(page: Page, name: string, bytes: Buffer): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name, b64: bytes.toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await list(page, id))?.length ?? 0).toBeGreaterThan(0);
  return id;
}

test('existing markups: listed from the Work worker, drawn as annotation tiles', async ({
  page,
}) => {
  const id = await openFile(page, 'annotated.pdf', readFileSync(`${S1}/original__annotated.pdf`));
  const items = (await list(page, id)) ?? [];
  expect(items.length).toBeGreaterThan(0);
  await expect(page.locator('[data-page="0"] .annotation-tiles img').first()).toBeVisible();
});

/** One page, a red square markup without /NM (object 4), as older viewers write them. */
function noNmPdf(): Buffer {
  return Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>',
      '<< /Type /Annot /Subtype /Square /Rect [100 600 300 700] /T (Old viewer) /Contents (No NM) /C [1 0 0] /BS << /W 4 >> /AP << /N 5 0 R >> >>',
      {
        dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 100] >>',
        stream: '1 0 0 RG 4 w 2 2 196 96 re S',
      },
    ]),
  );
}

test('a markup without /NM gets the stable id obj-<n> from the Work worker', async ({ page }) => {
  const id = await openFile(page, 'old.pdf', noNmPdf());
  expect((await list(page, id))?.map((a) => a.id)).toEqual(['obj-4']);
  await page.locator('[data-page="0"] .annotation-tiles img').first().waitFor();
  await page.screenshot({ path: 'test-results/m3-05-no-nm.png' });
});

/** Clicks a point given in page points (top-left origin) on page 1. */
async function clickPagePoint(page: Page, x: number, y: number, pageWidth = 595): Promise<void> {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const k = box.width / pageWidth;
  await page.mouse.click(box.x + x * k, box.y + y * k);
}

const rectOf = async (page: Page, docId: string, id: string) =>
  (await list(page, docId))?.find((a) => a.id === id)?.rect ?? null;

test('Select, nudge with the arrow keys, undo/redo, delete and undo (keyboard and mouse)', async ({
  page,
}) => {
  const id = await openFile(page, 'old.pdf', noNmPdf());
  // The square's top edge: x 100–300, y 142 (842 − 700) in top-left page points.
  await clickPagePoint(page, 200, 143);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['obj-4']);
  await expect(page.getByRole('status')).toContainText('Rectangle by Old viewer on page 1');
  const start = await rectOf(page, id, 'obj-4');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(async () => (await rectOf(page, id, 'obj-4'))?.origin)
    .toEqual({ x: (start?.origin.x ?? 0) + 1, y: (start?.origin.y ?? 0) + 10 });
  await expect.poll(() => cap(page, 'annotate', 'canUndo', id)).toBe(true);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await rectOf(page, id, 'obj-4'))?.origin).toEqual(start?.origin);
  await page.keyboard.press('Control+y');
  await expect
    .poll(async () => (await rectOf(page, id, 'obj-4'))?.origin.x)
    .toBe((start?.origin.x ?? 0) + 1);

  await page.keyboard.press('Delete');
  await expect.poll(async () => (await list(page, id))?.length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await list(page, id))?.map((a) => a.id)).toEqual(['obj-4']);
});

test('Tab walks the page’s markups; Esc deselects; the move is saved with its stable /NM', async ({
  page,
}) => {
  const id = await openFile(page, 'old.pdf', noNmPdf());
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['obj-4']);
  // Past the last markup, Tab leaves the document as usual (rule 12).
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('document-view')).not.toBeFocused();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([]);

  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await rectOf(page, id, 'obj-4'))?.origin.x).toBeGreaterThan(100);
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  // The edited annotation carries its stable id as /NM now (ADR-005 consequence).
  expect(tail).toMatch(/4 0 obj[\s\S]*\/NM\s*\(obj-4\)/);
  expect(tail).toMatch(/\/Rect\s*\[\s*110/);
});

test('a document that denies annotating: markups show, but nothing moves or deletes (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf makes the locked fixture');
  // Owner password only: opens without a prompt, with annotating denied.
  const locked = qpdfEncrypt(noNmPdf(), '', 'owner', ['256', '--annotate=n', '--modify=none']);
  const id = await openFile(page, 'locked.pdf', Buffer.from(locked));
  const [first] = (await list(page, id)) ?? [];
  if (!first) throw new Error('no markup');
  await cap(page, 'annotate', 'select', id, first.page, first.id);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  expect(await rectOf(page, id, first.id)).toEqual(first.rect);
  expect(await cap(page, 'save', 'state', id)).toMatchObject({ dirty: [], untracked: false });
});
