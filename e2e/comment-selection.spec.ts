import type { Page } from '@playwright/test';
import { fullFormPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M7-04 (ADR-023 D-36 amendment, D-43; review 4a, 4f; bugs B7, B8, B9, B13,
// B14): a drag on the page with Select Comments (or with Select, off the text)
// selects every comment it touches; Shift+click adds or removes one; Ctrl+A
// selects the page's comments and Esc clears; the group moves, nudges and
// deletes as one undo step; the comment just drawn is selected; quick nudges
// are all saved.

interface Listed {
  id: string;
  page: number;
  type: number;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
  commit: string;
}

const view = (page: Page) => page.getByTestId('document-view');
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];
const selected = async (page: Page, id: string) =>
  [...(((await cap(page, 'annotate', 'selected', id)) as string[] | null) ?? [])].sort();
/** A comment's top-left corner (page points, to 0.01 pt). */
async function rectOf(page: Page, id: string, annot: string) {
  const o = (await list(page, id)).find((a) => a.id === annot)?.rect.origin;
  return o ? { x: Math.round(o.x * 100) / 100, y: Math.round(o.y * 100) / 100 } : null;
}

async function open(page: Page, pages = 2, bytes = simplePdf(pages)): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'marquee.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** A 120 × 60 rectangle comment at a page point (top-left origin), written to the worker. */
async function square(page: Page, id: string, x: number, y: number, p = 0): Promise<string> {
  const a = (await cap(page, 'annotate', 'createSquare', id, p, x, y)) as string;
  await expect
    .poll(async () => (await list(page, id)).find((l) => l.id === a)?.commit)
    .toBe('synced');
  return a;
}

/** Screen point of a page point (top-left origin, unrotated) on a page. */
async function at(page: Page, x: number, y: number, p = 0) {
  const box = await page.locator(`[data-page="${String(p)}"] .page-content`).boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function marquee(page: Page, from: [number, number], to: [number, number]) {
  await drag(page, await at(page, ...from), await at(page, ...to));
}

async function click(page: Page, x: number, y: number, modifiers: ('Shift' | 'Control')[] = []) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

async function selectComments(page: Page) {
  await page.getByRole('tab', { name: 'Home' }).click();
  const b = page.getByRole('button', { name: 'Select Comments', exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function commentTool(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Comment' }).click();
  const b = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** Every comment written to the Render worker (a save sent now has them all). */
async function written(page: Page, id: string) {
  await expect
    .poll(async () => (await list(page, id)).every((a) => a.commit === 'synced'))
    .toBe(true);
}

/** Saves; each comment's /Rect in the saved tail, by /NM (PDF space, bottom-left origin). */
async function savedRects(page: Page, id: string, annots: string[]): Promise<number[][]> {
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { tail: string } | null;
  const tail = Buffer.from(saved?.tail ?? '', 'base64').toString('latin1');
  const objs = tail.split(/\bendobj\b/);
  return annots.map((annot) => {
    const m = /\/Rect\s*\[([^\]]*)\]/.exec(
      objs.filter((o) => o.includes(`(${annot})`)).at(-1) ?? '',
    );
    return m?.[1] ? m[1].trim().split(/\s+/).map(Number) : [];
  });
}

const PAGE_H = 842;
const near = (a: number | undefined, b: number) => Math.abs((a ?? NaN) - b) < 0.6;

test('Select Comments: a drag on the page selects every comment it touches @smoke', async ({
  page,
}) => {
  const id = await open(page);
  const a = await square(page, id, 100, 120);
  const b = await square(page, id, 300, 120);
  const c = await square(page, id, 100, 300);
  await selectComments(page);
  // The rectangle shows while dragging, in the focus colour.
  const from = await at(page, 80, 100);
  const to = await at(page, 330, 140);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  const rect = page.locator('[data-page="0"] .comment-marquee');
  await expect(rect).toBeVisible();
  await page.mouse.up();
  await expect(rect).toHaveCount(0);
  // b only by its corner: still touched.
  expect(await selected(page, id)).toEqual([a, b].sort());
  // One box with handles around the group, each member outlined.
  await expect(page.locator('[data-page="0"] [data-group-selection-box]')).toHaveCount(1);
  await expect(page.locator('[data-page="0"] .annotation-body[data-selected]')).toHaveCount(2);
  // Starting over the page's text still draws a marquee (no text is selected).
  await marquee(page, [80, 60], [240, 330]);
  expect(await selected(page, id)).toEqual([a, c].sort());
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  expect(((await cap(page, 'view', 'selection')) as { selection: unknown }).selection).toBeNull();
  // A drag over nothing clears the selection; a click on empty space too.
  await marquee(page, [400, 300], [500, 400]);
  expect(await selected(page, id)).toEqual([]);
});

test('the marquee never selects form fields', async ({ page }) => {
  const id = await open(page, 1, fullFormPdf());
  const a = await square(page, id, 330, 240);
  await selectComments(page);
  // Over the check box, the radio buttons and the Size list (PDF y 490…596).
  await marquee(page, [40, 230], [340, 360]);
  expect(await selected(page, id)).toEqual([a]);
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await marquee(page, [40, 230], [340, 360]);
  expect(await selected(page, id)).toEqual([a]);
});

test('Select: a drag off the text marquee-selects comments; over the text it selects text', async ({
  page,
}) => {
  const id = await open(page);
  const a = await square(page, id, 300, 200);
  // Under the end of the text drag below: a marquee from there would touch it.
  const b = await square(page, id, 150, 60);
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await marquee(page, [280, 180], [330, 230]);
  expect(await selected(page, id)).toEqual([a]);
  await view(page).press('Escape');
  // "Page 1" is drawn at 72, 740 (PDF space), 36 pt: a drag across it selects text.
  await marquee(page, [74, PAGE_H - 752], [160, PAGE_H - 748]);
  await expect
    .poll(async () => ((await cap(page, 'view', 'selection')) as { selection: unknown }).selection)
    .not.toBeNull();
  expect(await selected(page, id)).not.toContain(b);
  // Select Text never marquee-selects.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Select Text', exact: true }).click();
  await marquee(page, [280, 180], [330, 230]);
  expect(await selected(page, id)).toEqual([]);
  await expect(page.locator('.comment-marquee')).toHaveCount(0);
});

test('Shift+click adds or removes a comment; Ctrl+A selects the page’s comments; Esc clears', async ({
  page,
}) => {
  const id = await open(page);
  const a = await square(page, id, 100, 100);
  const b = await square(page, id, 300, 100);
  const c = await square(page, id, 100, 250);
  const other = await square(page, id, 100, 100, 1);
  await selectComments(page);
  await click(page, 160, 101);
  expect(await selected(page, id)).toEqual([a]);
  await click(page, 360, 101, ['Shift']);
  expect(await selected(page, id)).toEqual([a, b].sort());
  await click(page, 160, 251, ['Shift']);
  expect(await selected(page, id)).toEqual([a, b, c].sort());
  // On a selected one (under the group box): out, then back in.
  await click(page, 160, 101, ['Shift']);
  expect(await selected(page, id)).toEqual([b, c].sort());
  await click(page, 160, 101, ['Shift']);
  expect(await selected(page, id)).toEqual([a, b, c].sort());
  // Ctrl+click works the same on a selected one.
  await click(page, 360, 101, ['Control']);
  expect(await selected(page, id)).toEqual([a, c].sort());
  // Shift held, a marquee adds to the selection.
  await page.keyboard.down('Shift');
  await marquee(page, [280, 80], [330, 120]);
  await page.keyboard.up('Shift');
  expect(await selected(page, id)).toEqual([a, b, c].sort());
  await view(page).press('Escape');
  expect(await selected(page, id)).toEqual([]);
  await view(page).press('Control+a');
  expect(await selected(page, id)).toEqual([a, b, c].sort());
  expect(await selected(page, id)).not.toContain(other);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  await view(page).press('Escape');
  expect(await selected(page, id)).toEqual([]);
});

test('the selected group moves, nudges and deletes as one undo step, and is saved', async ({
  page,
}) => {
  const id = await open(page);
  const a = await square(page, id, 100, 100);
  const b = await square(page, id, 300, 200);
  await selectComments(page);
  await marquee(page, [80, 80], [440, 280]);
  expect(await selected(page, id)).toEqual([a, b].sort());
  // Drag the group by a's border: both move by the same offset.
  const p = await at(page, 160, 101);
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  const s = (box?.width ?? 595) / 595;
  await drag(page, p, { x: p.x + 40 * s, y: p.y + 30 * s });
  await expect.poll(() => rectOf(page, id, a)).toEqual({ x: 140, y: 130 });
  expect(await rectOf(page, id, b)).toEqual({ x: 340, y: 230 });
  await written(page, id);
  const [ra, rb] = await savedRects(page, id, [a, b]);
  expect(near(ra?.[0], 140)).toBe(true);
  expect(near(rb?.[3], PAGE_H - 230)).toBe(true);
  // Ctrl+Z puts both back at once.
  await view(page).press('Control+z');
  await expect.poll(() => rectOf(page, id, a)).toEqual({ x: 100, y: 100 });
  expect(await rectOf(page, id, b)).toEqual({ x: 300, y: 200 });
  await view(page).press('Control+y');
  await expect.poll(() => rectOf(page, id, b)).toEqual({ x: 340, y: 230 });
  // Arrow keys nudge every member; one undo step each.
  await view(page).press('ArrowRight');
  await view(page).press('Shift+ArrowDown');
  await expect.poll(() => rectOf(page, id, a)).toEqual({ x: 141, y: 140 });
  expect(await rectOf(page, id, b)).toEqual({ x: 341, y: 240 });
  await view(page).press('Control+z');
  await expect.poll(() => rectOf(page, id, a)).toEqual({ x: 141, y: 130 });
  expect(await rectOf(page, id, b)).toEqual({ x: 341, y: 230 });
  // Delete removes both; one Ctrl+Z brings both back.
  await view(page).press('Delete');
  await expect.poll(async () => (await list(page, id)).length).toBe(0);
  await view(page).press('Control+z');
  await expect.poll(async () => (await list(page, id)).length).toBe(2);
});

test('ten quick nudges end where ten slow ones do, and are saved (B13)', async ({ page }) => {
  const id = await open(page);
  const quick = await square(page, id, 100, 100);
  const slow = await square(page, id, 100, 250);
  await selectComments(page);
  await click(page, 160, 101);
  expect(await selected(page, id)).toEqual([quick]);
  // Ten presses in one go: all but the first land while the first move is
  // being written (a held key on a busy worker, without the timing luck).
  await view(page).focus();
  await page.evaluate(() => {
    const el = document.activeElement ?? document.body;
    for (let i = 0; i < 10; i++)
      for (const type of ['keydown', 'keyup'])
        el.dispatchEvent(
          new KeyboardEvent(type, { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }),
        );
  });
  await click(page, 160, 251);
  for (let i = 0; i < 10; i++) {
    await view(page).press('ArrowRight');
    await written(page, id);
  }
  await written(page, id);
  expect(await rectOf(page, id, quick)).toEqual({ x: 110, y: 100 });
  expect(await rectOf(page, id, slow)).toEqual({ x: 110, y: 250 });
  const [rq, rs] = await savedRects(page, id, [quick, slow]);
  expect(near(rq?.[0], 110)).toBe(true);
  expect(near(rs?.[0], 110)).toBe(true);
});

test('a new rectangle is selected right after it is drawn; the tool stays on (B9)', async ({
  page,
}) => {
  const id = await open(page);
  await commentTool(page, 'Rectangle');
  await drag(page, await at(page, 100, 100), await at(page, 220, 160));
  await expect.poll(async () => (await list(page, id)).length).toBe(1);
  const first = (await list(page, id))[0]?.id ?? '';
  const firstAt = await rectOf(page, id, first);
  await expect.poll(() => selected(page, id)).toEqual([first]);
  await expect(page.locator('[data-page="0"] .annotation-body[data-selected]')).toHaveCount(1);
  // The Properties pane follows.
  await expect(page.getByText('Select a comment to see its properties.')).toHaveCount(0);
  // The next press on empty space starts the next one, which is then the selected one.
  await drag(page, await at(page, 300, 100), await at(page, 420, 160));
  await expect.poll(async () => (await list(page, id)).length).toBe(2);
  const second = (await list(page, id)).find((l) => l.id !== first)?.id ?? '';
  await expect.poll(() => selected(page, id)).toEqual([second]);
  await expect(
    page
      .getByRole('toolbar', { name: 'Comment commands' })
      .getByRole('button', { name: 'Rectangle', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  // A press on the earlier one (locked while the tool is on) draws, never picks it up.
  await drag(page, await at(page, 160, 130), await at(page, 200, 200));
  await expect.poll(async () => (await list(page, id)).length).toBe(3);
  expect(await rectOf(page, id, first)).toEqual(firstAt);
  // Delete acts on the selected new one at once.
  const third = (await selected(page, id))[0] ?? '';
  expect([first, second]).not.toContain(third);
  await view(page).press('Delete');
  await expect.poll(async () => (await list(page, id)).length).toBe(2);
});

test('on a rotated page the marquee selects the comments under it', async ({ page }) => {
  const id = await open(page, 1);
  const a = await square(page, id, 100, 100);
  const b = await square(page, id, 350, 600);
  await selectComments(page);
  await page.getByRole('tab', { name: 'View' }).click();
  await page
    .getByRole('toolbar', { name: 'View' })
    .getByRole('button', { name: 'Rotate View Clockwise' })
    .click();
  await expect
    .poll(async () => {
      const r = await page.locator('[data-page="0"]').boundingBox();
      return r ? r.width > r.height : false;
    })
    .toBe(true);
  // a's box after a quarter turn clockwise: the page's left edge is now on top.
  const box = await page
    .locator(`[data-page="0"] .annotation-body[data-annotation-id="${a}"]`)
    .boundingBox();
  if (!box) throw new Error('no body');
  await drag(
    page,
    { x: box.x - 10, y: box.y - 10 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(await selected(page, id)).toEqual([a]);
  expect(await selected(page, id)).not.toContain(b);
});

test('hollow shapes select by their border, filled ones anywhere (B14, as PDF-XChange)', async ({
  page,
}) => {
  const id = await open(page);
  const hollow = await square(page, id, 100, 100);
  const filled = await square(page, id, 300, 100);
  await cap(page, 'annotate', 'update', id, 0, filled, { color: '#ffff00' });
  await written(page, id);
  await selectComments(page);
  await click(page, 160, 130);
  expect(await selected(page, id)).toEqual([]);
  await click(page, 160, 101);
  expect(await selected(page, id)).toEqual([hollow]);
  await click(page, 360, 130);
  expect(await selected(page, id)).toEqual([filled]);
});
