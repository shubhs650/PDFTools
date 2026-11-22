// Spike S27 (M12-02): several documents on screen together, with the app's
// real view layer (src/features/view) mounted once per window. Numbers go to
// test-results/s27-results.json and the test annotations; the findings are in
// RESULTS.md (input for ADR-032).
//
//   SPIKE=s27 PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run spikes -- --project=s27
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { A0_LINK, A1_PT, A3_PT } from './fixtures.ts';

const results: Record<string, unknown> = {};

const note = (key: string, value: unknown): void => {
  results[key] = value;
  test.info().annotations.push({ type: key, description: JSON.stringify(value) });
};

/** Calls window.__s27[name](...args) in the page. */
function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([n, a]) =>
      (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>).__s27?.[
        n
      ]?.(...a) as T,
    [name, args] as const,
  );
}

/** The e2e test hook's capabilities (src/testing). */
function probe<T>(page: Page, cap: string, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([c, n, a]) => {
      const hook = (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: Record<string, Record<string, (...x: unknown[]) => unknown>>;
          };
        }
      ).__pdftoolsTest;
      return hook.capabilities[c]?.[n]?.(...a) as T;
    },
    [cap, name, args] as const,
  );
}

const comments = async (page: Page, id: string): Promise<number> =>
  ((await probe<unknown[] | null>(page, 'annotate', 'list', id)) ?? []).length;

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => '__s27' in window && '__pdftoolsTest' in window);
}

async function openLayout(page: Page, kind: string, names: string[]): Promise<string[]> {
  const ids = await call<string[]>(page, 'open', names);
  await call(page, 'layout', kind, ids);
  for (const id of ids)
    await expect(page.locator(`[data-s27-doc="${id}"] img.page-preview`).first()).toBeVisible();
  return ids;
}

const win = (page: Page, id: string) => page.locator(`[data-s27-doc="${id}"]`);

async function box(page: Page, id: string) {
  const b = await win(page, id).boundingBox();
  if (!b) throw new Error('no window');
  return b;
}

/** A drag with the mouse inside a window, at fractions of its box. */
async function drag(page: Page, id: string, from: [number, number], to: [number, number]) {
  const b = await box(page, id);
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 8 });
  await page.mouse.up();
}

/** Resident memory of the largest renderer process (the page and its workers), MB. */
function rendererRssMb(): number | null {
  try {
    const lines = execSync('ps -eo rss=,args=', { encoding: 'utf8' }).split('\n');
    const rss = lines
      .filter((l) => l.includes('--type=renderer') && !l.includes('--extension-process'))
      .map((l) => Number(l.trim().split(/\s+/)[0]) / 1024);
    return rss.length ? Math.max(...rss) : null;
  } catch {
    return null;
  }
}

async function settle(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(
      async () =>
        Math.min(...(await Promise.all(ids.map((id) => call<number>(page, 'coverage', id))))),
      {
        timeout: 30_000,
      },
    )
    .toBe(1);
}

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/s27-results.json', JSON.stringify(results, null, 2));
});

test('two and three documents on screen: each window has its own tiles, zoom and pan', async ({
  page,
}) => {
  await start(page);
  expect(await call<boolean>(page, 'keyedTiles', true)).toBe(true);
  const [a, b] = await openLayout(page, 'two', ['a0-a.pdf', 'a0-b.pdf']);
  if (!a || !b) throw new Error('ids');
  await call(page, 'zoom', a, 2);
  await call(page, 'zoom', b, 0.5);
  await settle(page, [a, b]);
  const va = await call<{ scale: number }>(page, 'viewCentre', a);
  const vb = await call<{ scale: number }>(page, 'viewCentre', b);
  expect(va.scale).toBeCloseTo(2, 2);
  expect(vb.scale).toBeCloseTo(0.5, 2);
  // Pan one window: the other stays where it is (not linked).
  const before = await call<{ centre: { x: number } }>(page, 'viewCentre', b);
  await call(page, 'setTool', 'hand');
  await drag(page, a, [0.6, 0.5], [0.3, 0.4]);
  const after = await call<{ centre: { x: number } }>(page, 'viewCentre', b);
  expect(after.centre.x).toBeCloseTo(before.centre.x, 3);
  await settle(page, [a, b]);

  // Three windows (the Review layout): overlay large on the left, A and B on the right.
  const [c] = await call<string[]>(page, 'open', ['a0-c.pdf']);
  if (!c) throw new Error('id');
  await call(page, 'layout', 'three', [c, a, b]);
  for (const id of [c, a, b]) await call(page, 'zoom', id, 1.5);
  await settle(page, [c, a, b]);
  const t = await Promise.all([c, a, b].map((id) => call<{ imgs: number }>(page, 'tiles', id)));
  note('tilesPerWindowAt150', t);
  for (const x of t) expect(x.imgs).toBeGreaterThan(0);
});

test('finding: EmbedPDF tiling recalculates one document per 50 ms; keyed by document it covers every window', async ({
  page,
}) => {
  await start(page);
  const ids = await openLayout(page, 'three', ['a0-c.pdf', 'a0-a.pdf', 'a0-b.pdf']);
  const [c, a, b] = ids as [string, string, string];
  await call(page, 'link', { [c]: { ...A0_LINK, inverse: true }, [a]: null, [b]: null });
  await call(page, 'zoom', a, 2);
  await page.waitForTimeout(1500);
  const measure = async (keyed: boolean) => {
    await call(page, 'keyedTiles', keyed);
    await call(page, 'pan', a, 6, 4, 1500);
    await page.waitForTimeout(1000);
    return Promise.all(ids.map((id) => call<number>(page, 'coverage', id)));
  };
  const stock = await measure(false);
  const keyed = await measure(true);
  note('tileCoverageAfterLinkedPan', { stock, keyed });
  // The stock plugin leaves at least one window on its preview…
  expect(Math.min(...stock)).toBeLessThan(0.5);
  // …the keyed listener covers all three.
  expect(Math.min(...keyed)).toBe(1);
});

test('finding: the same document in two windows at once shares one view state (tiles follow one window)', async ({
  page,
}) => {
  await start(page);
  await call(page, 'keyedTiles', true);
  const [a] = await call<string[]>(page, 'open', ['a0-a.pdf']);
  if (!a) throw new Error('id');
  await call(page, 'layout', 'two', [a, a]);
  await call(page, 'zoom', a, 2);
  await page.waitForTimeout(1500);
  // Scroll the second window: EmbedPDF keys viewport, scroll and tiles by document id.
  await page.evaluate(() => {
    const vp = document.querySelectorAll<HTMLElement>('.s27-window .viewport')[1];
    if (vp) {
      vp.scrollTop += 1500;
      vp.scrollLeft += 900;
    }
  });
  await page.waitForTimeout(1500);
  const first = await call<number>(page, 'coverage', a); // the first window
  note('sameDocumentTwoWindowsFirstWindowCoverage', first);
  expect(first).toBeLessThan(0.5);
});

test('comment tools, undo and context menus act on the window they are used in', async ({
  page,
}) => {
  await start(page);
  await call(page, 'keyedTiles', true);
  const ids = await openLayout(page, 'three', ['a0-c.pdf', 'a0-a.pdf', 'a0-b.pdf']);
  const [c, a, b] = ids as [string, string, string];

  // A rectangle in each window, with the real tool and mouse.
  await call(page, 'setTool', 'square');
  for (const id of [c, a, b]) await drag(page, id, [0.3, 0.3], [0.45, 0.45]);
  for (const id of [c, a, b]) await expect.poll(() => comments(page, id)).toBe(1);

  // Ctrl+Z in A undoes A's rectangle only; then in the overlay window, the overlay's.
  await call(page, 'setTool', 'select');
  const ba = await box(page, a);
  await page.mouse.click(ba.x + ba.width * 0.8, ba.y + ba.height * 0.8);
  expect(await call(page, 'active')).toBe(a);
  await page.keyboard.press('Control+z');
  await expect.poll(() => comments(page, a)).toBe(0);
  expect(await comments(page, b)).toBe(1);
  expect(await comments(page, c)).toBe(1);
  const bc = await box(page, c);
  await page.mouse.click(bc.x + bc.width * 0.8, bc.y + bc.height * 0.8);
  await page.keyboard.press('Control+z');
  await expect.poll(() => comments(page, c)).toBe(0);
  expect(await comments(page, b)).toBe(1);
  // Redo in A brings A's back.
  await page.mouse.click(ba.x + ba.width * 0.8, ba.y + ba.height * 0.8);
  await page.keyboard.press('Control+y');
  await expect.poll(() => comments(page, a)).toBe(1);

  // Right-click B's rectangle: the comment menu; Delete removes B's, not A's.
  const bb = await box(page, b);
  const edge = { x: bb.x + bb.width * 0.3, y: bb.y + bb.height * 0.375 };
  await page.mouse.click(edge.x, edge.y, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toHaveAccessibleName('Comment');
  expect(await call(page, 'active')).toBe(b);
  await menu.getByRole('menuitem', { name: 'Delete Selected Comments' }).click();
  await expect.poll(() => comments(page, b)).toBe(0);
  expect(await comments(page, a)).toBe(1);

  // The page menu opens in each window (right-click on empty paper).
  for (const id of [c, a, b]) {
    const w = await box(page, id);
    await page.mouse.click(w.x + w.width * 0.9, w.y + w.height * 0.1, { button: 'right' });
    await expect(page.getByRole('menu')).toHaveAccessibleName('Page');
    expect(await call(page, 'active')).toBe(id);
    await page.keyboard.press('Escape');
  }
});

test('text selection belongs to the window it is made in', async ({ page }) => {
  await start(page);
  const [a, b] = (await openLayout(page, 'two', ['p15-old.pdf', 'p15-new.pdf'])) as [
    string,
    string,
  ];
  await call(page, 'setTool', 'selectText');
  // Across the general notes at the lower left of the sheet (fit width), starting on the text.
  await drag(page, b, [0.045, 0.528], [0.14, 0.545]);
  await expect.poll(() => call<number>(page, 'selectionRects', b)).toBeGreaterThan(0);
  expect(await call<number>(page, 'selectionRects', a)).toBe(0);
  await drag(page, a, [0.045, 0.528], [0.14, 0.545]);
  await expect.poll(() => call<number>(page, 'selectionRects', a)).toBeGreaterThan(0);
  note('selectionRects', {
    a: await call<number>(page, 'selectionRects', a),
    b: await call<number>(page, 'selectionRects', b),
  });
});

test('linked views: corpus pair 15 (A1 against its A3 copy) stays on the same spot through the transform', async ({
  page,
}) => {
  await start(page);
  await call(page, 'keyedTiles', true);
  const [a, b] = (await openLayout(page, 'two', ['p15-old.pdf', 'p15-new.pdf'])) as [
    string,
    string,
  ];
  const k = Math.min(A3_PT.w / A1_PT.w, A3_PT.h / A1_PT.h);
  const tx = (A3_PT.w - A1_PT.w * k) / 2;
  const ty = (A3_PT.h - A1_PT.h * k) / 2;
  await call(page, 'link', { [a]: { k, deg: 0, tx, ty }, [b]: null });
  // Zoom the leader: the follower takes 1/k of it.
  await call(page, 'zoom', a, 3);
  await expect
    .poll(async () => (await call<{ scale: number }>(page, 'viewCentre', b)).scale, {
      timeout: 10_000,
    })
    .toBeCloseTo(3 / k, 2);
  // Pan the leader with the real Hand tool: the follower follows.
  await call(page, 'setTool', 'hand');
  await drag(page, a, [0.7, 0.7], [0.3, 0.35]);
  await page.waitForTimeout(200);
  const e1 = await call<Record<string, number>>(page, 'linkError', a);
  expect(e1.clamped).toBeUndefined();
  // Now B leads (a press in B makes it the leader).
  await drag(page, b, [0.3, 0.3], [0.55, 0.6]);
  await page.waitForTimeout(200);
  const e2 = await call<Record<string, number>>(page, 'linkError', b);
  expect(e2.clamped).toBeUndefined();
  note('pair15LinkErrorPx', { aLeads: e1, bLeads: e2, k });
  expect(Math.max(...Object.values(e1))).toBeLessThan(1);
  expect(Math.max(...Object.values(e2))).toBeLessThan(1);
});

test('one document in its own tab and in a comparison: one set of comments, one undo history, the tab keeps its own view', async ({
  page,
}) => {
  await start(page);
  await call(page, 'keyedTiles', true);
  const [a, b] = await call<string[]>(page, 'open', ['a0-a.pdf', 'a0-b.pdf']);
  if (!a || !b) throw new Error('ids');
  // Its own tab: zoom, a place, a rectangle.
  await call(page, 'layout', 'single', [a]);
  await expect(win(page, a).locator('img.page-preview').first()).toBeVisible();
  await call(page, 'zoom', a, 1.25);
  await page.waitForTimeout(500);
  await call(page, 'centreOn', a, { x: 1200, y: 900 });
  await call(page, 'setTool', 'square');
  await drag(page, a, [0.4, 0.4], [0.5, 0.5]);
  await expect.poll(() => comments(page, a)).toBe(1);
  await call(page, 'setTool', 'select');
  const tabView = await call<{ scale: number; centre: { x: number; y: number } }>(
    page,
    'stashView',
    a,
  );

  // The comparison: the same document id in its window; the comment is there.
  await call(page, 'layout', 'two', [a, b]);
  await expect(win(page, a).locator('[data-annotation-id]')).toHaveCount(1);
  await expect.poll(() => probe(page, 'view', 'dirty', a)).toBe(true);
  await call(page, 'zoom', a, 0.4);
  await page.waitForTimeout(500);
  // Undo in the comparison undoes the tab's edit: one history.
  const ba = await box(page, a);
  await page.mouse.click(ba.x + 20, ba.y + ba.height - 20);
  await page.keyboard.press('Control+z');
  await expect.poll(() => comments(page, a)).toBe(0);
  await page.keyboard.press('Control+y');
  await expect.poll(() => comments(page, a)).toBe(1);

  // Back to the tab: EmbedPDF keeps ONE view state per document, so the tab
  // comes back at the comparison's zoom…
  await call(page, 'layout', 'single', [a]);
  await expect(win(page, a).locator('img.page-preview').first()).toBeVisible();
  await page.waitForTimeout(300);
  const raw = await call<{ scale: number }>(page, 'viewCentre', a);
  // …unless the comparison stashes and restores the tab's place.
  await call(page, 'restoreView', a, tabView);
  const back = await call<{ scale: number; centre: { x: number; y: number } }>(
    page,
    'viewCentre',
    a,
  );
  note('sameDocumentView', { tab: tabView, comingBackRaw: raw.scale, restored: back });
  expect(raw.scale).toBeCloseTo(0.4, 2);
  expect(back.scale).toBeCloseTo(tabView.scale, 2);
  expect(
    Math.hypot(back.centre.x - tabView.centre.x, back.centre.y - tabView.centre.y) * back.scale,
  ).toBeLessThan(1);
});

test('measures: memory with three A0 sheets, frame time panning three linked windows, long tasks', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await start(page);
  await call(page, 'keyedTiles', true);
  await page.waitForTimeout(500);
  const mem: Record<string, unknown> = {
    idle: { uaMemory: await call(page, 'memory'), rssMb: rendererRssMb() },
  };

  const [a] = await call<string[]>(page, 'open', ['a0-a.pdf']);
  if (!a) throw new Error('id');
  await call(page, 'layout', 'single', [a]);
  await settle(page, [a]);
  await page.waitForTimeout(1000);
  mem.oneA0Fit = { uaMemory: await call(page, 'memory'), rssMb: rendererRssMb() };

  const [c, b] = await call<string[]>(page, 'open', ['a0-c.pdf', 'a0-b.pdf']);
  if (!c || !b) throw new Error('ids');
  await call(page, 'layout', 'three', [c, a, b]);
  await settle(page, [c, a, b]);
  await page.waitForTimeout(1000);
  mem.threeA0Fit = { uaMemory: await call(page, 'memory'), rssMb: rendererRssMb() };

  await call(page, 'link', { [c]: { ...A0_LINK, inverse: true }, [a]: null, [b]: null });
  const frames: Record<string, unknown> = {};
  for (const z of [1, 4]) {
    await call(page, 'zoom', a, z);
    await page.waitForTimeout(1500);
    await settle(page, [c, a, b]);
    const linked = await call<Record<string, unknown>>(page, 'pan', a, 8, 5, 4000);
    await call(page, 'setLinked', false);
    const alone = await call<Record<string, unknown>>(page, 'pan', a, 8, 5, 4000);
    await call(page, 'setLinked', true);
    await page.waitForTimeout(1000);
    frames[`zoom${String(z * 100)}`] = {
      linkedThree: { ...linked, longTasks: linked.longTasks },
      leaderOnly: { ...alone, longTasks: alone.longTasks },
      coverageAfter: await Promise.all([c, a, b].map((id) => call<number>(page, 'coverage', id))),
    };
    mem[`threeA0Zoom${String(z * 100)}AfterPan`] = {
      uaMemory: await call(page, 'memory'),
      rssMb: rendererRssMb(),
    };
  }
  // A jump to another part of the sheet at 400 %: time until every window is sharp again.
  // Three windows share the one Render worker queue.
  const fill: Record<string, number[]> = { leaderOnly: [], linkedThree: [] };
  // Fresh spots for each run (nothing cached), the leader alone first.
  const spots = {
    leaderOnly: [
      { x: 500, y: 450 },
      { x: 2900, y: 1900 },
      { x: 1500, y: 1400 },
      { x: 3100, y: 500 },
    ],
    linkedThree: [
      { x: 900, y: 1900 },
      { x: 2300, y: 700 },
      { x: 400, y: 1200 },
      { x: 2600, y: 1300 },
    ],
  };
  for (const linked of [false, true]) {
    await call(page, 'setLinked', linked);
    const key = linked ? 'linkedThree' : 'leaderOnly';
    for (const p of spots[key])
      fill[key]?.push(await call<number>(page, 'jumpAndFill', a, p, linked ? [c, a, b] : [a]));
  }
  await call(page, 'setLinked', true);
  note('jumpFillMsAt400', fill);

  // The same linked pan on a CPU four times slower (a modest laptop on battery).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await call(page, 'zoom', a, 2);
  await page.waitForTimeout(2000);
  await settle(page, [c, a, b]);
  const slow = await call<Record<string, unknown>>(page, 'pan', a, 8, 5, 4000);
  await page.waitForTimeout(1500);
  frames.zoom200Cpu4x = {
    linkedThree: slow,
    coverageAfter: await Promise.all([c, a, b].map((id) => call<number>(page, 'coverage', id))),
  };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  note('memory', mem);
  note('frames', frames);
  note('linkStats', await call(page, 'linkStats'));
  const all = (await call<{ duration: number }[]>(page, 'longTasks')).filter(
    (t) => t.duration > 100,
  );
  note('longTasksOver100ms', all);
  for (const z of ['zoom100', 'zoom400', 'zoom200Cpu4x']) {
    const f = frames[z] as { linkedThree: { maxLinkErrorPx: number; longTasks: unknown[] } };
    expect(f.linkedThree.maxLinkErrorPx).toBeLessThan(1);
  }
});
