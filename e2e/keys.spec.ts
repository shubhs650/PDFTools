import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M1-11: the central keymap (§8.1, D-29, M1-Q1).

const TARGETS = [
  'file.open',
  'file.save',
  'file.saveAs',
  'view.fitPage',
  'view.actualSize',
  'view.fitWidth',
  'view.zoomIn',
  'view.zoomOut',
  'view.collapseRibbon',
  'home.hand',
  'home.select',
  'tool.cancel',
  'tab.close',
  'tab.next',
  'tab.prev',
];

interface Hook {
  __pdftoolsTest: { capabilities: { commands: { spy(ids: string[]): void; calls(): string[] } } };
}

async function spy(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
        .__pdftoolsTest?.capabilities.commands,
    ),
  );
  await page.evaluate((ids) => {
    (window as unknown as Hook).__pdftoolsTest.capabilities.commands.spy(ids);
  }, TARGETS);
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__pdftoolsTest.capabilities.commands.calls());

test('every M1 shortcut and alternate runs its command', async ({ page }) => {
  await spy(page);
  const presses: [string, string][] = [
    ['Control+o', 'file.open'],
    ['Control+s', 'file.save'],
    ['Control+Shift+S', 'file.saveAs'],
    ['Control+0', 'view.fitPage'],
    ['Control+1', 'view.actualSize'],
    ['Control+2', 'view.fitWidth'],
    ['Control+=', 'view.zoomIn'],
    ['Control+-', 'view.zoomOut'],
    ['Control+F1', 'view.collapseRibbon'],
    ['Control+F4', 'tab.close'],
    ['Control+Alt+w', 'tab.close'],
    ['Control+Alt+F4', 'tab.close'],
    ['Control+PageDown', 'tab.next'],
    ['Control+Alt+PageDown', 'tab.next'],
    ['Control+PageUp', 'tab.prev'],
    ['Control+Alt+PageUp', 'tab.prev'],
    ['Escape', 'tool.cancel'],
  ];
  for (const [keys] of presses) await page.keyboard.press(keys);
  expect(await calls(page)).toEqual(presses.map(([, id]) => id));
});

test('H and V act only when the document has focus', async ({ page }) => {
  await spy(page);
  await page.keyboard.press('h');
  expect(await calls(page)).toEqual([]);
  await page.getByRole('main', { name: 'Document area' }).focus();
  await page.keyboard.press('h');
  await page.keyboard.press('v');
  expect(await calls(page)).toEqual(['home.hand', 'home.select']);
});

test('shortcuts do not fire while typing in a text field (Esc and file chords like Ctrl+S still do)', async ({
  page,
}) => {
  await spy(page);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'probe');
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('Control+a');
  await page.keyboard.type('hv');
  await page.keyboard.press('Control+s'); // saves, as in a form field (M2-19)
  await page.keyboard.press('Escape');
  expect(await calls(page)).toEqual(['file.save', 'tool.cancel']);
});

test('the shortcut sheet opens from Help and lists every binding', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Help' }).click();
  await page
    .getByRole('toolbar', { name: 'Help commands' })
    .getByRole('button', { name: 'Keyboard Shortcuts' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const rows = dialog.getByTestId('shortcut-sheet').locator('tbody[data-part="keymap"] tr');
  await expect(rows).toHaveCount(80); // + Thin Lines (M13-05), the loupe's M (M13-09); // + undo, redo, 11 annotation keys (M3-05), 6 text markup tools (M3-08), 9 tools and Enter (M3-09), paste and paste to original pages (M4-21), full screen (M6-01), cut and the context menu (M6-02), 12 Bookmarks pane keys (M6-11), F2 on a text comment (M7-03), Dark Theme (M7-11), F1 for Help (M9-04), New (M10-08·O4), Tell Me (M10-08·O2), Move Tab Left/Right (M11-04), Reopen Closed Tab (M11-05)
  // M13-09: the keys a pane or window reads itself, in their own section.
  await expect(
    dialog.getByTestId('shortcut-sheet').locator('tbody[data-part="window"] tr'),
  ).toHaveCount(11); // a heading row and 10 keys
  await expect(dialog.getByRole('row', { name: /^Show or Hide the Loupe/ })).toContainText('M');
  await expect(dialog.getByRole('row', { name: /^Thin Lines/ })).toContainText('Ctrl+Alt+5');
  await expect(dialog.getByRole('row', { name: /^Blink between Old and New/ })).toContainText('X');
  await expect(dialog.getByRole('row', { name: /^Help/ })).toContainText('F1');
  // The Bookmarks pane's own keys say where they work (M6-11).
  await expect(dialog.getByRole('row', { name: /^Rename \(Bookmarks pane\)/ })).toContainText('F2');
  await expect(dialog.getByRole('row', { name: /^Edit the Selected Text Comment/ })).toContainText(
    'F2',
  );
  await expect(dialog.getByRole('row', { name: /^Print/ })).toContainText('Ctrl+P'); // M2-15
  await expect(dialog.getByRole('row', { name: /Find Next/ })).toContainText('F3');
  await expect(dialog.getByRole('row', { name: /Copy Selected Text/ })).toContainText('Ctrl+C');
  await expect(dialog.getByRole('row', { name: /^Cut Ctrl/ })).toContainText('Ctrl+X'); // M6-02
  await expect(dialog.getByRole('row', { name: /^Context Menu/ })).toContainText('Shift+F10');
  await expect(dialog.getByRole('row', { name: /^Context Menu/ })).toContainText('Menu key');
  await expect(dialog.getByRole('rowheader', { name: 'Close Tab' })).toBeVisible();
  await expect(dialog.getByRole('row', { name: /Close Tab/ })).toContainText('Ctrl+Alt+W');
  await expect(dialog.getByRole('row', { name: /^New Ctrl/ })).toContainText('Ctrl+Alt+N'); // M10-08·O4
  await expect(dialog.getByRole('row', { name: /^Undo/ })).toContainText('Ctrl+Z');
  await expect(dialog.getByRole('row', { name: /Delete Selected Comments/ })).toContainText(
    'Delete',
  );
  await expect(dialog.getByRole('row', { name: /^Full Screen/ })).toContainText('Ctrl+Shift+F11');
  // Reopen Closed Tab (M11-05): Chrome keeps Ctrl+Shift+T; the alternate works everywhere.
  await expect(dialog.getByRole('row', { name: /^Reopen Closed Tab/ })).toContainText(
    'Ctrl+Shift+Alt+T',
  );
  // Moving a file tab works on a focused tab (M11-04).
  await expect(dialog.getByRole('row', { name: /^Move Tab Left \(on a file tab\)/ })).toContainText(
    'Ctrl+Shift+Left',
  );
  await expect(dialog.getByRole('button', { name: 'Print' })).toBeVisible();
});

test('the key probe page lists keys that reach the page (owner check for reserved keys)', async ({
  page,
}) => {
  await page.goto('/?keyprobe');
  await page.locator('body[data-keyprobe="ready"]').waitFor({ state: 'attached' });
  await page.keyboard.press('Control+Alt+w');
  await expect(page.getByTestId('keys')).toContainText('Ctrl+Alt+w');
});
