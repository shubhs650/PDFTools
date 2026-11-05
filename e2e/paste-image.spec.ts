import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { reviewSourcePdf } from './fixtures/comments.ts';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M7-08 (ADR-023 D-45; review 4e; rules 1, 4, 9): an image on the system
// clipboard pastes onto the page as an Image Stamp — Ctrl+V in the middle of
// the visible part of the page, the right-click menu's Paste at the pointer;
// scaled down to fit inside 90 % of the page, never enlarged beyond its size
// at 96 dpi; selected; one undo step; saved as a /Stamp with an image
// XObject. The newest copy wins between our comment clipboard and an image.
// Nothing is requested from the network (the guard fails the test otherwise)
// and no main-thread task passes 100 ms while a large image is decoded.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const STAMP = 13;
const SHOTS = process.env.M7_08_SHOTS;

interface Obj {
  id: string;
  type: number;
  pageIndex: number;
  subject?: string;
  contents?: string;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const stamps = async (page: Page, id: string) =>
  (await objects(page, id)).filter((o) => o.type === STAMP);
const toast = (page: Page) => page.getByTestId('snapshot-toast');
const view = (page: Page) => page.getByTestId('document-view');

async function open(page: Page, bytes: Uint8Array, name = 'sheet.pdf'): Promise<string> {
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'objects', id)).not.toBeNull();
  return id;
}

async function fitPage(page: Page): Promise<void> {
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+0');
  await expect(page.getByRole('textbox', { name: 'Zoom', exact: true })).not.toHaveValue('100%');
}

/** The on-screen position of a page point (top-left origin; the fixtures are 595 pt wide). */
async function screenPoint(page: Page, x: number, y: number, pageIndex = 0) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error('page not laid out');
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

/** A w × h picture (blue, a yellow block in the middle) on the system clipboard as PNG. */
async function copyImage(context: BrowserContext, page: Page, w: number, h: number) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(
    async ([width, height]) => {
      const c = new OffscreenCanvas(width, height);
      const g = c.getContext('2d');
      if (!g) throw new Error('no 2d');
      g.fillStyle = '#2f5fb3';
      g.fillRect(0, 0, width, height);
      g.fillStyle = '#ffcc00';
      g.fillRect(width / 4, height / 4, width / 2, height / 2);
      const blob = await c.convertToBlob({ type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    },
    [w, h] as const,
  );
}

/** A paste event carrying a file, as the browser sends when a copied file is pasted. */
async function pasteFile(page: Page, kind: 'webp' | 'huge' | 'broken') {
  await page.evaluate(async (k) => {
    let file: File;
    if (k === 'webp') {
      const c = new OffscreenCanvas(120, 80);
      const g = c.getContext('2d');
      if (!g) throw new Error('no 2d');
      g.fillStyle = '#c03030';
      g.fillRect(0, 0, 120, 80);
      file = new File([await c.convertToBlob({ type: 'image/webp' })], 'pic.webp', {
        type: 'image/webp',
      });
    } else if (k === 'huge') {
      file = new File([new Uint8Array(21 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    } else file = new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'x.gif', { type: 'image/gif' });
    const dt = new DataTransfer();
    dt.items.add(file);
    (document.activeElement ?? document.body).dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, kind);
}

const centre = (o: Obj) => ({
  x: o.rect.origin.x + o.rect.size.width / 2,
  y: o.rect.origin.y + o.rect.size.height / 2,
});

test('Ctrl+V: a 4000 × 3000 screenshot fits inside the A4 page, centred in view, selected; one undo step; saved and reopened as an image stamp @smoke', async ({
  page,
  context,
  guard,
}) => {
  await page.goto('/');
  const bytes = simplePdf(1);
  const id = await open(page, bytes);
  await fitPage(page);
  await copyImage(context, page, 4000, 3000);
  const corner = await screenPoint(page, 500, 800);
  await page.mouse.click(corner.x, corner.y);
  await guard.startMeasuring();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(toast(page)).toHaveText('Image pasted.');
  await expect.poll(async () => (await stamps(page, id)).length).toBe(1);
  const [s] = await stamps(page, id);
  if (!s) throw new Error('no stamp');
  // 4000 px = 3000 pt at 96 dpi: scaled to 90 % of the page's width (595 pt), 4:3 kept.
  expect(s.rect.size.width).toBeCloseTo(595 * 0.9, 0);
  expect(s.rect.size.width / s.rect.size.height).toBeCloseTo(4 / 3, 2);
  expect(s.rect.size.height).toBeLessThanOrEqual(842 * 0.9);
  // The whole page is in view at Fit Page: the middle of the page.
  expect(centre(s).x).toBeCloseTo(595 / 2, 0);
  expect(centre(s).y).toBeCloseTo(842 / 2, 0);
  expect(s.subject).toBe('Pasted image');
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([s.id]);
  // Decoded in the Render worker: no main-thread task over 100 ms (rule 1).
  expect(await guard.longTasksOverLimit()).toEqual([]);
  if (SHOTS) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/01-ctrl-v-screenshot-fits-page-1280.png` });
  }

  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(async () => (await stamps(page, id)).length).toBe(0);
  await page.getByRole('button', { name: 'Redo' }).first().click();
  await expect.poll(async () => (await stamps(page, id)).length).toBe(1);

  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(saved.mode).toBe('narrow');
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/Subtype\s*\/Stamp/);
  expect(tail).toMatch(/\/Subtype\s*\/Image/);
  const file = Buffer.concat([Buffer.from(bytes), Buffer.from(saved.tail, 'base64')]);
  await drop(page, [{ name: 'saved.pdf', b64: file.toString('base64') }]);
  await expect.poll(() => cap(page, 'view', 'activeDocId')).not.toBe(id);
  const again = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await stamps(page, again)).length).toBe(1);
  const [back] = await stamps(page, again);
  expect(back?.rect.size.width).toBeCloseTo(s.rect.size.width, 0);
  expect(back?.subject).toBe('Pasted image');
  if (process.env.M7_INTEROP_OUT === '1') {
    const out = 'e2e/fixtures/self-made/m7-interop';
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'paste-image__ctrl-s.pdf'), file);
  }
});

test('the page menu’s Paste puts a small icon at its own size where you clicked; Ctrl+V uses the visible part of the page', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(2));
  await fitPage(page);
  await copyImage(context, page, 64, 32);
  const p = await screenPoint(page, 150, 200);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Page' });
  if (SHOTS) {
    await expect(menu).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-page-menu-paste-1280.png` });
  }
  await menu.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect.poll(async () => (await stamps(page, id)).length).toBe(1);
  const [s] = await stamps(page, id);
  if (!s) throw new Error('no stamp');
  // 64 × 32 px at 96 dpi = 48 × 24 pt, never enlarged; centred at the pointer.
  expect(s.rect.size.width).toBeCloseTo(48, 1);
  expect(s.rect.size.height).toBeCloseTo(24, 1);
  expect(centre(s).x).toBeCloseTo(150, 0);
  expect(centre(s).y).toBeCloseTo(200, 0);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([s.id]);
  if (SHOTS) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/03-menu-paste-small-icon-at-pointer-1280.png` });
  }

  // Zoomed in, page 2's top half in view: Ctrl+V goes to the middle of what is seen.
  await page.getByRole('textbox', { name: 'Zoom', exact: true }).fill('200%');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Zoom', exact: true })).toHaveValue('200%');
  // Page 2's top edge in the middle of the view: its top part fills the lower half.
  await view(page).evaluate((el) => {
    const pg = el.querySelector<HTMLElement>('[data-page="1"]');
    if (pg)
      el.scrollTop +=
        pg.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 2;
  });
  await page.waitForTimeout(300);
  const shown = await page.locator('[data-page="1"] .page-content').boundingBox();
  const vb = await view(page).boundingBox();
  if (!shown || !vb) throw new Error('not laid out');
  // Click page 2 where it is visible (away from everything), then paste.
  await page.mouse.click(Math.max(shown.x, vb.x) + 40, vb.y + vb.height * 0.8);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await stamps(page, id)).length).toBe(2);
  const second = (await stamps(page, id)).find((o) => o.id !== s.id);
  expect(second?.pageIndex).toBe(1);
  // Expected middle, from the visible strip of page 2 (k px per point).
  const k = shown.width / 595;
  const left = Math.max(shown.x, vb.x);
  const right = Math.min(shown.x + shown.width, vb.x + vb.width);
  const top = Math.max(shown.y, vb.y);
  const bottom = Math.min(shown.y + shown.height, vb.y + vb.height);
  const want = { x: ((left + right) / 2 - shown.x) / k, y: ((top + bottom) / 2 - shown.y) / k };
  if (!second) throw new Error('no second stamp');
  expect(Math.abs(centre(second).x - want.x)).toBeLessThan(3);
  expect(Math.abs(centre(second).y - want.y)).toBeLessThan(3);
  expect(want.y).toBeLessThan(842 / 2); // the top half: not the page's middle
  if (SHOTS) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/04-ctrl-v-middle-of-visible-part-200-1280.png` });
  }
});

test('the newest copy wins: comments copied after the image, then an image copied after the comments', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const id = await open(page, reviewSourcePdf(), 'rev.pdf');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);
  await fitPage(page);
  await copyImage(context, page, 200, 100);
  // Copy a comment after the image: Ctrl+V pastes the comment.
  await cap(page, 'annotate', 'select', id, 0, 'src-square');
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByRole('status').filter({ hasText: '1 comment copied.' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+v');
  // The square, its reply and its status.
  await expect(page.getByRole('status').filter({ hasText: '1 comment pasted.' })).toBeVisible();
  await expect.poll(async () => (await objects(page, id)).length).toBe(8);
  expect(await stamps(page, id)).toHaveLength(0);
  // A new image while the window was away (blur): Ctrl+V pastes the image.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await copyImage(context, page, 300, 100);
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await stamps(page, id)).length).toBe(1);
  expect((await stamps(page, id))[0]?.rect.size.width).toBeCloseTo(225, 1);
  // And again: the same image is still the newest copy.
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await stamps(page, id)).length).toBe(2);
  expect(await objects(page, id)).toHaveLength(10);
});

test('other formats are converted to PNG; a file over 20 MB and an unreadable image are refused with a reason', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1));
  await fitPage(page);
  await view(page).focus();
  await pasteFile(page, 'webp');
  await expect.poll(async () => (await stamps(page, id)).length).toBe(1);
  expect((await stamps(page, id))[0]?.rect.size.width).toBeCloseTo(90, 1);
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { tail: string };
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/Subtype\s*\/Image/);

  await view(page).focus();
  await pasteFile(page, 'huge');
  await expect(toast(page)).toHaveText('The image is larger than 20 MB.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-too-large-1280.png` });
  await pasteFile(page, 'broken');
  await expect(toast(page)).toHaveText(
    "This image couldn't be read. Copy it as a PNG or JPG image.",
  );
  expect(await stamps(page, id)).toHaveLength(1);
});

test('text fields keep their own paste; a refused clipboard read is explained', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1));
  // No clipboard permission in this context: the menu's read is refused.
  await fitPage(page);
  const p = await screenPoint(page, 300, 300);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page
    .getByRole('menu', { name: 'Page' })
    .getByRole('menuitem', { name: 'Paste', exact: true })
    .click();
  await expect(toast(page)).toContainText("The clipboard couldn't be read.");
  // A paste in the zoom box is the box's own.
  const zoom = page.getByRole('textbox', { name: 'Zoom', exact: true });
  await zoom.focus();
  await pasteFile(page, 'webp');
  await page.waitForTimeout(300);
  expect(await stamps(page, id)).toHaveLength(0);
});

test('a document that forbids commenting: Ctrl+V says why, the menu item is disabled (rule 9)', async ({
  page,
  context,
}) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  const locked = qpdfEncrypt(simplePdf(1), '', 'owner-pw', ['256', '--annotate=n']);
  const id = await open(page, locked, 'locked.pdf');
  await fitPage(page);
  await copyImage(context, page, 100, 100);
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(toast(page)).toHaveText(
    "This document's security settings don't allow adding comments.",
  );
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-restricted-ctrl-v-1280.png` });
  const p = await screenPoint(page, 300, 300);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const item = page
    .getByRole('menu', { name: 'Page' })
    .getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toHaveAccessibleDescription(
    "This document's security settings don't allow adding comments.",
  );
  expect(await stamps(page, id)).toHaveLength(0);
});
