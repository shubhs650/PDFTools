import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-27: the accessibility gate (§8.2, D-30, rule 12). Axe must report no
// violations on the start screen, the frame with a document, every ribbon
// tab, every backstage section and every M1 dialog, in the light and dark
// themes. CI runs this file as its own step (`npm run e2e:a11y`).

test.describe.configure({ mode: 'parallel' });

const THEMES = ['light', 'dark'] as const;
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function axe(page: Page, where: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
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
  const url = theme === 'dark' ? '/?theme=dark' : '/';

  test(
    `start screen, ribbon tabs and every backstage section (${theme})`,
    { tag: '@a11y' },
    async ({ page }) => {
      await page.goto(url);
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await axe(page, 'start screen');
      for (const tab of ['Home', 'View', 'Comment', 'Measure', 'Help']) {
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
  ['dark', '/?theme=dark'],
  ['pseudo-locale', '/?locale=pseudo'],
] as const) {
  test(`M2 panes, find bar and dialogs (${variant})`, { tag: '@a11y' }, async ({ page }) => {
    const { outlinedPdf } = await import('./fixtures/generate.ts');
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
      'help.help',
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
  ['dark', '/?theme=dark'],
  ['pseudo-locale', '/?locale=pseudo'],
] as const) {
  test(`M3 panes and dialogs (${variant})`, { tag: '@a11y' }, async ({ page }) => {
    const { simplePdf } = await import('./fixtures/generate.ts');
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
