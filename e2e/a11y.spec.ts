import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-27: the accessibility gate (§8.2, D-30, rule 12). Axe must report no
// violations on the start screen, the frame with a document, every ribbon
// tab, every backstage section and every M1 dialog, in the light and dark
// themes. CI runs this file as its own step (`npm run e2e:a11y`).

test.describe.configure({ mode: 'parallel' });

const THEMES = ['light', 'dark'] as const;
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function axe(page: Page, where: string, include?: string): Promise<void> {
  const builder = new AxeBuilder({ page });
  // An open menu hides the rest of the app from assistive technology (it is
  // modal), so a menu is checked on its own, as the feature specs do.
  if (include) builder.include(include);
  const { violations } = await builder.analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    where,
  ).toEqual([]);
}

async function openHandle(page: Page, name: string, bytes: Buffer): Promise<string> {
  const before = await tabs(page).count();
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name, b64: bytes.toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await expect(tabs(page)).toHaveCount(before + 1);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return id;
}

for (const theme of THEMES) {
  const url = '/';

  test(
    `start screen, ribbon tabs and every backstage section (${theme})`,
    { tag: '@a11y' },
    async ({ page }) => {
      test.setTimeout(90_000); // nine ribbon tabs and every backstage section
      if (theme === 'dark') await darkTheme(page);
      await page.goto(url);
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await axe(page, 'start screen');
      // Every ribbon tab (M7-11: Form, Organize, Convert and Protect too).
      for (const tab of [
        'Home',
        'View',
        'Comment',
        'Form',
        'Measure',
        'Organize',
        'Convert',
        'Protect',
        'Help',
      ]) {
        await page.getByRole('tab', { name: tab }).click();
        await axe(page, `ribbon: ${tab}`);
      }
      await page.getByTestId('file-tab').click();
      const backstage = page.getByTestId('backstage');
      const sections = backstage.getByRole('navigation').getByRole('listitem').getByRole('button');
      const names = await sections.allInnerTexts();
      expect(names.length).toBeGreaterThanOrEqual(8);
      for (const name of names) {
        await sections.getByText(name.trim(), { exact: true }).click();
        await expect(
          backstage.getByRole('heading', { name: name.trim(), exact: true }),
        ).toBeVisible();
        await axe(page, `backstage: ${name.trim()}`);
      }
    },
  );

  test(
    `frame with a document and the document dialogs (${theme})`,
    { tag: '@a11y' },
    async ({ page, pdfs }) => {
      page.on('dialog', (d) => {
        void d.accept();
      });
      if (theme === 'dark') await darkTheme(page);
      await page.goto(url);
      const id = await openHandle(page, 'report.pdf', pdfs.simple(3));
      await axe(page, 'frame with a document');

      // Shortcut sheet.
      await page.getByRole('tab', { name: 'Help' }).click();
      await page.getByRole('button', { name: 'Keyboard Shortcuts' }).click();
      const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await expect(sheet).toBeVisible();
      await axe(page, 'shortcut sheet');
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();

      // Save Optimized.
      await page.getByTestId('file-tab').click();
      const backstage = page.getByTestId('backstage');
      await backstage.getByRole('button', { name: 'Save Optimized' }).first().click();
      await backstage.getByRole('region').getByRole('button', { name: 'Save Optimized' }).click();
      const optimize = page.getByRole('dialog', { name: 'Save report.pdf optimized' });
      await expect(optimize).toBeVisible();
      await axe(page, 'save optimized');
      await optimize.getByRole('button', { name: 'Cancel' }).click();

      // Clear all local data, with the unsaved-document warning.
      expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
      await page.getByRole('tab', { name: 'Help' }).click();
      await page.getByRole('button', { name: 'Clear All Local Data' }).click();
      await backstage.getByRole('button', { name: 'Clear all local data…' }).click();
      const clear = page.getByRole('dialog', { name: 'Clear all local data?' });
      await expect(clear.getByTestId('local-data-warning')).toBeVisible();
      await axe(page, 'clear local data');
      await clear.getByRole('button', { name: 'Cancel' }).click();

      // Reviewer profile (M3-07), with a field error showing.
      await backstage.getByRole('button', { name: 'Edit reviewer profile…' }).click();
      const profile = page.getByRole('dialog', { name: 'Reviewer profile' });
      await expect(profile).toBeVisible();
      await axe(page, 'reviewer profile');
      await profile.getByRole('button', { name: 'Save' }).click();
      await expect(profile.getByRole('alert')).toBeVisible();
      await axe(page, 'reviewer profile error');
      await profile.getByRole('button', { name: 'Cancel' }).click();
      await page.keyboard.press('Escape');
      await expect(backstage).toBeHidden();

      // Insert Text (M3-08): the first-markup profile prompt, then the text to insert.
      await page.getByTestId('document-view').focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('i');
      const first = page.getByRole('dialog', { name: 'Who is reviewing?' });
      await expect(first).toBeVisible();
      await axe(page, 'first-markup profile prompt');
      await first.getByRole('button', { name: 'Skip for now' }).click();
      const caret = page.getByRole('dialog', { name: 'Text to insert' });
      await expect(caret).toBeVisible();
      await axe(page, 'insert text');
      await caret.getByRole('button', { name: 'Cancel' }).click();
      await expect(caret).toBeHidden();

      // Close with unsaved changes.
      await page.getByRole('button', { name: 'Close report.pdf' }).click();
      const close = page.getByRole('dialog', { name: 'Save changes to report.pdf?' });
      await expect(close).toBeVisible();
      await axe(page, 'close prompt');
      await close.getByRole('button', { name: 'Cancel' }).click();

      // Open error.
      await drop(page, [
        { name: 'notes.txt', b64: Buffer.from('text').toString('base64'), type: 'text/plain' },
      ]);
      const error = page.getByRole('dialog', { name: "Couldn't open notes.txt" });
      await expect(error).toBeVisible();
      await axe(page, 'open error');
      await error.getByRole('button', { name: 'OK' }).click();
    },
  );

  test(`recovery dialog (${theme})`, { tag: '@a11y' }, async ({ page, pdfs }) => {
    page.on('dialog', (d) => {
      void d.accept();
    });
    if (theme === 'dark') await darkTheme(page);
    await page.goto(url);
    const id = await openHandle(page, 'draft.pdf', pdfs.simple(2));
    expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
    await expect
      .poll(async () => ((await cap(page, 'storage', 'list')) as unknown[]).length, {
        timeout: 10_000,
      })
      .toBe(1);
    await page.reload();
    const recovery = page.getByRole('dialog', { name: 'Recover unsaved changes?' });
    await expect(recovery).toBeVisible();
    await axe(page, 'recovery dialog');
  });
}

// M2-19: the M2 panes, the find bar and the M2 dialogs, in light, dark and the
// pseudo-locale (longer strings, accents). Reached by command id and data
// attributes, so the same steps work whatever the language.
for (const [variant, url] of [
  ['light', '/'],
  ['dark', '/'],
  ['pseudo-locale', '/?locale=pseudo'],
] as const) {
  test(`M2 panes, find bar and dialogs (${variant})`, { tag: '@a11y' }, async ({ page }) => {
    const { outlinedPdf } = await import('./fixtures/generate.ts');
    if (variant === 'dark') await darkTheme(page);
    await page.goto(url);
    // Not openHandle(): its tab name differs in the pseudo-locale.
    await cap(page, 'open', 'openHandles', [
      { name: 'outlined.pdf', b64: Buffer.from(outlinedPdf()).toString('base64') },
    ]);
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
    const run = (id: string) =>
      page.evaluate(
        (cmd) =>
          (
            window as unknown as {
              __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
            }
          ).__pdftoolsTest.capabilities.commands.run(cmd),
        id,
      );

    for (const pane of [
      'rail.thumbnails',
      'rail.bookmarks',
      'rail.search',
      'rail.attachments',
      'rail.layers',
      'rail.signatures',
    ]) {
      const button = page.locator(`[data-rail="${pane}"] button`);
      // By command, not a click: the previous button's tooltip may cover this one.
      if ((await button.getAttribute('aria-pressed')) !== 'true') await run(pane);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('left-pane')).toBeVisible();
      await page.waitForTimeout(200); // let the pane's list settle
      await axe(page, `pane ${pane}`);
    }

    await page.getByTestId('document-view').focus();
    await page.keyboard.press('Control+F');
    await expect(page.locator('.find-bar')).toBeVisible();
    await axe(page, 'find bar');
    await page.keyboard.press('Escape');

    for (const id of [
      'file.print',
      'file.exportPrintReady',
      'protect.securityInfo',
      'help.errorReport',
    ]) {
      expect(await run(id)).toBe(true);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await axe(page, `dialog ${id}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  });
}

// M3-20: the M3 panes and dialogs — Comments pane with a thread, the
// Properties pane with a measurement and the page's viewports, the stamp,
// scheme, profile, scale, viewport and CRS dialogs — in light, dark and the
// pseudo-locale, reached by command id so the steps work in any language.
for (const [variant, url] of [
  ['light', '/'],
  ['dark', '/'],
  ['pseudo-locale', '/?locale=pseudo'],
] as const) {
  test(`M3 panes and dialogs (${variant})`, { tag: '@a11y' }, async ({ page }) => {
    const { simplePdf } = await import('./fixtures/generate.ts');
    if (variant === 'dark') await darkTheme(page);
    await page.goto(url);
    await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
    const [id] = (await cap(page, 'open', 'openHandles', [
      { name: 'm3.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') },
    ])) as string[];
    if (!id) throw new Error('not opened');
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
    await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
    const run = (cmd: string) =>
      page.evaluate(
        (c) =>
          (
            window as unknown as {
              __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
            }
          ).__pdftoolsTest.capabilities.commands.run(c),
        cmd,
      );
    const square = (await cap(page, 'annotate', 'createSquare', id, 0, 60, 60)) as string;
    const line = (await cap(page, 'annotate', 'measure', id, 0, 'distance', [
      { x: 100, y: 400 },
      { x: 300, y: 400 },
    ])) as string;
    await expect
      .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[]).length)
      .toBe(3);

    // Comments pane with the square's thread open.
    await run('comment.commentsPane');
    await cap(page, 'annotate', 'select', id, 0, square);
    await expect(page.getByTestId('left-pane')).toBeVisible();
    await page.waitForTimeout(200);
    await axe(page, 'Comments pane');

    // Properties pane: the measurement, and the Measure tab's viewport list.
    await run('view.propertiesPane');
    await cap(page, 'annotate', 'select', id, 0, line);
    await expect(page.getByTestId('measure-info')).toBeVisible();
    await page.locator('#ribbon-tab-measure').click();
    await expect(page.locator('.viewport-list')).toBeVisible();
    await axe(page, 'Properties pane (measurement, viewports)');
    await page.locator('.viewport-list > button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await axe(page, 'dialog scale viewport');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    for (const cmd of [
      'comment.reviewerProfile',
      'comment.statusSchemes',
      'comment.stamp',
      'comment.imageStamp',
      'measure.setScale',
      'measure.calibrate',
      'comment.exportCrs',
    ]) {
      expect(await run(cmd)).toBe(true);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await axe(page, `dialog ${cmd}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  });
}

// M4-22: the M4 panes, dialogs and the review mode — Pages pane, the page
// dialogs (insert, delete, move, extract, from a file, merge), the export
// dialogs, Express Extract, Review & Extract, Table Templates, Import Comments
// and Export Annotations, the pending-redactions pane and Apply Redactions
// with its verified result — in light, dark and the pseudo-locale, reached by
// command id so the steps work in any language.
for (const [variant, url] of [
  ['light', '/'],
  ['dark', '/'],
  ['pseudo-locale', '/?locale=pseudo'],
] as const) {
  test(`M4 panes, dialogs and review mode (${variant})`, { tag: '@a11y' }, async ({ page }) => {
    test.setTimeout(120_000);
    const { tablesPdf } = await import('./fixtures/tables.ts');
    const { stubSavePicker } = await import('./support/savePicker.ts');
    const pdf = Buffer.from(tablesPdf()).toString('base64');
    if (variant === 'dark') await darkTheme(page);
    await page.goto(url);
    await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
    const [id] = (await cap(page, 'open', 'openHandles', [
      { name: 'm4.pdf', b64: pdf },
    ])) as string[];
    if (!id) throw new Error('not opened');
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
    await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
    await stubSavePicker(page);
    // Every open picker returns the same self-made PDF.
    await page.evaluate((data) => {
      const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
      w.showOpenFilePicker = () => {
        const bin = atob(data);
        const file = new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], 'other.pdf', {
          type: 'application/pdf',
        });
        return Promise.resolve([
          { kind: 'file', name: 'other.pdf', getFile: () => Promise.resolve(file) },
        ]);
      };
    }, pdf);
    const run = (cmd: string) =>
      page.evaluate(
        (c) =>
          (
            window as unknown as {
              __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
            }
          ).__pdftoolsTest.capabilities.commands.run(c),
        cmd,
      );
    const dialog = page.getByRole('dialog');
    const closeDialog = async () => {
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    };

    // Pages pane (M4-10).
    // The rail button toggles; the pane may already be open with a document.
    await run('rail.thumbnails');
    await page.waitForTimeout(300);
    if (!(await page.getByTestId('left-pane').isVisible())) await run('rail.thumbnails');
    await expect(page.getByTestId('left-pane')).toBeVisible();
    await page.waitForTimeout(200);
    await axe(page, 'Pages pane');

    for (const cmd of [
      'organize.insertBlank',
      'organize.delete',
      'organize.move',
      'organize.extract',
      'convert.text',
      'convert.markdown',
      'convert.html',
      'convert.word',
      'convert.images',
      'convert.tableTemplates',
      'comment.exportAnnotations',
    ]) {
      expect(await run(cmd)).toBe(true);
      await expect(dialog).toBeVisible();
      await axe(page, `dialog ${cmd}`);
      await closeDialog();
    }

    // Dialogs with a chosen file: Insert from File, Merge, Import Comments.
    for (const cmd of ['organize.insertFromFile', 'organize.merge', 'comment.importComments']) {
      expect(await run(cmd)).toBe(true);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button').filter({ hasText: '…' }).first().click();
      await expect(dialog.getByText(/other\.pdf/u).first()).toBeVisible();
      await axe(page, `dialog ${cmd} with a file`);
      await closeDialog();
    }

    // Express Extract with its tables found (M4-13).
    expect(await run('convert.expressExtract')).toBe(true);
    await expect(dialog).toBeVisible();
    await axe(page, 'dialog convert.expressExtract');
    await dialog.locator('button[type="submit"]').click(); // Find Tables
    await expect(dialog.locator('div[role="status"]')).toBeVisible({ timeout: 30_000 });
    await axe(page, 'dialog convert.expressExtract with tables found');
    await closeDialog();

    // Review & Extract mode (M4-14).
    expect(await run('convert.reviewExtract')).toBe(true);
    const panel = page.locator('aside.table-review-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('status')).toHaveText(/\d/u, { timeout: 30_000 });
    await axe(page, 'Review & Extract');
    expect(await run('convert.reviewExtract')).toBe(true);
    await expect(panel).toHaveCount(0);

    // A redaction mark: pending pane (M4-16), Apply with its verified result (M4-18).
    const area = { origin: { x: 60, y: 60 }, size: { width: 300, height: 60 } };
    await cap(page, 'annotate', 'create', id, 4, {
      type: 28,
      rect: area,
      segmentRects: [area],
      color: '#000000',
      strokeColor: '#D93025',
    });
    expect(await run('protect.redactionList')).toBe(true);
    await expect(page.getByTestId('left-pane')).toBeVisible();
    await page.waitForTimeout(200);
    await axe(page, 'Pending redactions pane');
    expect(await run('protect.applyRedactions')).toBe(true);
    await expect(dialog).toBeVisible();
    await axe(page, 'dialog protect.applyRedactions');
    await dialog.getByRole('button').filter({ hasText: '…' }).first().click();
    await expect(dialog.getByTestId('redact-result')).toBeVisible({ timeout: 60_000 });
    await axe(page, 'Apply Redactions result');
    await closeDialog();
  });
}

// M6-15: the beta-review UI — Comments pane cards, the property grid, the
// comment and bookmark menus, Flatten Comments, Comment Styles Palette,
// Password Security, Sign Document, Bookmark Properties, the Form tab's
// Field Properties and tab order panel, and Snapshot's keyboard rectangle —
// in light, dark and the pseudo-locale, reached by command id and keys so
// the steps work in any language.
for (const [variant, url] of [
  ['light', '/'],
  ['dark', '/'],
  ['pseudo-locale', '/?locale=pseudo'],
] as const) {
  test(`M6 panes, dialogs and menus (${variant})`, { tag: '@a11y' }, async ({ page }) => {
    test.setTimeout(120_000);
    const { richOutlinePdf } = await import('./fixtures/generate.ts');
    if (variant === 'dark') await darkTheme(page);
    await page.goto(url);
    await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
    await drop(page, [{ name: 'm6.pdf', b64: Buffer.from(richOutlinePdf()).toString('base64') }]);
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
    const id = (await cap(page, 'view', 'activeDocId')) as string;
    await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
    const run = (cmd: string) =>
      page.evaluate(
        (c) =>
          (
            window as unknown as {
              __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
            }
          ).__pdftoolsTest.capabilities.commands.run(c),
        cmd,
      );
    const dialog = page.getByRole('dialog');
    const view = page.getByTestId('document-view');
    const sq = (await cap(page, 'annotate', 'createSquare', id, 0, 60, 60)) as string;
    await cap(page, 'annotate', 'create', id, 0, {
      type: 3,
      rect: { origin: { x: 260, y: 60 }, size: { width: 160, height: 40 } },
      contents: 'Check the weld',
      fontFamily: 4,
      fontSize: 10,
      fontColor: '#FF0000',
      color: 'transparent',
    });

    // Comments pane cards (M6-05).
    expect(await run('rail.comments')).toBe(true);
    await expect(page.getByTestId('comments-list')).toBeVisible();
    await axe(page, 'Comments pane');

    // The property grid of a selected comment (M6-06) and its menu (M6-02).
    await cap(page, 'annotate', 'select', id, 0, sq);
    if (!(await page.getByTestId('properties-pane').isVisible()))
      expect(await run('view.propertiesPane')).toBe(true);
    await expect(page.getByTestId('properties-pane')).toBeVisible();
    await axe(page, 'Properties pane (comment)');
    await view.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await axe(page, 'comment menu', '[role="menu"]');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Dialogs (M6-07, M6-09, M6-12, M6-13).
    for (const cmd of [
      'comment.flatten',
      'comment.stylesPalette',
      'protect.passwordSecurity',
      'protect.signDocument',
    ]) {
      expect(await run(cmd)).toBe(true);
      await expect(dialog).toBeVisible();
      await axe(page, `dialog ${cmd}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }

    // The Bookmarks pane, its menu and Bookmark Properties (M6-11).
    expect(await run('rail.bookmarks')).toBe(true);
    const tree = page.getByRole('tree');
    await expect(tree).toBeVisible();
    await tree.getByRole('treeitem').first().focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await axe(page, 'bookmark menu', '[role="menu"]');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+Enter');
    await expect(dialog).toBeVisible();
    await axe(page, 'Bookmark Properties');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Snapshot's keyboard rectangle (M6-09).
    await view.focus();
    expect(await run('home.snapshot')).toBe(true);
    await view.focus();
    await page.keyboard.press('Enter');
    await axe(page, 'Snapshot rectangle');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // The Form tab: a text field from the keyboard, Field Properties, the tab order panel (M6-14).
    expect(await run('form.textField')).toBe(true);
    await view.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('field-properties')).toBeVisible();
    await axe(page, 'Field Properties');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tab-order-panel')).toBeVisible();
    await axe(page, 'tab order panel');
  });
}

// M7-12: what M7 added (ADR-023 D-42 … D-45, ADR-024) in light, dark and the
// pseudo-locale, reached by command id and keys so the steps work in any
// language: a text comment being edited and its text menu with the Text
// Style submenu, the Properties pane's Text color and Border color and the
// colour picker, a sticky note window and its menu, and the top bar's theme
// toggle.
for (const [variant, url] of [
  ['light', '/'],
  ['dark', '/'],
  ['pseudo-locale', '/?locale=pseudo'],
] as const) {
  test(
    `M7 text editing, sticky note window and theme toggle (${variant})`,
    { tag: '@a11y' },
    async ({ page }) => {
      test.setTimeout(120_000);
      const { simplePdf } = await import('./fixtures/generate.ts');
      if (variant === 'dark') await darkTheme(page);
      await page.goto(url);
      await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
      await drop(page, [{ name: 'm7.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
      await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
      const id = (await cap(page, 'view', 'activeDocId')) as string;
      await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
      const run = (cmd: string) =>
        page.evaluate(
          (c) =>
            (
              window as unknown as {
                __pdftoolsTest: {
                  capabilities: { commands: { run(id: string): Promise<boolean> } };
                };
              }
            ).__pdftoolsTest.capabilities.commands.run(c),
          cmd,
        );
      const view = page.getByTestId('document-view');
      const menus = page.getByRole('menu');
      const editor = page.locator('[data-text-comment] [contenteditable="true"]');

      // The theme toggle in the top bar (M7-11).
      await axe(page, 'top bar', '.top-bar-actions');

      // A new text box edits at once (M7-02); its text menu and Text Style (M7-05).
      expect(await run('comment.textBox')).toBe(true);
      await view.focus();
      await page.keyboard.press('Enter');
      await expect(editor).toBeFocused();
      await page.keyboard.type('Check the weld');
      await axe(page, 'text comment being edited');
      await page.keyboard.press('Shift+F10');
      await expect(menus).toHaveCount(1);
      await axe(page, 'text menu', '[role="menu"]');
      await menus.locator('[aria-haspopup="menu"]').first().focus();
      await page.keyboard.press('ArrowRight');
      await expect(menus).toHaveCount(2);
      await axe(page, 'Text Style submenu', '[role="menu"]');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(menus).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      const [box] = ((await cap(page, 'annotate', 'list', id)) as { id: string }[] | null) ?? [];
      await cap(page, 'annotate', 'selectMany', id, [box?.id]);

      // The Properties pane of the selected text box: Text color and Border color (ADR-024).
      if (!(await page.getByTestId('properties-pane').isVisible()))
        expect(await run('view.propertiesPane')).toBe(true);
      const pane = page.getByTestId('properties-pane');
      await expect(pane).toBeVisible();
      await axe(page, 'Properties pane (text box)');
      await pane.locator('.ui-color-picker button').first().click();
      const picker = page.getByRole('dialog');
      await expect(picker).toBeVisible();
      await axe(page, 'colour picker', '[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(picker).toHaveCount(0);

      // A sticky note window (M7-06) and its menu.
      await view.focus();
      await page.keyboard.press('Escape');
      expect(await run('comment.stickyNote')).toBe(true);
      await view.focus();
      await page.keyboard.press('Enter');
      const note = page.locator('[data-note-popup]');
      await expect(note).toBeVisible();
      await page.keyboard.type('Two lines');
      await page.keyboard.press('Enter');
      await page.keyboard.type('in a note');
      await axe(page, 'sticky note window');
      await note.locator('[aria-haspopup="menu"]').first().click();
      await expect(menus).toHaveCount(1);
      await axe(page, 'sticky note menu', '[role="menu"]');
      await page.keyboard.press('Escape');
      await expect(menus).toHaveCount(0);
    },
  );
}
