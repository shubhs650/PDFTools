import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/fixtures.ts';
import { cap } from './support/app.ts';

// M1-10: ribbon framework and File backstage (§8, D-01, D-29, rule 12).

test('the ribbon, its tabs and the backstage pass axe', async ({ page }) => {
  await page.goto('/');
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('tab', { name: 'View' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  await page.getByTestId('file-tab').click();
  await expect(page.getByTestId('backstage')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
});

test('shows File, Home, View, Comment (from M3-07), Measure (from M3-15), Organize (from M4-09), Convert (from M4-05), Protect (from M2-03) and Help only (M1-Q2)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: 'Ribbon tabs' }).getByRole('tab')).toHaveText([
    'Home',
    'View',
    'Comment',
    'Measure',
    'Organize',
    'Convert',
    'Protect',
    'Help',
  ]);
});

test('keyboard: arrows between tabs and controls, Tab into the toolbar, Esc to the document', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Home' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'View' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'View' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab'); // collapse button
  await page.keyboard.press('Tab'); // into the toolbar: one tab stop
  const toolbar = page.getByRole('toolbar', { name: 'View commands' });
  await expect(toolbar.getByRole('button', { name: 'First Page' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toolbar.getByRole('button', { name: 'Previous Page' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(toolbar.getByRole('button', { name: 'Collapse Ribbon' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('main', { name: 'Document area' })).toBeFocused();
});

test('toggles work from the keyboard and show their pressed state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'View' }).click();
  const panes = page
    .getByRole('toolbar', { name: 'View commands' })
    .getByRole('button', { name: 'Panes' });
  await expect(panes).toHaveAttribute('aria-pressed', 'true');
  await panes.focus();
  await page.keyboard.press('Enter');
  await expect(panes).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('left-pane')).toBeHidden();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('left-pane')).toBeVisible();
});

test('commands that need a document are disabled with an announced reason and do nothing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'View' }).click();
  const zoomIn = page
    .getByRole('toolbar', { name: 'View commands' })
    .getByRole('button', { name: 'Zoom In' });
  await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
  await expect(zoomIn).toHaveAccessibleDescription(/Open a document|Not available yet/);
  await zoomIn.focus();
  await expect(zoomIn).toBeFocused(); // still reachable by keyboard (rule 12)
});

test('Ctrl+F1 collapses and expands the ribbon', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await page.keyboard.press('Control+F1');
  await expect(page.getByRole('tabpanel')).toBeHidden();
  await page.keyboard.press('Control+F1');
  await expect(page.getByRole('tabpanel')).toBeVisible();
});

test('File backstage: opens, keyboard section navigation, Esc returns focus to File', async ({
  page,
}) => {
  await page.goto('/');
  const file = page.getByTestId('file-tab');
  await file.focus();
  await page.keyboard.press('Enter');
  const backstage = page.getByRole('dialog', { name: 'File' });
  await expect(backstage).toBeVisible();
  await backstage.getByRole('button', { name: 'Open' }).first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(backstage.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(backstage).toBeHidden();
  await expect(file).toBeFocused();
});

for (const q of ['/', '/?locale=pseudo']) {
  test(`the ribbon never makes the page scroll sideways at 1280 px (${q})`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(q);
    await page.getByRole('tab').nth(1).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}

test('every command M1 … M4 show has a handler: none says "Not available yet" (M1-28, M2-19, M3-20, M4-22)', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await cap(page, 'open', 'openHandles', [
    { name: 'doc.pdf', b64: pdfs.simple(1).toString('base64') },
  ]);
  await expect(page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab')).toHaveCount(
    1,
  );
  const notReady = async (): Promise<string[]> =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-command]')]
        .filter((b) => {
          const id = b.getAttribute('aria-describedby');
          return id && document.getElementById(id)?.textContent === 'Not available yet';
        })
        .map((b) => b.dataset.command ?? '?'),
    );
  const seen = new Set<string>();
  const collect = async () => {
    for (const id of await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-command]')].map(
        (b) => b.dataset.command ?? '',
      ),
    ))
      seen.add(id);
    expect(await notReady()).toEqual([]);
  };
  await collect(); // quick access + Home
  for (const tab of ['View', 'Comment', 'Organize', 'Convert', 'Measure', 'Protect', 'Help']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await collect();
  }
  await page.getByTestId('file-tab').click();
  const nav = page.getByTestId('backstage').getByRole('navigation').getByRole('listitem');
  for (const name of await nav.allInnerTexts()) {
    await nav.getByText(name.trim(), { exact: true }).click();
    await collect();
  }
  for (const id of [
    'qat.open',
    'qat.save',
    'help.updates',
    'help.clearData',
    'file.saveAs',
    // M2
    'qat.print',
    'file.print',
    'file.exportPrintReady',
    'home.selectText',
    'home.find',
    'home.advancedSearch',
    'home.resetForm',
    'view.prevView',
    'view.nextView',
    'protect.securityInfo',
    'protect.unlock',
    'protect.signatures',
    'help.help',
    'help.errorReport',
    // M3
    'qat.undo',
    'qat.redo',
    'comment.highlight',
    'comment.stickyNote',
    'comment.stamp',
    'comment.commentsPane',
    'comment.exportCrs',
    'measure.distance',
    'measure.area',
    'measure.setScale',
    'measure.scaleViewport',
    'measure.snapping',
    'measure.snapNearest',
    // M4: every M4 command is on a ribbon tab.
    'comment.exportAnnotations',
    'comment.importComments',
    'comment.copyComments',
    'comment.pasteComments',
    'comment.pasteToOriginal',
    'organize.insertBlank',
    'organize.insertFromFile',
    'organize.delete',
    'organize.move',
    'organize.extract',
    'organize.merge',
    'organize.rotateCw',
    'organize.rotateCcw',
    'convert.text',
    'convert.markdown',
    'convert.html',
    'convert.word',
    'convert.images',
    'convert.expressExtract',
    'convert.reviewExtract',
    'convert.tableTemplates',
    'protect.markRedaction',
    'protect.markRedactionArea',
    'protect.applyRedactions',
    'protect.redactionList',
  ])
    expect(seen).toContain(id);
});
