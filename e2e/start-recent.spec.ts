import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-18: start screen and recent files. OPFS file handles stand in for files
// on disk (same FileSystemFileHandle API).

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const start = (page: Page) => page.getByTestId('start-screen');
const recent = (page: Page) => start(page).getByTestId('recent-list');

async function openViaHandles(page: Page, files: { name: string; b64: string }[]) {
  const before = await tabs(page).count();
  await cap(page, 'open', 'openHandles', files);
  await expect(tabs(page)).toHaveCount(before + files.length);
}

async function closeAll(page: Page) {
  for (const name of await tabs(page).allInnerTexts()) {
    await page.getByRole('button', { name: `Close ${name.trim()}` }).click();
  }
  await expect(start(page)).toBeVisible();
}

test('opened files appear in Recent, newest first; reopening works by keyboard and survives a reload', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await expect(recent(page)).toContainText('No recent files yet.');
  await openViaHandles(page, [{ name: 'first.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await openViaHandles(page, [{ name: 'second.pdf', b64: pdfs.simple(2).toString('base64') }]);
  await closeAll(page);

  const items = recent(page).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('second.pdf');
  await expect(items.nth(1)).toContainText('first.pdf');
  await expect(items.nth(0)).toContainText(/now|second|minute/);
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);

  // Keyboard: Tab to the entry and press Enter.
  const entry = recent(page).getByRole('button', { name: /^first\.pdf/ });
  await entry.focus();
  await page.keyboard.press('Enter');
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAccessibleName('first.pdf');
  await closeAll(page);
  await expect(items.nth(0)).toContainText('first.pdf'); // reopening moved it to the top

  await page.reload();
  await expect(recent(page).getByRole('listitem')).toHaveCount(2);
});

test('the backstage Recent section lists the same files and closes after opening one', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openViaHandles(page, [{ name: 'report.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await closeAll(page);
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Recent' }).click();
  const list = backstage.getByTestId('recent-list');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await list.getByRole('button', { name: /^report\.pdf/ }).click();
  await expect(backstage).toBeHidden();
  await expect(tabs(page)).toHaveCount(1);
});

test('entries can be removed one by one or all cleared', async ({ page, pdfs }) => {
  await page.goto('/');
  await openViaHandles(page, [
    { name: 'a.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'b.pdf', b64: pdfs.simple(2).toString('base64') },
  ]);
  await closeAll(page);
  await expect(recent(page).getByRole('listitem')).toHaveCount(2);
  await recent(page).getByRole('button', { name: 'Remove a.pdf from recent files' }).click();
  await expect(recent(page).getByRole('listitem')).toHaveCount(1);
  await recent(page).getByRole('button', { name: 'Clear recent' }).click();
  await expect(recent(page)).toContainText('No recent files yet.');
});

test('a file that is gone says so and can be removed from the list', async ({ page, pdfs }) => {
  await page.goto('/');
  await openViaHandles(page, [{ name: 'gone.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await closeAll(page);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('e2e-files');
    await dir.removeEntry('gone.pdf');
  });
  await recent(page)
    .getByRole('button', { name: /^gone\.pdf/ })
    .click();
  const alert = recent(page).getByRole('alert');
  await expect(alert).toContainText('gone.pdf is no longer available');
  await alert.getByRole('button', { name: 'Remove from list' }).click();
  await expect(recent(page)).toContainText('No recent files yet.');
  await expect(tabs(page)).toHaveCount(0);
});

test('without file handles (Firefox/Safari path) there is no recent list and no errors', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
  });
  await page.goto('/');
  await expect(start(page)).toBeVisible();
  await expect(page.getByTestId('recent-list')).toHaveCount(0);
});
