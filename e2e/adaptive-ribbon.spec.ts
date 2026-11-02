import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-08 (ADR-021 D-36; beta review A2b–A2d, B7a, B7b): the ribbon adapts to
// the window: each group steps down from large buttons to small labelled ones,
// to icons only, to one button that opens the group as a menu, the lowest
// priority first. Every tab fits 1280 … 1920 px without clipping; every
// command keeps its accessible name and its keyboard path. The Comment tab
// follows the review's layout (Tools … Manage Comments) with the Typewriter
// and Highlight Area tools; Home rotates the view both ways.

const TABS = ['Home', 'View', 'Comment', 'Measure', 'Organize', 'Convert', 'Protect', 'Help'];
const WIDTHS = [1280, 1366, 1600, 1920];

const toolbar = (page: Page, tab: string) => page.getByRole('toolbar', { name: `${tab} commands` });

/** How the panel's groups sit: clipped ones, and each group's step. */
interface Fit {
  overflow: number;
  clipped: (string | undefined)[];
  steps: Record<string, number>;
  measuring: number;
}

async function fit(page: Page): Promise<Fit> {
  return page.evaluate((): Fit => {
    const panel = document.querySelector<HTMLElement>('.ribbon-panel');
    if (!panel) throw new Error('no ribbon panel');
    const edge = panel.getBoundingClientRect().right;
    const groups = [...panel.querySelectorAll<HTMLElement>('.ribbon-toolbar > .ribbon-group')];
    return {
      overflow: panel.scrollWidth - panel.clientWidth,
      clipped: groups
        .filter((g) => g.getBoundingClientRect().right > edge + 0.5)
        .map((g) => g.dataset.group),
      steps: Object.fromEntries(groups.map((g) => [g.dataset.group ?? '', Number(g.dataset.step)])),
      measuring: document.querySelectorAll('.ribbon-measure').length,
    };
  });
}

for (const width of WIDTHS) {
  test(`every tab fits ${String(width)} px: no group clipped, nothing scrolls sideways @smoke`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    for (const tab of TABS) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(toolbar(page, tab)).toBeVisible();
      const f = await fit(page);
      expect(f.clipped, `${tab} at ${String(width)} px`).toEqual([]);
      expect(f.overflow, `${tab} at ${String(width)} px`).toBeLessThanOrEqual(0);
      // The measuring copy is gone once the widths are known.
      expect(f.measuring).toBe(0);
    }
    const doc = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(doc).toBe(0);
  });
}

test('Comment: labels from 1600 px; at 1280 px every tool is a button with its name', async ({
  page,
}) => {
  const comment = async (width: number) => {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('tab', { name: 'Comment', exact: true }).click();
    await expect(toolbar(page, 'Comment')).toBeVisible();
    await expect.poll(async () => (await fit(page)).clipped).toEqual([]);
    return (await fit(page)).steps;
  };
  await page.goto('/');
  const at = {} as Record<number, Record<string, number>>;
  for (const w of [1920, 1600, 1366, 1280]) at[w] = await comment(w);
  for (const w of [1600, 1920]) {
    // The tools the review asked to see labelled (B7a) keep their labels.
    for (const g of ['comment.tools', 'comment.text', 'comment.textMarkup'])
      expect(at[w]?.[g], `${g} at ${String(w)} px`).toBeLessThan(2);
  }
  await comment(1600);
  const markup = page.locator('[data-group="comment.textMarkup"]');
  await expect(markup.locator('.ribbon-label')).toHaveText([
    'Highlight',
    'Underline',
    'Strikeout',
    'Squiggly',
    'Insert Text',
    'Replace Text',
    'Highlight Area',
    'Free Highlight',
  ]);
  await comment(1280);
  const bar = toolbar(page, 'Comment');
  for (const name of [
    'Hand',
    'Select Text',
    'Select Comments',
    'Typewriter',
    'Text Box',
    'Callout',
    'Sticky Note',
    'Highlight',
    'Highlight Area',
    'Free Highlight',
    'Rectangle',
    'Stamp',
    'Distance',
    'Area',
  ])
    await expect(bar.getByRole('button', { name, exact: true }), name).toBeVisible();
  await page.screenshot({ path: 'test-results/m6-08/comment-1280.png' });
  await comment(1600);
  await page.screenshot({ path: 'test-results/m6-08/comment-1600.png' });
  await comment(1920);
  await page.screenshot({ path: 'test-results/m6-08/comment-1920.png' });
});

test('a narrow ribbon folds groups into menus: keyboard, names, the command runs, axe @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  // The app is never narrower than 1280 px (§8); longer translations or larger
  // text are what fold groups. Here the panel is made narrow instead.
  await page.addStyleTag({ content: '.ribbon-panel { max-width: 520px; }' });
  const bar = toolbar(page, 'Comment');
  // Manage Comments has the lowest priority: it folds first.
  const manage = bar.getByRole('button', { name: 'Manage Comments' });
  await expect(manage).toBeVisible();
  await expect(manage).toHaveAttribute('aria-haspopup', 'menu');
  expect((await fit(page)).clipped).toEqual([]);
  await page.screenshot({ path: 'test-results/m6-08/comment-folded.png' });

  // One stop in the toolbar's roving focus: reached with the arrow keys.
  await bar.getByRole('button', { name: 'Hand' }).focus();
  await page.keyboard.press('End');
  await expect(manage).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Manage Comments' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Comments Pane',
    'Import Comments',
    'Export Comments (CSV / XLSX / JSON)',
    'Export CRS (Excel)',
    'Comment Styles',
    'Filter Comments',
    'Status Schemes',
    'Reviewer Profile',
  ]);
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Show Numbers on Page' })).toBeVisible();
  // Without a document: still focusable, with the reason (rule 12).
  await expect(menu.getByRole('menuitem', { name: 'Import Comments' })).toHaveAccessibleDescription(
    /Open a document/,
  );
  await page.screenshot({ path: 'test-results/m6-08/group-menu.png' });
  const r = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  // Esc closes back to the group button; the arrows in the menu stay in it.
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Import Comments' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(manage).toBeFocused();
  // Enter on an item runs the command.
  await page.keyboard.press('Enter');
  await menu.getByRole('menuitem', { name: 'Comment Styles' }).click();
  await expect(page.getByRole('dialog', { name: /Comment Styles/ })).toBeVisible();
});

async function openDoc(page: Page): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'ribbon.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** Screen point of a page point (top-left origin) on page 1. */
async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + y * s };
}

interface Obj {
  type: number;
  intent?: string;
  color?: string;
  blendMode?: number;
  strokeWidth?: number;
}

test('Typewriter and Highlight Area: their own buttons make their comments; the Typewriter has a palette @smoke', async ({
  page,
}) => {
  const id = await openDoc(page);
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  const bar = toolbar(page, 'Comment');
  await expect(bar.getByRole('button', { name: 'Typewriter styles' })).toBeVisible();

  const typewriter = bar.getByRole('button', { name: 'Typewriter', exact: true });
  await typewriter.click();
  await expect(typewriter).toHaveAttribute('aria-pressed', 'true');
  const tw = await at(page, 60, 120);
  await page.mouse.click(tw.x, tw.y);
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null)?.length ?? 0)
    .toBe(1);
  await page.keyboard.press('Escape');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');

  const area = bar.getByRole('button', { name: 'Highlight Area', exact: true });
  await area.click();
  await expect(area).toHaveAttribute('aria-pressed', 'true');
  const a = await at(page, 100, 200);
  const b = await at(page, 300, 260);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null)?.length ?? 0)
    .toBe(2);
  const all = ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
  expect(all.find((o) => o.intent === 'FreeTextTypeWriter')).toBeTruthy();
  const square = all.find((o) => o.type === 5); // Square
  expect(square).toMatchObject({ blendMode: 1, strokeWidth: 0 }); // Multiply
  expect(square?.color?.toUpperCase()).toBe('#FFE14D');

  // The saved appearance blends with Multiply (a standard /BM, no private keys).
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { tail: string };
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/Subtype\s*\/Square/);
  expect(tail).toMatch(/\/BM\s*\/Multiply/);
});

test('Home: comment tools, Rotate View both ways (the pages stay), Properties Pane', async ({
  page,
}) => {
  await openDoc(page);
  const home = toolbar(page, 'Home');
  for (const name of ['Callout', 'Line', 'Arrow', 'Rectangle', 'Properties Pane'])
    await expect(home.getByRole('button', { name, exact: true }), name).toBeVisible();
  await expect(home.getByRole('button', { name: 'Rotate Clockwise', exact: true })).toHaveCount(0);
  const landscape = async () => {
    const r = await page.locator('[data-page="0"]').boundingBox();
    return r ? r.width > r.height : false;
  };
  await home.getByRole('button', { name: 'Rotate View Clockwise' }).click();
  await expect.poll(landscape).toBe(true);
  await home.getByRole('button', { name: 'Rotate View Counterclockwise' }).click();
  await expect.poll(landscape).toBe(false);
  // The view turned, not the pages: nothing to save.
  await expect(
    page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab'),
  ).not.toHaveAccessibleName(/unsaved/);
  const pane = home.getByRole('button', { name: 'Properties Pane' });
  const before = await pane.getAttribute('aria-pressed');
  await pane.click();
  await expect(pane).not.toHaveAttribute('aria-pressed', before ?? '');
  await page.screenshot({ path: 'test-results/m6-08/home-1280.png' });
});
