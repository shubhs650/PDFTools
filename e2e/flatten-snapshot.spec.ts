import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { flattenSourcePdf } from './fixtures/comments.ts';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-09 (ADR-021 D-38 c, e; beta review B7d, A2a; rules 1, 2, 9, 12):
// Flatten Comments from the Comment tab's dialog and the comment menu — the
// comments leave the pane and the annotation list, their pictures become page
// content, one undo step, saved and reopened flattened, Save Optimized offered
// on the next Ctrl+S. Snapshot from Home → View: a dragged (or keyboard)
// rectangle's picture on the system clipboard at twice the screen's size, with
// no main-thread long task; refused when the document forbids copying.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

interface Obj {
  id: string;
  pageIndex: number;
}

/** The fixture's annotations by /NM (its pop-up has none; a reload may name it anew). */
const ids = async (page: Page, id: string) =>
  (((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [])
    .map((o) => o.id)
    .filter((x) => x.startsWith('fl-'))
    .sort();

const toolbar = (page: Page, tab: string) => page.getByRole('toolbar', { name: `${tab} commands` });

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** RGB of a page point (top-left origin), page content only (no annotations). */
const pixel = async (page: Page, id: string, p: number, x: number, y: number) =>
  (await cap(page, 'pages', 'pixel', id, p, x, y)) as number[];

/** The on-screen position of a page point (top-left origin, unrotated). */
async function screenPoint(page: Page, pageIndex: number, x: number, y: number) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error(`page ${String(pageIndex)} not laid out`);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

const ALL = [
  'fl-blue',
  'fl-group',
  'fl-hidden',
  'fl-link',
  'fl-locked',
  'fl-note',
  'fl-oval',
  'fl-red',
  'fl-redact',
  'fl-reply',
  'fl-state',
];
const LEFT = ['fl-hidden', 'fl-link', 'fl-locked', 'fl-redact'];
const RED = [255, 0, 0];
const WHITE = [255, 255, 255];

test('Flatten Comments: the dialog, all pages; one undo step; saved and reopened flattened; Save Optimized offered @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, flattenSourcePdf(), 'flatten.pdf');
  await expect.poll(() => ids(page, id)).toEqual(expect.arrayContaining(ALL));
  const before = await ids(page, id);
  expect(await pixel(page, id, 0, 120, 220)).toEqual(WHITE);

  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await toolbar(page, 'Comment').getByRole('button', { name: 'Flatten Comments' }).click();
  const dialog = page.getByRole('dialog', { name: 'Flatten Comments' });
  await expect(dialog).toBeVisible();
  // Nothing selected: all comments on all pages; the counts say what stays.
  await expect(dialog.getByRole('radio', { name: /^The selected comment/ })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: 'All comments on these pages' })).toBeChecked();
  await expect(dialog.getByTestId('flatten-summary')).toHaveText(
    '4 comments will be flattened on 3 pages. 1 locked comment is left as it is. 1 hidden comment is left as it is.',
  );
  // A range narrows it; a bad range disables Flatten.
  await dialog.getByRole('radio', { name: 'Pages', exact: true }).check();
  const range = dialog.getByRole('textbox', { name: 'Page range' });
  await range.fill('2-3');
  await expect(dialog.getByTestId('flatten-summary')).toHaveText(
    '2 comments will be flattened on 2 pages.',
  );
  await range.fill('9');
  await expect(dialog.getByRole('button', { name: 'Flatten', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'All pages' }).check();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The comments, their reply, state and grouped part are gone; links, the
  // redaction mark and the locked and hidden comments stay.
  await expect.poll(() => ids(page, id)).toEqual(LEFT);
  await expect(page.getByRole('status').filter({ hasText: '4 comments flattened.' })).toBeVisible();
  expect(await pixel(page, id, 0, 120, 220)).toEqual(RED);
  // The Comments pane lists only what is left.
  await page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Comments' })
    .click();
  await expect(page.getByTestId('comments-list')).not.toContainText('Red');

  // One undo step, and redo.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(() => ids(page, id)).toEqual(before);
  await expect.poll(() => pixel(page, id, 0, 120, 220)).toEqual(WHITE);
  await page.getByRole('button', { name: 'Redo' }).first().click();
  await expect.poll(() => ids(page, id)).toEqual(LEFT);

  // Ctrl+S offers Save Optimized first (page content was rewritten).
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ControlOrMeta+s');
  const prompt = page.getByRole('dialog', { name: 'Save optimized instead?' });
  await expect(prompt).toContainText('Flattening comments rewrote page content in flatten.pdf');
  await page.keyboard.press('Escape');

  // Saved (one verified revision) and reopened: still flattened.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { tail: string };
  const file = Buffer.concat([Buffer.from(flattenSourcePdf()), Buffer.from(saved.tail, 'base64')]);
  const again = await open(page, new Uint8Array(file), 'saved.pdf');
  await expect.poll(() => ids(page, again)).toEqual(LEFT);
  expect(await pixel(page, again, 0, 120, 220)).toEqual(RED);
});

test('the comment menu flattens the selected comment only, without a dialog; undo brings it back', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, flattenSourcePdf(), 'flatten.pdf');
  await expect.poll(() => ids(page, id)).toEqual(expect.arrayContaining(ALL));
  await cap(page, 'annotate', 'select', id, 0, 'fl-red');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu).toHaveAccessibleName('Comment');
  await menu.getByRole('menuitem', { name: 'Flatten Selected Comments' }).click();
  await expect
    .poll(() => ids(page, id))
    .toEqual(ALL.filter((x) => !['fl-red', 'fl-reply', 'fl-state'].includes(x)));
  expect(await pixel(page, id, 0, 120, 220)).toEqual(RED);
  await expect(page.getByRole('status').filter({ hasText: '1 comment flattened.' })).toBeVisible();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => ids(page, id)).toEqual(expect.arrayContaining(ALL));

  // A locked comment can't be flattened: the item says why.
  await cap(page, 'annotate', 'select', id, 0, 'fl-locked');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+F10');
  const item = page.getByRole('menu').getByRole('menuitem', { name: 'Flatten Selected Comments' });
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toHaveAccessibleDescription('Select a comment first');
});

async function clipboardImage(context: BrowserContext, page: Page) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    if (!item?.types.includes('image/png')) return null;
    const blob = await item.getType('image/png');
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(bmp, 0, 0);
    const mid = g.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data;
    return { width: bmp.width, height: bmp.height, mid: [mid[0], mid[1], mid[2]] };
  });
}

test('Snapshot: a dragged rectangle goes to the clipboard as a PNG at twice the screen size, comments included @smoke', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await open(page, flattenSourcePdf(), 'flatten.pdf');
  const snap = toolbar(page, 'Home').getByRole('button', { name: 'Snapshot', exact: true });
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  // The red rectangle (a comment, x 100–250, y 162–242 from the top).
  const a = await screenPoint(page, 0, 110, 170);
  const b = await screenPoint(page, 0, 240, 235);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await expect(page.getByTestId('snapshot-draft')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Snapshot copied');
  // Said by the document's one live region (rule 12), not a second status region.
  await expect(page.getByRole('status').filter({ hasText: 'Snapshot copied' })).toBeVisible();
  await expect(page.getByTestId('snapshot-toast').locator('xpath=..')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  const img = await clipboardImage(context, page);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  // The dragged CSS pixels × device pixel ratio × 2.
  expect(img?.width).toBeGreaterThanOrEqual(Math.floor((b.x - a.x) * dpr * 2) - 2);
  expect(img?.width).toBeLessThanOrEqual(Math.ceil((b.x - a.x) * dpr * 2) + 2);
  expect(img?.height).toBeGreaterThanOrEqual(Math.floor((b.y - a.y) * dpr * 2) - 2);
  expect(img?.height).toBeLessThanOrEqual(Math.ceil((b.y - a.y) * dpr * 2) + 2);
  expect(img?.mid).toEqual(RED);
  // The tool stays on for the next one; Esc ends it.
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
});

test('Snapshot from the keyboard: a rectangle to move and size, Enter copies it; a whole page at high zoom has no long task', async ({
  page,
  context,
  guard,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await open(page, flattenSourcePdf(), 'flatten.pdf');
  const snap = toolbar(page, 'Home').getByRole('button', { name: 'Snapshot', exact: true });
  await snap.focus();
  await page.keyboard.press('Enter');
  const rect = page.getByRole('application', { name: 'Area to copy as a picture' });
  await expect(rect).toBeFocused();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Snapshot copied');
  const first = await clipboardImage(context, page);
  expect(first?.width).toBeGreaterThan(first?.height ?? 0);
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="snapshot-layer"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await expect(rect).toHaveCount(0);

  // A whole page at 400 %: capped at 4,096 px, rendered off the main thread.
  await cap(page, 'view', 'zoom', 4);
  await expect
    .poll(
      async () => (await page.locator('[data-page="0"] .page-content').boundingBox())?.width ?? 0,
    )
    .toBeGreaterThan(2000);
  await snap.click();
  await guard.startMeasuring();
  const a = await screenPoint(page, 0, 0, 0);
  const b = await screenPoint(page, 0, 300, 300);
  await page.mouse.move(a.x + 2, a.y + 2);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('snapshot-toast')).toHaveText('Snapshot copied', {
    timeout: 20_000,
  });
  const big = await clipboardImage(context, page);
  expect(Math.max(big?.width ?? 0, big?.height ?? 0)).toBeLessThanOrEqual(4096);
  expect(await guard.longTasksOverLimit()).toEqual([]);
});

test('a document that forbids copying and changing: Snapshot and Flatten are disabled and say why (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  const locked = qpdfEncrypt(flattenSourcePdf(), USER_PW, OWNER_PW, [
    '256',
    '--extract=n',
    '--modify=none',
  ]);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  await page
    .getByRole('dialog', { name: 'Password required' })
    .getByLabel('Password')
    .fill(USER_PW);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const snap = toolbar(page, 'Home').getByRole('button', { name: 'Snapshot', exact: true });
  await expect(snap).toBeDisabled();
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await expect(
    toolbar(page, 'Comment').getByRole('button', { name: 'Flatten Comments' }),
  ).toBeDisabled();
});
