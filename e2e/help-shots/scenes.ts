// Scenes shared by Help's screenshots (shots.spec.ts) and the README's
// (readme.spec.ts): the self-made sample documents (rule 13) and the steps that
// open them, mark them up and frame parts of the window.
import type { Page } from '@playwright/test';
import { helpDrawingPdf, helpFormPdf, helpReportPdf } from '../fixtures/help-samples.ts';
import { cap, drop } from '../support/app.ts';
import { expect } from '../support/fixtures.ts';
import { shoot, type Box } from './shoot.ts';

export const DRAWING = { name: 'TP-101 Pump station.pdf', bytes: helpDrawingPdf(), width: 1191 };
export const REPORT = { name: 'Design report.pdf', bytes: helpReportPdf(), width: 595 };
export const FORM = { name: 'Inspection record IR-3.pdf', bytes: helpFormPdf(), width: 595 };
export type Doc = typeof DRAWING;

export async function start(page: Page): Promise<void> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Alex Morgan');
}

export async function open(page: Page, doc: Doc = DRAWING): Promise<string> {
  await drop(page, [{ name: doc.name, b64: Buffer.from(doc.bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').last()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** Waits until every thumbnail has its picture. */
export async function thumbnailsDrawn(page: Page): Promise<void> {
  const list = page.getByRole('listbox', { name: 'Page thumbnails' });
  await expect(list).toBeVisible();
  await expect
    .poll(() =>
      list
        .locator('img')
        .evaluateAll(
          (imgs) =>
            imgs.length > 0 &&
            imgs.every(
              (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
            ),
        ),
    )
    .toBe(true);
}

export async function fitPage(page: Page): Promise<void> {
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
}

export const ribbonTab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab', { name, exact: true });
export const toolbar = (page: Page, tab: string) =>
  page.getByRole('toolbar', { name: `${tab} commands` });
export const group = (page: Page, tab: string, name: string) =>
  toolbar(page, tab).getByRole('group', { name, exact: true });
export const statusBar = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
export const panes = (page: Page) => page.getByRole('complementary', { name: 'Navigation panes' });
export const dialog = (page: Page, name?: string | RegExp) =>
  name ? page.getByRole('dialog', { name }) : page.getByRole('dialog');

/**
 * The header row (mark and name, Quick Access, File, the tabs; M10-08·O3) and the active
 * tab's commands, without the empty space on its right.
 */
export async function ribbonClip(page: Page, tab: string): Promise<Box> {
  await ribbonTab(page, tab).click();
  const bar = (await toolbar(page, tab).boundingBox()) as Box;
  const file = (await page.getByTestId('file-tab').boundingBox()) as Box;
  const panel = (await page.locator('.ribbon-panel').boundingBox()) as Box;
  const lastTab = (await page
    .getByRole('tablist', { name: 'Ribbon tabs' })
    .getByRole('tab')
    .last()
    .boundingBox()) as Box;
  const groups = await toolbar(page, tab)
    .getByRole('group')
    .evaluateAll((gs) => gs.map((g) => g.getBoundingClientRect().right));
  const right = Math.max(lastTab.x + lastTab.width, ...groups) + 12;
  return {
    x: panel.x,
    y: file.y - 2,
    width: right - panel.x,
    height: bar.y + bar.height - file.y + 2,
  };
}

/** A ribbon tab with each named group numbered on a white strip below it. */
export async function ribbonShot(
  page: Page,
  id: string,
  tab: string,
  groups: string[],
): Promise<void> {
  const clip = await ribbonClip(page, tab);
  const band = { x: clip.x, y: clip.y + clip.height, width: clip.width, height: 34 };
  await shoot(page, id, {
    clip: { ...clip, height: clip.height + band.height },
    pad: 0,
    cover: [band],
    callouts: groups.map((g, i) => ({
      n: i + 1,
      target: group(page, tab, g),
      at: 'b' as const,
      dy: 17,
    })),
  });
}

/** Screen point of a point on a page, in PDF points from the page's top-left. */
export async function at(page: Page, doc: Doc, x: number, y: number, pageIndex = 0) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / doc.width;
  return { x: box.x + x * s, y: box.y + y * s };
}

/** A rectangle on a page, in PDF points from the page's top-left, as a screen box. */
export async function pageBox(
  page: Page,
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<Box> {
  const a = await at(page, doc, x, y);
  const b = await at(page, doc, x + w, y + h);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

export async function drag(page: Page, doc: Doc, from: [number, number], to: [number, number]) {
  const a = await at(page, doc, ...from);
  const b = await at(page, doc, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

export async function commentTool(page: Page, name: string) {
  await ribbonTab(page, 'Comment').click();
  const b = toolbar(page, 'Comment').getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

export async function deselect(page: Page) {
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await cap(page, 'annotate', 'selectMany', id, []);
  await page.waitForTimeout(150);
}

export async function escapeTool(page: Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

/** A rectangle, a cloud and an arrow on the drawing's plan. */
export async function markUpDrawing(page: Page) {
  await commentTool(page, 'Rectangle');
  await drag(page, DRAWING, [290, 280], [370, 360]);
  await escapeTool(page);
  await commentTool(page, 'Arrow');
  await drag(page, DRAWING, [470, 230], [395, 290]);
  await escapeTool(page);
}

export interface Listed {
  id: string;
  page: number;
  type: number;
}

export const docId = async (page: Page) => (await cap(page, 'view', 'activeDocId')) as string;
export const listed = async (page: Page) =>
  ((await cap(page, 'annotate', 'list', await docId(page))) as Listed[] | null) ?? [];

/** The drawing with a rectangle, a cloud and an arrow, each with its comment text. */
export async function reviewedDrawing(page: Page) {
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

export const commentsPane = (page: Page) => page.getByTestId('comments-pane');

export async function openCommentsPane(page: Page) {
  await panes(page).getByRole('button', { name: 'Comments', exact: true }).click();
  await expect(commentsPane(page)).toBeVisible();
}

export async function setScale100(page: Page, units = 'Millimetres') {
  await ribbonTab(page, 'Measure').click();
  await toolbar(page, 'Measure').getByRole('button', { name: 'Set Scale' }).click();
  const d = dialog(page, 'Set scale');
  await d.getByLabel('Real').fill('100');
  await d.getByLabel('Units').selectOption({ label: units });
  await d.getByLabel('All pages').check();
  return d;
}

/** The drawing at 1 : 100 in metres, with a snapped distance and area on the plan. */
export async function measuredDrawing(page: Page): Promise<{ top: number; bottom: number }> {
  await start(page);
  await open(page);
  await fitPage(page);
  const d = await setScale100(page, 'Metres');
  await d.getByRole('button', { name: 'Apply' }).click();
  // Snap to the building's corners, so the values are exact.
  const snap = toolbar(page, 'Measure').getByRole('button', { name: 'Enable Snapping' });
  if ((await snap.getAttribute('aria-pressed')) !== 'true') await snap.click();
  // Plan corners (page points from the top-left).
  const mm = 72 / 25.4 / 100;
  const left = 120;
  const right = 120 + 22000 * mm;
  const top = 842 - (260 + 15000 * mm);
  const bottom = 842 - 260;
  const wall = 842 - (260 + 6000 * mm);
  const xWall = 120 + 10000 * mm;
  async function clickAt(x: number, y: number, double = false) {
    const s = await at(page, DRAWING, x, y);
    await page.mouse.move(s.x, s.y, { steps: 4 });
    await page.waitForTimeout(120);
    if (double) await page.mouse.dblclick(s.x, s.y);
    else await page.mouse.click(s.x, s.y);
  }
  await toolbar(page, 'Measure').getByRole('button', { name: 'Distance', exact: true }).click();
  await drag(page, DRAWING, [left, top], [right, top]);
  await escapeTool(page);
  await ribbonTab(page, 'Measure').click();
  await toolbar(page, 'Measure').getByRole('button', { name: 'Area', exact: true }).click();
  const pts: [number, number][] = [
    [left, wall],
    [xWall, wall],
    [xWall, bottom],
    [left, bottom],
  ];
  for (const [i, [x, y]] of pts.entries()) await clickAt(x, y, i === pts.length - 1);
  await escapeTool(page);
  await deselect(page);
  // Snapping off again, so no snap marker is left on the picture.
  await ribbonTab(page, 'Measure').click();
  await snap.click();
  return { top, bottom };
}
