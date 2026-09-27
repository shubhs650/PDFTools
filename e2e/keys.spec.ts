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
  await page.getByRole('button', { name: 'Keyboard Shortcuts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const rows = dialog.getByTestId('shortcut-sheet').locator('tbody tr');
  await expect(rows).toHaveCount(24);
  await expect(dialog.getByRole('row', { name: /^Print/ })).toContainText('Ctrl+P'); // M2-15
  await expect(dialog.getByRole('row', { name: /Find Next/ })).toContainText('F3');
  await expect(dialog.getByRole('row', { name: /Copy Selected Text/ })).toContainText('Ctrl+C');
  await expect(dialog.getByRole('rowheader', { name: 'Close Tab' })).toBeVisible();
  await expect(dialog.getByRole('row', { name: /Close Tab/ })).toContainText('Ctrl+Alt+W');
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
