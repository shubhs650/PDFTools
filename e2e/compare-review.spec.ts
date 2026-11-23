import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, darkTheme } from './support/app.ts';
import { hideDifferences, overlayDrawn, overlayOf, overlayView } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M12-12 (D-62): the Review layout. The overlay large on the left, Document A
// top right, Document B bottom right, with splitters; or the overlay alone.
// All three are live document windows: every comment tool, the Properties
// pane, the context menus and undo act on the window in use, and what is
// drawn on the overlay window is a note of the comparison, never part of A
// or B. With the lock on, the windows show the same spot of the drawing
// through the alignment, at matching zoom; a crosshair marks the pointer's
// spot in the other windows.

type Role = 'overlay' | 'a' | 'b';
const ROLES: readonly Role[] = ['overlay', 'a', 'b'];

const win = (page: Page, role: Role) => page.getByTestId(`review-window-${role}`);
const viewport = (page: Page, role: Role) => win(page, role).locator('.viewport');

interface Listed {
  id: string;
  type: number;
}

const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];

/** The document each window shows. */
async function docIds(page: Page): Promise<Record<Role, string>> {
  const out = {} as Record<Role, string>;
  for (const role of ROLES) {
    const id = await viewport(page, role).getAttribute('data-doc-id');
    if (!id) throw new Error(`no document in window ${role}`);
    out[role] = id;
  }
  return out;
}

interface Spot {
  /** The centre of the part of the sheet in view, as a fraction of the page. */
  fx: number;
  fy: number;
  /** Whether the whole sheet is in view across (x) or down (y): no spot to match there. */
  allX: boolean;
  allY: boolean;
  /** The page's width on screen (CSS px). */
  w: number;
}

/** Where each window is: the spot of its sheet at its centre and the sheet's size on screen. */
async function spots(page: Page): Promise<Record<Role, Spot | null>> {
  return page.evaluate(() => {
    const out: Record<string, Spot | null> = {};
    for (const role of ['overlay', 'a', 'b']) {
      const host = document.querySelector(`[data-testid="review-window-${role}"]`);
      const vp = host?.querySelector<HTMLElement>('.viewport');
      const pageEl = vp?.querySelector<HTMLElement>('.page:not([data-hidden])');
      if (!vp || !pageEl) {
        out[role] = null;
        continue;
      }
      const v = vp.getBoundingClientRect();
      const r = pageEl.getBoundingClientRect();
      // The centre of the part of the sheet in view (the whole sheet when it fits).
      const left = Math.max(v.left, r.left);
      const right = Math.min(v.left + vp.clientWidth, r.right);
      const top = Math.max(v.top, r.top);
      const bottom = Math.min(v.top + vp.clientHeight, r.bottom);
      out[role] = {
        fx: ((left + right) / 2 - r.left) / r.width,
        fy: ((top + bottom) / 2 - r.top) / r.height,
        allX: right - left >= r.width - 1,
        allY: bottom - top >= r.height - 1,
        w: r.width,
      };
    }
    return out;
  });
}

/**
 * The windows show the same spot, at matching zoom: here the sheets are the same
 * drawing (pair 15's A3 is its A1 scaled), so the same fraction of each page.
 * Across or down, a window that shows the whole sheet has nothing to match (the
 * sheet sits in the middle of it); there only the zoom is compared.
 */
async function expectLinked(page: Page, tol = 0.012): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await spots(page);
        const o = s.overlay;
        if (!o || !s.a || !s.b) return 'not laid out';
        const off = (x: Spot) =>
          Math.max(
            x.allX || o.allX ? 0 : Math.abs(x.fx - o.fx),
            x.allY || o.allY ? 0 : Math.abs(x.fy - o.fy),
            Math.abs(x.w / o.w - 1),
          );
        return Math.max(off(s.a), off(s.b)) <= tol ? 'linked' : JSON.stringify(s);
      },
      { timeout: 10_000 },
    )
    .toBe('linked');
}

async function centreOf(page: Page, role: Role): Promise<{ x: number; y: number }> {
  const box = await viewport(page, role).boundingBox();
  if (!box) throw new Error(`window ${role} not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The centre of the part of a window's page in view. */
async function pageCentre(page: Page, role: Role): Promise<{ x: number; y: number }> {
  const v = await viewport(page, role).boundingBox();
  const p = await viewport(page, role).locator('.page:not([data-hidden])').boundingBox();
  if (!v || !p) throw new Error(`window ${role} not on screen`);
  const left = Math.max(v.x, p.x);
  const right = Math.min(v.x + v.width, p.x + p.width);
  const top = Math.max(v.y, p.y);
  const bottom = Math.min(v.y + v.height, p.y + p.height);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

async function tool(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Comment' }).click();
  const b = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name, exact: true });
  // A tool drawn with goes back to Select after its comment is placed (B9): press it again.
  await expect(async () => {
    if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
  }).toPass();
}

/** Draws a rectangle about the centre of a window. */
async function rectangleIn(page: Page, role: Role, dx = 0): Promise<void> {
  const c = await centreOf(page, role);
  await page.mouse.move(c.x - 30 + dx, c.y - 20);
  await page.mouse.down();
  await page.mouse.move(c.x + 30 + dx, c.y + 20, { steps: 6 });
  await page.mouse.up();
}

const docsState = (page: Page) =>
  page.evaluate(() => {
    const s = (
      window as unknown as {
        __pdftoolsTest: {
          capabilities: {
            stores: {
              documents: {
                getState: () => {
                  activeId: string | null;
                  order: string[];
                  docs: Record<string, { dirty: boolean; meta: { role?: string } }>;
                };
              };
            };
          };
        };
      }
    ).__pdftoolsTest.capabilities.stores.documents.getState();
    return {
      activeId: s.activeId,
      order: s.order,
      docs: Object.fromEntries(
        Object.entries(s.docs).map(([k, d]) => [k, { dirty: d.dirty, role: d.meta.role ?? null }]),
      ),
    };
  });

test('three live windows: comments, the Properties pane, the context menu and undo act on the window in use; notes stay out of A and B @smoke', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '01');
  await hideDifferences(page);
  await skipReviewerPrompt(page);
  for (const role of ROLES) await expect(win(page, role)).toBeVisible();
  await expect(win(page, 'a')).toContainText('Document A (old): Pair 01 RevA.pdf, page 1');
  await expect(win(page, 'b')).toContainText('Document B (new): Pair 01 RevB.pdf, page 1');
  const ids = await docIds(page);
  // The overlay window is a document of its own: the comparison's notes, without a tab.
  const before = await docsState(page);
  expect(before.docs[ids.overlay]?.role).toBe('notes');
  expect(before.order).not.toContain(ids.overlay);
  expect(before.activeId).toBe(ids.overlay);
  for (const role of ROLES) expect(await list(page, ids[role])).toEqual([]);

  // The Rectangle tool draws in each window, into that window's document only.
  await tool(page, 'Rectangle');
  for (const role of ROLES) {
    await rectangleIn(page, role);
    await expect.poll(async () => (await list(page, ids[role])).length).toBe(1);
    expect((await docsState(page)).activeId).toBe(ids[role]);
    await tool(page, 'Rectangle');
  }
  for (const role of ROLES) {
    const l = await list(page, ids[role]);
    expect(l.map((a) => a.type)).toEqual([T.SQUARE]);
  }
  // A and B carry their own comment, never the overlay's note.
  const after = await docsState(page);
  expect(after.docs[ids.a]?.dirty).toBe(true);
  expect(after.docs[ids.b]?.dirty).toBe(true);

  // The Properties pane follows the window in use: B's rectangle is selected there.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page
    .getByRole('toolbar', { name: 'Home commands' })
    .getByRole('button', { name: 'Select', exact: true })
    .click();
  const bId = (await list(page, ids.b))[0]?.id;
  await cap(page, 'annotate', 'select', ids.b, 0, bId);
  const pane = page.getByTestId('properties-pane');
  if (!(await pane.isVisible()))
    await page.getByRole('button', { name: 'Show Properties pane' }).click();
  await expect(pane).toContainText('Rectangle');

  // The comment menu in B: right click on the rectangle's edge, Delete removes
  // B's rectangle and nothing else.
  const body = win(page, 'b').locator(`.annotation-body[data-annotation-id="${bId ?? ''}"]`);
  const box = await body.boundingBox();
  if (!box) throw new Error('B’s rectangle is not on screen');
  await page.mouse.click(box.x + 1.5, box.y + box.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Comment' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete Selected Comments' }).click();
  await expect.poll(async () => (await list(page, ids.b)).length).toBe(0);
  expect((await list(page, ids.a)).length).toBe(1);
  expect((await list(page, ids.overlay)).length).toBe(1);

  // Undo in the overlay window undoes the overlay's note only; redo brings it back.
  await viewport(page, 'overlay').focus();
  await expect.poll(async () => (await docsState(page)).activeId).toBe(ids.overlay);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await list(page, ids.overlay)).length).toBe(0);
  expect((await list(page, ids.a)).length).toBe(1);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await list(page, ids.overlay)).length).toBe(1);

  // The notes are never saved as a file of their own: Save in the overlay window is Save
  // review (M12-20, D-65), which saves A and B; the notes go with Save Comparison….
  const save = page
    .getByRole('toolbar', { name: 'Quick access toolbar' })
    .getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await viewport(page, 'a').focus();
  await expect(save).toBeEnabled();
});

// PdfAnnotationSubtype values.
const T = { TEXT: 1, FREETEXT: 3, LINE: 4, SQUARE: 5, CIRCLE: 6, POLYGON: 7, POLYLINE: 8, INK: 15 };
type Gesture = { kind: 'drag'; steps?: number } | { kind: 'clicks' };
const DRAWN: { name: string; type: number; how: Gesture }[] = [
  { name: 'Rectangle', type: T.SQUARE, how: { kind: 'drag' } },
  { name: 'Oval', type: T.CIRCLE, how: { kind: 'drag' } },
  { name: 'Line', type: T.LINE, how: { kind: 'drag' } },
  { name: 'Arrow', type: T.LINE, how: { kind: 'drag' } },
  { name: 'Pencil', type: T.INK, how: { kind: 'drag', steps: 16 } },
  { name: 'Polyline', type: T.POLYLINE, how: { kind: 'clicks' } },
  { name: 'Polygon', type: T.POLYGON, how: { kind: 'clicks' } },
  { name: 'Cloud', type: T.POLYGON, how: { kind: 'clicks' } },
];

/** Draws with the tool in use in cell `i` of a 3-wide grid about the centre of a window. */
async function drawIn(page: Page, role: Role, how: Gesture, i: number): Promise<void> {
  const c = await pageCentre(page, role);
  const x = c.x + ((i % 3) - 1) * 90;
  const y = c.y - 90 + Math.floor(i / 3) * 60;
  if (how.kind === 'drag') {
    await page.mouse.move(x - 35, y);
    await page.mouse.down();
    await page.mouse.move(x + 35, y + 30, { steps: how.steps ?? 6 });
    await page.mouse.up();
    return;
  }
  const pts: [number, number][] = [
    [x - 35, y],
    [x, y + 36],
    [x + 35, y],
  ];
  for (const [k, [px, py]] of pts.entries()) {
    await page.mouse.move(px, py, { steps: 4 });
    if (k === pts.length - 1) await page.mouse.dblclick(px, py);
    else await page.mouse.click(px, py);
  }
}

test('each comment tool, the note and text box keys and the page menu work in each window, into its own document', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '01');
  await hideDifferences(page);
  await skipReviewerPrompt(page);
  const ids = await docIds(page);
  for (const role of ROLES) {
    const types = async () => (await list(page, ids[role])).map((a) => a.type);
    const want: number[] = [];
    for (const [i, t] of DRAWN.entries()) {
      await tool(page, t.name);
      await drawIn(page, role, t.how, i);
      want.push(t.type);
      await expect.poll(async () => (await types()).sort()).toEqual([...want].sort());
    }
    // The keys: N then Enter places a sticky note, T then Enter a text box.
    await viewport(page, role).focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    await page.keyboard.press('Enter');
    const note = win(page, role).getByRole('dialog', { name: /^Sticky note by / });
    await expect(note.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await page.keyboard.type(`Note in ${role}`);
    await page.keyboard.press('Control+Enter');
    want.push(T.TEXT);
    await expect.poll(async () => (await types()).sort()).toEqual([...want].sort());
    await viewport(page, role).focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await page.keyboard.press('Enter');
    await expect(
      win(page, role).locator('[data-text-comment] [contenteditable="true"]'),
    ).toBeFocused();
    await page.keyboard.type(`Text in ${role}`);
    await page.keyboard.press('Escape');
    want.push(T.FREETEXT);
    await expect.poll(async () => (await types()).sort()).toEqual([...want].sort());

    // The page menu on an empty spot of the window's page.
    await viewport(page, role).focus();
    await page.keyboard.press('Escape');
    const c = await pageCentre(page, role);
    await page.mouse.click(c.x, c.y + 110, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Page' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Select All' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
  // Each window's comments went into its own document only.
  for (const role of ROLES) expect(await list(page, ids[role])).toHaveLength(DRAWN.length + 2);
});

test('aligned sync: the windows keep the same spot after zoom and pan; the lock and the linked pointer (pair 15: A1 against A3)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '15');
  await expectLinked(page);

  // Ctrl+wheel in A (A leads): B and the overlay follow at the matching zoom.
  const w0 = (await spots(page)).overlay?.w ?? 0;
  const a = await centreOf(page, 'a');
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await spots(page)).overlay?.w ?? 0).toBeGreaterThan(w0 * 1.2);
  await expectLinked(page);

  // Pan B with the Hand tool (B leads).
  await viewport(page, 'b').focus();
  await page.keyboard.press('h');
  const b = await centreOf(page, 'b');
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x - 120, b.y - 60, { steps: 8 });
  await page.mouse.up();
  await expectLinked(page);
  await overlayDrawn(page);

  // The linked pointer: over the overlay, a crosshair at the same spot in A and B.
  const o = await centreOf(page, 'overlay');
  await page.mouse.move(o.x + 10, o.y + 10);
  await expect(page.getByTestId('review-crosshair-a')).toBeVisible();
  await expect(page.getByTestId('review-crosshair-b')).toBeVisible();
  await expect(page.getByTestId('review-crosshair-overlay')).toBeHidden();
  // At the same spot of the drawing: the same fraction of each page here.
  const frac = async (role: Role, x: number, y: number) => {
    const r = await win(page, role).locator('.viewport .page:not([data-hidden])').boundingBox();
    if (!r) throw new Error(`no page in ${role}`);
    return { fx: (x - r.x) / r.width, fy: (y - r.y) / r.height };
  };
  const at = await frac('overlay', o.x + 10, o.y + 10);
  for (const role of ['a', 'b'] as const) {
    const mark = await page.getByTestId(`review-crosshair-${role}`).boundingBox();
    if (!mark) throw new Error('no crosshair');
    const there = await frac(role, mark.x + mark.width / 2, mark.y + mark.height / 2);
    expect(Math.abs(there.fx - at.fx)).toBeLessThan(0.01);
    expect(Math.abs(there.fy - at.fy)).toBeLessThan(0.01);
  }

  // Lock off: panning the overlay leaves A and B where they are.
  await page.getByRole('button', { name: 'Keep the windows on the same spot' }).click();
  const held = await spots(page);
  await viewport(page, 'overlay').evaluate((el) => {
    el.scrollLeft += 150;
    el.scrollTop += 90;
  });
  await expect
    .poll(async () => {
      const now = await spots(page);
      return (now.overlay?.fx ?? 0) - (held.overlay?.fx ?? 0);
    })
    .toBeGreaterThan(0.01);
  const now = await spots(page);
  expect(Math.abs((now.a?.fx ?? 0) - (held.a?.fx ?? 0))).toBeLessThan(0.002);
  // Lock on again: A and B come to the overlay's spot.
  await page.getByRole('button', { name: 'Keep the windows on the same spot' }).click();
  await expectLinked(page);
});

test('a sheet change shows each document’s page of the new sheet, still linked; Overlay only and the splitters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '07');
  const list = page.getByRole('listbox', { name: 'Sheets of this comparison' });
  await list.focus();
  await page.keyboard.press('ArrowDown');
  await expect(win(page, 'a')).toContainText('page 2');
  await expect(win(page, 'b')).toContainText('page 2');
  await overlayDrawn(page);
  await expectLinked(page, 0.02);

  // The splitters: keys and a drag; the windows stay linked.
  const x = page.getByRole('separator', { name: 'Resize the overlay and the documents' });
  const y = page.getByRole('separator', { name: 'Resize Document A and Document B' });
  await expect(x).toHaveAttribute('aria-valuenow', '60');
  await x.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(x).toHaveAttribute('aria-valuenow', '58');
  const yBox = await y.boundingBox();
  if (!yBox) throw new Error('no splitter');
  await page.mouse.move(yBox.x + yBox.width / 2, yBox.y + 1);
  await page.mouse.down();
  await page.mouse.move(yBox.x + yBox.width / 2, yBox.y - 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await y.getAttribute('aria-valuenow'))).toBeLessThan(45);
  await expectLinked(page, 0.02);

  // Overlay only: A and B go; Review brings them back.
  await page.getByRole('button', { name: 'Overlay only' }).click();
  await expect(win(page, 'a')).toHaveCount(0);
  await expect(win(page, 'b')).toHaveCount(0);
  await overlayDrawn(page);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(win(page, 'a')).toBeVisible();
  await expectLinked(page, 0.02);
});

test('a sheet only one revision has: the other window says so', async ({ page }) => {
  await overlayOf(page, '05');
  const sheets = page.getByRole('listbox', { name: 'Sheets of this comparison' });
  const added = sheets.locator('.overlay-sheet[data-kind="added"]').first();
  await added.click();
  await expect(win(page, 'a')).toContainText("This sheet isn't in Document A.");
  await expect(win(page, 'b')).toContainText('Document B (new)');
  await expect(overlayView(page)).toHaveAttribute('data-complete', 'true', { timeout: 30_000 });
});

test('the Review layout passes axe in light and dark; windows and splitters are keyboard reachable @a11y', async ({
  page,
}) => {
  await overlayOf(page, '07');
  const axe = async (): Promise<void> => {
    const r = await new AxeBuilder({ page }).include('[data-testid="compare-result"]').analyze();
    expect(r.violations).toEqual([]);
  };
  await axe();
  await darkTheme(page);
  await axe();
  for (const role of ROLES) {
    await viewport(page, role).focus();
    await expect(viewport(page, role)).toBeFocused();
  }
  await page.getByRole('separator', { name: 'Resize Document A and Document B' }).focus();
  await page.keyboard.press('End');
  await expect(
    page.getByRole('separator', { name: 'Resize Document A and Document B' }),
  ).not.toHaveAttribute('aria-valuenow', '50');
});
