import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { reviewSourcePdf } from './fixtures/comments.ts';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-02 (ADR-021 D-38 a, b; ADR-018 d5, d8; rules 9, 12): right-click menus on
// a comment and on the page background, cut / copy / paste of comments from
// the page with the mouse and the keyboard. Reproduced on the beta first: the
// copy itself worked, but Ctrl+V after clicking another page pasted onto the
// page the view had scrolled to (often out of sight), and right-click offered
// only the browser's menu, whose Copy and Paste do nothing for comments.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

interface Obj {
  id: string;
  pageIndex: number;
  inReplyToId?: string;
  contents?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** The on-screen position of a point given in page points (top-left origin, unrotated). */
async function screenPoint(page: Page, pageIndex: number, x: number, y: number) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error(`page ${String(pageIndex)} not laid out`);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

async function clickAt(page: Page, pageIndex: number, x: number, y: number, right = false) {
  const p = await screenPoint(page, pageIndex, x, y);
  await page.mouse.click(p.x, p.y, right ? { button: 'right' } : {});
}

async function fitPage(page: Page): Promise<void> {
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ControlOrMeta+0');
  await expect(page.getByRole('textbox', { name: 'Zoom', exact: true })).not.toHaveValue('100%');
}

/** Scrolls so page 1's bottom and page 2's top are both in view (at Fit Page). */
async function showPagesOneAndTwo(page: Page): Promise<void> {
  await page.getByTestId('document-view').evaluate((el) => {
    el.scrollTop += el.clientHeight * 0.4;
  });
  await expect(page.locator('[data-page="1"] .page-content')).toBeInViewport();
}

const pageNumber = (page: Page) => page.getByRole('textbox', { name: 'Page number' });
const menu = (page: Page) => page.getByRole('menu');
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

// The square on page 1: /Rect [100 600 250 680] → x 100–250, y 162–242 from the top.
const SQUARE_EDGE = { x: 175, y: 163 };

test('repro: Ctrl+C on a clicked comment, click on another page, Ctrl+V pastes onto that page', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, reviewSourcePdf(), 'rev.pdf');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  await fitPage(page);
  await clickAt(page, 0, SQUARE_EDGE.x, SQUARE_EDGE.y);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual(['src-square']);
  await page.keyboard.press('ControlOrMeta+c');
  await expect(status(page, '1 comment copied.')).toBeVisible();

  await showPagesOneAndTwo(page);
  // The view's current page is still page 1 (most of it is in view).
  await expect(pageNumber(page)).toHaveValue('1');

  // Click on page 2, away from anything, and paste.
  await clickAt(page, 1, 450, 60);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(status(page, '1 comment pasted.')).toBeVisible();
  const all = await objects(page, id);
  const copy = all.find((o) => o.contents === 'Check weld size' && o.id !== 'src-square');
  // Onto the clicked page, at the same place (it came from another page: no offset).
  expect(copy?.pageIndex).toBe(1);
  expect(copy?.rect.origin.x).toBeCloseTo(100, 0);
  expect(copy?.rect.origin.y).toBeCloseTo(162, 0);
});
