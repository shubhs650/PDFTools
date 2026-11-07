// Help's screenshots (M9, ADR-026 D-46): `npm run help:screenshots` walks the
// real app (the e2e build, light theme, English, 1366 × 800 at 2×) through
// each state Help shows, on self-made sample documents (rule 13), and writes
// public/help-img/<id>.webp and src/help/shots.json. Not part of CI: re-run it
// after a visible UI change. One test per screenshot, so one can be re-made
// alone with --grep.
import type { Locator, Page } from '@playwright/test';
import { attachmentsPdf, fullFormPdf } from '../fixtures/generate.ts';
import { helpDrawingPdf, helpReportPdf } from '../fixtures/help-samples.ts';
import { cap, darkTheme, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { shoot, type Box } from './shoot.ts';

const DRAWING = { name: 'TP-101 Pump station.pdf', bytes: helpDrawingPdf(), width: 1191 };
const REPORT = { name: 'Design report.pdf', bytes: helpReportPdf(), width: 595 };
type Doc = typeof DRAWING;

test.describe.configure({ timeout: 120_000 });

async function start(page: Page): Promise<void> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Alex Morgan');
}

async function open(page: Page, doc: Doc = DRAWING): Promise<string> {
  await drop(page, [{ name: doc.name, b64: Buffer.from(doc.bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').last()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** Waits until every thumbnail has its picture. */
async function thumbnailsDrawn(page: Page): Promise<void> {
  const list = page.getByRole('listbox', { name: 'Page thumbnails' });
  await expect(list).toBeVisible();
  await expect
    .poll(() =>
      list.locator('img').evaluateAll((imgs) =>
        imgs.length > 0 && imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
}

async function fitPage(page: Page): Promise<void> {
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
}

const ribbonTab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab', { name, exact: true });
const toolbar = (page: Page, tab: string) => page.getByRole('toolbar', { name: `${tab} commands` });
const group = (page: Page, tab: string, name: string) =>
  toolbar(page, tab).getByRole('group', { name, exact: true });
const ribbon = (page: Page) => page.getByRole('region', { name: 'Ribbon' });
const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const panes = (page: Page) => page.getByRole('complementary', { name: 'Navigation panes' });
const dialog = (page: Page, name?: string | RegExp) =>
  name ? page.getByRole('dialog', { name }) : page.getByRole('dialog');

/** The ribbon's tabs and the active tab's commands, without the empty space on its right. */
async function ribbonClip(page: Page, tab: string): Promise<Locator[]> {
  await ribbonTab(page, tab).click();
  return [page.getByRole('tablist', { name: 'Ribbon tabs' }), toolbar(page, tab)];
}

/** Screen point of a point on a page, in PDF points from the page's top-left. */
async function at(page: Page, doc: Doc, x: number, y: number, pageIndex = 0) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / doc.width;
  return { x: box.x + x * s, y: box.y + y * s };
}

/** A rectangle on a page, in PDF points from the page's top-left, as a screen box. */
async function pageBox(page: Page, doc: Doc, x: number, y: number, w: number, h: number): Promise<Box> {
  const a = await at(page, doc, x, y);
  const b = await at(page, doc, x + w, y + h);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

async function drag(page: Page, doc: Doc, from: [number, number], to: [number, number]) {
  const a = await at(page, doc, ...from);
  const b = await at(page, doc, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

async function commentTool(page: Page, name: string) {
  await ribbonTab(page, 'Comment').click();
  const b = toolbar(page, 'Comment').getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function deselect(page: Page) {
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await cap(page, 'annotate', 'selectMany', id, []);
  await page.waitForTimeout(150);
}

async function escapeTool(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

/** A rectangle, a cloud and an arrow on the drawing's plan. */
async function markUpDrawing(page: Page) {
  await commentTool(page, 'Rectangle');
  await drag(page, DRAWING, [290, 280], [370, 360]);
  await escapeTool(page);
  await commentTool(page, 'Arrow');
  await drag(page, DRAWING, [470, 230], [395, 290]);
  await escapeTool(page);
}

// --- Getting started ---------------------------------------------------------

test('welcome-1: the window at a glance', async ({ page }) => {
  await start(page);
  await open(page);
  await fitPage(page);
  await markUpDrawing(page);
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  // Select the rectangle so the Properties pane has something to show.
  const p = await at(page, DRAWING, 290, 320);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('properties-pane')).toBeVisible();
  await shoot(page, 'welcome-1', {
    callouts: [
      { n: 1, target: page.getByRole('toolbar', { name: 'Quick access toolbar' }), at: 'r' },
      { n: 2, target: group(page, 'Home', 'Protect'), at: 'r', dx: 16 },
      { n: 3, target: panes(page), at: 'c' },
      { n: 4, target: page.getByRole('main', { name: 'Document area' }), at: 'c' },
      { n: 5, target: page.getByTestId('properties-pane'), at: 'tl' },
      { n: 6, target: statusBar(page), at: 'l' },
    ],
  });
});

test('opening-files-1: the start screen', async ({ page }) => {
  await start(page);
  const screen = page.getByTestId('start-screen');
  await expect(screen).toBeVisible();
  await shoot(page, 'opening-files-1', {
    clip: [
      screen.getByRole('heading', { name: 'No document open' }),
      screen.getByRole('heading', { name: 'Recent files' }),
    ],
    pad: 60,
    callouts: [{ n: 1, target: screen.getByRole('button', { name: 'Open' }).first(), at: 'l' }],
  });
});

test('opening-files-2: two documents as tabs', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await open(page, DRAWING);
  const tabs = page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  const second = (await tabs.nth(1).boundingBox()) as Box;
  await shoot(page, 'opening-files-2', {
    clip: { x: 0, y: 0, width: 900, height: second.y + second.height + 160 },
    pad: 0,
    outline: [tabs.nth(0), tabs.nth(1)],
  });
});

// --- Viewing ----------------------------------------------------------------

test('home-tab-1: the Home tab', async ({ page }) => {
  await start(page);
  await open(page);
  await shoot(page, 'home-tab-1', {
    clip: await ribbonClip(page, 'Home'),
    pad: 30,
    callouts: ['Tools', 'Zoom', 'View', 'Comment', 'Measure', 'Protect'].map((g, i) => ({
      n: i + 1,
      target: group(page, 'Home', g),
      at: 'b' as const,
      dy: 18,
    })),
  });
});

test('zoom-and-pages-1: the View tab', async ({ page }) => {
  await start(page);
  await open(page);
  await shoot(page, 'zoom-and-pages-1', { clip: await ribbonClip(page, 'View') });
});

test('zoom-and-pages-2: the status bar', async ({ page }) => {
  await start(page);
  await open(page);
  const bar = statusBar(page);
  await shoot(page, 'zoom-and-pages-2', {
    clip: { ...((await bar.boundingBox()) as Box), x: 560, width: 806 },
    pad: 0,
    callouts: [
      { n: 1, target: bar.getByRole('group', { name: 'Page navigation' }), at: 't' },
      { n: 2, target: bar.getByRole('group', { name: 'Zoom' }), at: 't' },
      { n: 3, target: bar.getByRole('group', { name: 'View mode' }), at: 't' },
    ],
  });
});

test('themes-1: the dark theme', async ({ page }) => {
  await darkTheme(page);
  await start(page);
  await open(page);
  await fitPage(page);
  await shoot(page, 'themes-1');
});

test('side-panes-1: the Thumbnails pane', async ({ page }) => {
  await start(page);
  await open(page);
  const pane = panes(page);
  await thumbnailsDrawn(page);
  const box = (await pane.boundingBox()) as Box;
  await shoot(page, 'side-panes-1', {
    clip: { ...box, width: box.width + 160, height: 460 },
    pad: 0,
    callouts: [
      { n: 1, target: pane.getByRole('button', { name: 'Thumbnails' }), at: 'r' },
      { n: 2, target: pane.getByRole('region', { name: 'Thumbnails' }), at: 't' },
    ],
  });
});

test('finding-text-1: Quick Find', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+2');
  await page.keyboard.press('Control+F');
  const bar = page.locator('.find-bar');
  await expect(bar).toBeVisible();
  await page.keyboard.type('pump');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const main = (await page.getByRole('main', { name: 'Document area' }).boundingBox()) as Box;
  await shoot(page, 'finding-text-1', {
    clip: { ...main, height: 420 },
    pad: 0,
    outline: [bar.locator('input').first()],
  });
});

test('finding-text-2: Advanced Search', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+Shift+F');
  const pane = page.getByRole('region', { name: 'Search Results' });
  await pane.getByRole('searchbox', { name: 'Search for' }).fill('DN150');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('search-results')).toContainText(/DN150/);
  await page.waitForTimeout(300);
  const box = (await pane.boundingBox()) as Box;
  await shoot(page, 'finding-text-2', { clip: { ...box, height: Math.min(box.height, 520) }, pad: 0 });
});

// --- Bookmarks -----------------------------------------------------------------

test('bookmarks-1: the Bookmarks pane', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await panes(page).getByRole('button', { name: 'Bookmarks' }).click();
  const pane = panes(page).getByRole('region', { name: 'Bookmarks' });
  await expect(pane.getByRole('treeitem').first()).toBeVisible();
  await pane.getByRole('treeitem', { name: /Equipment schedule/ }).click();
  const box = (await pane.boundingBox()) as Box;
  await shoot(page, 'bookmarks-1', {
    clip: { ...box, height: 300 },
    pad: 0,
    callouts: [
      { n: 1, target: pane.getByRole('toolbar').first(), at: 'r' },
      { n: 2, target: pane.getByRole('treeitem', { name: /Equipment schedule/ }), at: 'r', dx: -24 },
    ],
  });
});

test('bookmarks-2: the bookmark menu', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await panes(page).getByRole('button', { name: 'Bookmarks' }).click();
  const pane = panes(page).getByRole('region', { name: 'Bookmarks' });
  const item = pane.getByRole('treeitem', { name: /Equipment schedule/ });
  const itemBox = (await item.boundingBox()) as Box;
  await item.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Bookmark menu' });
  await expect(menu).toBeVisible();
  await shoot(page, 'bookmarks-2', { clip: [menu, itemBox], pad: 10 });
});

// --- Comments --------------------------------------------------------------------

test('comment-tab-1: the Comment tab', async ({ page }) => {
  await start(page);
  await open(page);
  const clip = await ribbonClip(page, 'Comment');
  await shoot(page, 'comment-tab-1', {
    clip,
    pad: 30,
    callouts: [
      'Tools',
      'Text',
      'Note',
      'Text Markup',
      'Drawing',
      'Stamp',
      'Measure',
      'Manage Comments',
    ].map((g, i) => ({
      n: i + 1,
      target: group(page, 'Comment', g),
      at: 'b' as const,
      dy: 18,
    })),
  });
});

test('text-markup-1: highlight, underline and strikeout', async ({ page }) => {
  await start(page);
  await open(page, REPORT);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(400);
  // Lines of section 1 (page 1, from the top: 842 - baseline).
  const lineY = (baseline: number) => 842 - baseline - 4;
  await commentTool(page, 'Highlight');
  await drag(page, REPORT, [72, lineY(612)], [400, lineY(612)]);
  await escapeTool(page);
  await commentTool(page, 'Underline');
  await drag(page, REPORT, [72, lineY(596)], [300, lineY(596)]);
  await escapeTool(page);
  await commentTool(page, 'Strikeout');
  await drag(page, REPORT, [250, lineY(580)], [440, lineY(580)]);
  await escapeTool(page);
  await deselect(page);
  await shoot(page, 'text-markup-1', { clip: await pageBox(page, REPORT, 60, 190, 470, 80), pad: 0 });
});

const textEditor = (page: Page) => page.locator('[data-text-comment] [contenteditable="true"]');

test('text-comments-1: a callout', async ({ page }) => {
  await start(page);
  await open(page);
  await fitPage(page);
  await commentTool(page, 'Callout');
  await drag(page, DRAWING, [238, 268], [330, 160]);
  await expect(textEditor(page)).toBeFocused();
  await page.keyboard.type('Check the pump rating');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await escapeTool(page);
  await shoot(page, 'text-comments-1', {
    clip: await pageBox(page, DRAWING, 150, 110, 400, 220),
    pad: 0,
    callouts: [
      { n: 1, target: await pageBox(page, DRAWING, 238, 268, 1, 1), at: 'c', dx: -22, dy: 14 },
      { n: 2, target: page.locator('[data-text-comment]').first(), at: 'tr', dx: 6, dy: -6 },
    ],
  });
});

test('text-comments-2: the text menu', async ({ page }) => {
  await start(page);
  await open(page);
  await fitPage(page);
  await commentTool(page, 'Text Box');
  await drag(page, DRAWING, [860, 560], [1080, 600]);
  await expect(textEditor(page)).toBeFocused();
  await page.keyboard.type('Confirm the valve sizes');
  const box = (await textEditor(page).boundingBox()) as Box;
  await page.mouse.click(box.x + 30, box.y + box.height / 2, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.getByRole('menuitem', { name: 'Text Style' }).hover();
  await expect(page.getByRole('menu', { name: 'Text Style' })).toBeVisible();
  await shoot(page, 'text-comments-2', {
    clip: [textEditor(page), menu.first(), page.getByRole('menu', { name: 'Text Style' })],
    pad: 12,
  });
});

test('sticky-notes-1: a sticky note window', async ({ page }) => {
  await start(page);
  await open(page);
  await commentTool(page, 'Sticky Note');
  const p = await at(page, DRAWING, 330, 225);
  await page.mouse.click(p.x, p.y);
  const win = page.locator('[data-note-popup]');
  await expect(win).toBeVisible();
  await win.getByRole('textbox', { name: 'Note text' }).fill(
    'Is there room to lift the valve out?\nPlease check the hatch size.',
  );
  await shoot(page, 'sticky-notes-1', {
    clip: [win, await pageBox(page, DRAWING, 200, 200, 160, 120)],
    pad: 16,
    callouts: [
      { n: 1, target: win.getByRole('button', { name: 'Options' }), at: 'b', dy: 14 },
      { n: 2, target: win.getByRole('button', { name: 'Lock' }), at: 'b', dy: 14 },
      { n: 3, target: win.getByRole('button', { name: 'Reply' }), at: 'b', dy: 14 },
    ],
  });
});

test('shapes-1: shapes on a drawing', async ({ page }) => {
  await start(page);
  await open(page);
  await fitPage(page);
  await commentTool(page, 'Rectangle');
  await drag(page, DRAWING, [482, 230], [572, 292]);
  await escapeTool(page);
  await commentTool(page, 'Cloud');
  for (const [x, y] of [
    [130, 330],
    [410, 330],
    [410, 570],
  ] as const) {
    const s = await at(page, DRAWING, x, y);
    await page.mouse.click(s.x, s.y);
  }
  const last = await at(page, DRAWING, 130, 570);
  await page.mouse.dblclick(last.x, last.y);
  await escapeTool(page);
  await commentTool(page, 'Arrow');
  await drag(page, DRAWING, [640, 200], [565, 255]);
  await escapeTool(page);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');
  await shoot(page, 'shapes-1', { clip: await pageBox(page, DRAWING, 100, 150, 700, 450), pad: 0 });
});

test('stamps-1: the Stamp dialog', async ({ page }) => {
  await start(page);
  await open(page);
  await ribbonTab(page, 'Comment').click();
  await toolbar(page, 'Comment').getByRole('button', { name: 'Stamp', exact: true }).click();
  const d = dialog(page, 'Stamp');
  await expect(d).toBeVisible();
  await d.getByRole('textbox', { name: 'Document number' }).fill('TP-101');
  await d.getByRole('textbox', { name: 'Revision' }).fill('B');
  await shoot(page, 'stamps-1', { clip: d, pad: 8 });
});

interface Listed {
  id: string;
  page: number;
  type: number;
}

const docId = async (page: Page) => (await cap(page, 'view', 'activeDocId')) as string;
const listed = async (page: Page) =>
  ((await cap(page, 'annotate', 'list', await docId(page))) as Listed[] | null) ?? [];

/** The drawing with a rectangle, a cloud and an arrow, each with its comment text. */
async function reviewedDrawing(page: Page) {
  await start(page);
  await open(page);
  await fitPage(page);
  await commentTool(page, 'Rectangle');
  await drag(page, DRAWING, [482, 230], [572, 292]);
  await escapeTool(page);
  await commentTool(page, 'Oval');
  await drag(page, DRAWING, [180, 225], [375, 300]);
  await escapeTool(page);
  await commentTool(page, 'Arrow');
  await drag(page, DRAWING, [680, 470], [610, 485]);
  await escapeTool(page);
  const id = await docId(page);
  const texts = [
    'Check access to valve V-11 for maintenance.',
    'Confirm the pump duty point with the supplier.',
    'Add the drain valve here.',
  ];
  const all = await listed(page);
  for (const [i, a] of all.entries()) {
    await cap(page, 'annotate', 'update', id, a.page, a.id, { contents: texts[i] ?? '' });
  }
  await deselect(page);
  return { id, all };
}

const commentsPane = (page: Page) => page.getByTestId('comments-pane');

async function openCommentsPane(page: Page) {
  await panes(page).getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(commentsPane(page)).toBeVisible();
}

test('selecting-comments-1: a marquee selection', async ({ page }) => {
  await reviewedDrawing(page);
  await ribbonTab(page, 'Comment').click();
  await toolbar(page, 'Comment').getByRole('button', { name: 'Select Comments' }).click();
  await drag(page, DRAWING, [150, 200], [700, 500]);
  await expect.poll(async () => ((await cap(page, 'annotate', 'selected', await docId(page))) as string[]).length).toBe(3);
  await shoot(page, 'selecting-comments-1', {
    clip: await pageBox(page, DRAWING, 140, 190, 600, 330),
    pad: 0,
  });
});

test('comment-properties-1: the Properties pane', async ({ page }) => {
  const { id, all } = await reviewedDrawing(page);
  const rect = all[0];
  if (!rect) throw new Error('no comment');
  await cap(page, 'annotate', 'select', id, 0, rect.id);
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  const pane = page.getByTestId('properties-pane');
  await expect(pane).toBeVisible();
  const box = (await pane.boundingBox()) as Box;
  await shoot(page, 'comment-properties-1', {
    clip: { x: box.x - 220, y: box.y, width: box.width + 220, height: box.height },
    pad: 0,
    callouts: [
      { n: 1, target: pane.getByRole('button', { name: 'General' }), at: 'r', dx: -16 },
      { n: 2, target: pane.getByRole('button', { name: 'Style' }), at: 'r', dx: -16 },
    ],
  });
});

test('comment-properties-2: Standard colors', async ({ page }) => {
  const { id, all } = await reviewedDrawing(page);
  const rect = all[0];
  if (!rect) throw new Error('no comment');
  await cap(page, 'annotate', 'select', id, 0, rect.id);
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  const pane = page.getByTestId('properties-pane');
  const button = pane.getByRole('button', { name: 'Stroke color', exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const popup = page.getByRole('dialog', { name: 'Stroke color' });
  await expect(popup).toBeVisible();
  await shoot(page, 'comment-properties-2', { clip: [popup, button], pad: 10 });
});

test('comment-styles-1: the Comment Styles Palette', async ({ page }) => {
  await start(page);
  await open(page);
  await ribbonTab(page, 'Comment').click();
  await toolbar(page, 'Comment').getByRole('button', { name: 'Comment Styles' }).click();
  const d = page.getByTestId('comment-styles-dialog');
  await expect(d).toBeVisible();
  await page.waitForTimeout(300);
  await shoot(page, 'comment-styles-1', {
    clip: d,
    pad: 8,
    callouts: [
      { n: 1, target: d.getByRole('listbox').first(), at: 'tr', dx: -16, dy: 16 },
      { n: 2, target: d.getByText('Custom Styles').first(), at: 'r', dx: 18 },
      { n: 3, target: page.getByTestId('style-properties'), at: 'tr', dx: -16, dy: 16 },
    ],
  });
});

test('reviewing-comments-1: the Comments pane', async ({ page }) => {
  await reviewedDrawing(page);
  await openCommentsPane(page);
  const cards = page.getByTestId('comments-list').getByRole('option');
  await expect(cards.first()).toBeVisible();
  const card = cards.filter({ hasText: 'duty point' }).first();
  await card.click();
  const pane = commentsPane(page);
  await pane.getByRole('button', { name: 'Reply', exact: true }).click();
  const reply = pane.getByTestId('comment-editor').getByRole('textbox', { name: 'Reply' });
  await reply.fill('Duty point confirmed: 120 l/s at 32 m.');
  await reply.press('Enter');
  await pane.getByRole('button', { name: 'Set Status' }).click();
  await page.getByRole('menuitem', { name: 'Accepted' }).click();
  await page.waitForTimeout(300);
  const box = (await pane.boundingBox()) as Box;
  await shoot(page, 'reviewing-comments-1', {
    clip: { ...box, height: Math.min(box.height, 560) },
    pad: 0,
    callouts: [
      { n: 1, target: pane.getByRole('button', { name: 'Options' }), at: 'b', dy: 12 },
      { n: 2, target: pane.getByRole('searchbox').first(), at: 'r', dx: -14 },
      { n: 3, target: card, at: 'tr', dx: -16, dy: 14 },
    ],
  });
});

test('flatten-snapshot-1: the Flatten Comments dialog', async ({ page }) => {
  await reviewedDrawing(page);
  await ribbonTab(page, 'Comment').click();
  await toolbar(page, 'Comment').getByRole('button', { name: 'Flatten Comments' }).click();
  const d = dialog(page, 'Flatten Comments');
  await expect(d).toBeVisible();
  await shoot(page, 'flatten-snapshot-1', { clip: d, pad: 8 });
});

test('comment-transfer-1: the Export Comments dialog', async ({ page }) => {
  await reviewedDrawing(page);
  await ribbonTab(page, 'Comment').click();
  await toolbar(page, 'Comment')
    .getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' })
    .click();
  const d = dialog(page, 'Export Annotations');
  await expect(d).toBeVisible();
  await shoot(page, 'comment-transfer-1', { clip: d, pad: 8 });
});

test('pasting-pictures-1: a pasted picture', async ({ page, context }) => {
  await start(page);
  await open(page);
  await fitPage(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // A "site photo": a simple picture drawn here, copied as PNG.
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(480, 320);
    const g = c.getContext('2d');
    if (!g) throw new Error('no 2d');
    const sky = g.createLinearGradient(0, 0, 0, 320);
    sky.addColorStop(0, '#9cc9f0');
    sky.addColorStop(1, '#e8f2fb');
    g.fillStyle = sky;
    g.fillRect(0, 0, 480, 320);
    g.fillStyle = '#7a8b6b';
    g.fillRect(0, 230, 480, 90);
    g.fillStyle = '#c9c2b4';
    g.fillRect(90, 120, 300, 130);
    g.fillStyle = '#8a4b3b';
    g.beginPath();
    g.moveTo(70, 125);
    g.lineTo(240, 50);
    g.lineTo(410, 125);
    g.fill();
    g.fillStyle = '#4a5560';
    g.fillRect(210, 170, 60, 80);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  const p = await at(page, DRAWING, 950, 520);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Control+V');
  await expect(page.getByRole('status').filter({ hasText: 'Image pasted.' })).toBeVisible();
  await page.waitForTimeout(500);
  const main = (await page.getByRole('main', { name: 'Document area' }).boundingBox()) as Box;
  await shoot(page, 'pasting-pictures-1', { clip: main, pad: 0 });
});

test('attaching-files-1: the Attachments pane', async ({ page }) => {
  await start(page);
  await drop(page, [
    { name: 'Handover pack.pdf', b64: Buffer.from(attachmentsPdf(40_000)).toString('base64') },
  ]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await panes(page).getByRole('button', { name: 'Attachments' }).click();
  const pane = page.getByRole('region', { name: 'Attachments' });
  await expect(pane.getByRole('list', { name: 'Embedded files' })).toBeVisible();
  const box = (await pane.boundingBox()) as Box;
  await shoot(page, 'attaching-files-1', { clip: { ...box, height: Math.min(box.height, 420) }, pad: 0 });
});

// --- Measuring -------------------------------------------------------------------

async function setScale100(page: Page) {
  await ribbonTab(page, 'Measure').click();
  await toolbar(page, 'Measure').getByRole('button', { name: 'Set Scale' }).click();
  const d = dialog(page, 'Set scale');
  await d.getByLabel('Real').fill('100');
  await d.getByLabel('Units').selectOption({ label: 'Millimetres' });
  await d.getByLabel('All pages').check();
  return d;
}

test('measure-scale-1: the Set scale dialog', async ({ page }) => {
  await start(page);
  await open(page);
  const d = await setScale100(page);
  await expect(d.getByRole('status')).toHaveText('Scale 1 : 100');
  await shoot(page, 'measure-scale-1', { clip: d, pad: 8 });
});

test('measure-tools-1: the Measure tab', async ({ page }) => {
  await start(page);
  await open(page);
  await shoot(page, 'measure-tools-1', {
    clip: await ribbonClip(page, 'Measure'),
    pad: 30,
    callouts: ['Measure', 'Scale', 'Snap'].map((g, i) => ({
      n: i + 1,
      target: group(page, 'Measure', g),
      at: 'b' as const,
      dy: 18,
    })),
  });
});

test('measure-tools-2: a distance and an area', async ({ page }) => {
  await start(page);
  await open(page);
  await fitPage(page);
  const d = await setScale100(page);
  await d.getByRole('button', { name: 'Apply' }).click();
  // Plan corners (page points from the top-left): the building is 120..743.6 × 157..582.2.
  const left = 120;
  const right = 120 + 22000 * (72 / 25.4 / 100);
  const top = 842 - (260 + 15000 * (72 / 25.4 / 100));
  const bottom = 842 - 260;
  const wall = 842 - (260 + 6000 * (72 / 25.4 / 100));
  await toolbar(page, 'Measure').getByRole('button', { name: 'Distance', exact: true }).click();
  await drag(page, DRAWING, [left, bottom + 40], [right, bottom + 40]);
  await escapeTool(page);
  await ribbonTab(page, 'Measure').click();
  await toolbar(page, 'Measure').getByRole('button', { name: 'Area', exact: true }).click();
  const xWall = 120 + 10000 * (72 / 25.4 / 100);
  const pts: [number, number][] = [
    [left, wall],
    [xWall, wall],
    [xWall, bottom],
    [left, bottom],
  ];
  for (const [i, [x, y]] of pts.entries()) {
    const s = await at(page, DRAWING, x, y);
    await page.mouse.move(s.x, s.y, { steps: 4 });
    if (i === pts.length - 1) await page.mouse.dblclick(s.x, s.y);
    else await page.mouse.click(s.x, s.y);
  }
  await escapeTool(page);
  await deselect(page);
  await shoot(page, 'measure-tools-2', {
    clip: await pageBox(page, DRAWING, 80, top - 20, 720, bottom - top + 90),
    pad: 0,
  });
});

test('snapping-1: the Snap options', async ({ page }) => {
  await start(page);
  await open(page);
  await ribbonTab(page, 'Measure').click();
  await shoot(page, 'snapping-1', {
    clip: [group(page, 'Measure', 'Snap'), group(page, 'Measure', 'Settings')],
    pad: 10,
  });
});
