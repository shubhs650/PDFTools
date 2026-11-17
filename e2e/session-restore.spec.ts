import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-08·O2 (ADR-028 D-53): pick up where you left off. File › Settings › Start-up: the
// start screen (default) or the files open last time. OPFS file handles stand in for files
// on disk; a reload stands in for closing and starting the app again. OPFS handles are
// always readable, so "the browser asks again" is simulated by an init script that makes
// queryPermission answer "prompt" (and requestPermission "granted") when asked to.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const start = (page: Page) => page.getByTestId('start-screen');
const backstage = (page: Page) => page.getByTestId('backstage');
const prompt = (page: Page) => page.getByTestId('session-prompt');

async function openViaHandles(page: Page, files: { name: string; b64: string }[]) {
  const before = await tabs(page).count();
  await cap(page, 'open', 'openHandles', files);
  await expect(tabs(page)).toHaveCount(before + files.length);
}

async function startupChoice(page: Page) {
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  const group = backstage(page).getByRole('group', { name: 'When Triya PDF starts' });
  await expect(group).toBeVisible();
  return group;
}

async function chooseReopen(page: Page) {
  const group = await startupChoice(page);
  await group.getByRole('radio', { name: 'Reopen the files from last time' }).check();
  await page.keyboard.press('Escape');
  await expect(backstage(page)).toBeHidden();
}

const openState = (page: Page) =>
  cap(page, 'open', 'state') as Promise<{ names: string[]; activeId: string }>;

/** What is kept on the device (names and the selected index), read from IndexedDB. */
const kept = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ names: string[]; active: number } | null>((resolve, reject) => {
        const req = indexedDB.open('pdftools');
        req.onerror = () => {
          reject(new Error('idb'));
        };
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('session')) {
            db.close();
            resolve(null);
            return;
          }
          const get = db.transaction('session').objectStore('session').get('last');
          get.onsuccess = () => {
            const v = get.result as { entries: { name: string }[]; active: number } | undefined;
            db.close();
            resolve(v ? { names: v.entries.map((e) => e.name), active: v.active } : null);
          };
        };
      }),
  );

/** After the next load, file handles need the browser's permission again (until cleared). */
const askAgainOnReload = (page: Page) =>
  page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-ask') !== '1') return;
    const proto = FileSystemHandle.prototype as unknown as {
      queryPermission: () => Promise<PermissionState>;
      requestPermission: () => Promise<PermissionState>;
    };
    let allowed = false;
    proto.queryPermission = () => Promise.resolve(allowed ? 'granted' : 'prompt');
    proto.requestPermission = () => {
      if (!navigator.userActivation.isActive)
        return Promise.reject(new DOMException('needs a click', 'SecurityError'));
      allowed = true; // as Chrome's "Allow on every visit": one answer restores them all
      return Promise.resolve('granted');
    };
  });

test('by default the start screen shows and nothing about open files is kept', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openViaHandles(page, [{ name: 'a.pdf', b64: pdfs.simple(1).toString('base64') }]);
  const group = await startupChoice(page);
  await expect(group.getByRole('radio', { name: 'Show the start screen' })).toBeChecked();
  await page.keyboard.press('Escape');
  expect(await kept(page)).toBeNull();
  await page.reload();
  await expect(start(page)).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
  await expect(prompt(page)).toHaveCount(0);
});

test('"Reopen the files from last time" reopens them in order with the selected tab, and "start screen" forgets them @smoke', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await chooseReopen(page);
  await openViaHandles(page, [
    { name: 'first.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'second.pdf', b64: pdfs.simple(2).toString('base64') },
    { name: 'third.pdf', b64: pdfs.simple(3).toString('base64') },
  ]);
  // A new document that was never saved can't be reopened, so it is not kept.
  await page.keyboard.press('Control+Alt+n');
  await page
    .getByRole('dialog', { name: 'Create Blank PDF' })
    .getByRole('button', { name: 'Create' })
    .click();
  await expect(tabs(page)).toHaveCount(4);
  await tabs(page).nth(1).click();
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => kept(page))
    .toEqual({ names: ['first.pdf', 'second.pdf', 'third.pdf'], active: 1 });

  await page.reload();
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(0)).toHaveAccessibleName('first.pdf');
  await expect(tabs(page).nth(1)).toHaveAccessibleName('second.pdf');
  await expect(tabs(page).nth(2)).toHaveAccessibleName('third.pdf');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);

  // Closing a tab changes what is kept.
  await page.getByRole('button', { name: 'Close third.pdf' }).click();
  await expect.poll(() => kept(page)).toEqual({ names: ['first.pdf', 'second.pdf'], active: 1 });

  const group = await startupChoice(page);
  await group.getByRole('radio', { name: 'Show the start screen' }).check();
  await page.keyboard.press('Escape');
  await expect.poll(() => kept(page)).toBeNull();
  await page.reload();
  await expect(start(page)).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
});

test('files the browser asks about again wait on the start screen until "Reopen files"', async ({
  page,
  pdfs,
}) => {
  await askAgainOnReload(page);
  await page.goto('/');
  await chooseReopen(page);
  await openViaHandles(page, [
    { name: 'plan.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'section.pdf', b64: pdfs.simple(2).toString('base64') },
  ]);
  await expect.poll(() => kept(page)).toEqual({ names: ['plan.pdf', 'section.pdf'], active: 1 });
  await page.evaluate(() => {
    sessionStorage.setItem('e2e-ask', '1');
  });
  await page.reload();

  const card = prompt(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Pick up where you left off' })).toBeVisible();
  await expect(card).toContainText('2 files were open last time: plan.pdf and section.pdf');
  await expect(tabs(page)).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  // Still kept while waiting, so another restart offers them again.
  expect(await kept(page)).toEqual({ names: ['plan.pdf', 'section.pdf'], active: 1 });

  // By keyboard: Tab to the button and press Enter (a key press is a user activation).
  await card.getByRole('button', { name: 'Reopen 2 files' }).focus();
  await page.keyboard.press('Enter');
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAccessibleName('plan.pdf');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(prompt(page)).toHaveCount(0);
});

test('some files reopen at once; the rest wait in a bar over the document, and "Not now" forgets them', async ({
  page,
  pdfs,
}) => {
  await askAgainOnReload(page);
  await page.goto('/');
  await chooseReopen(page);
  await openViaHandles(page, [
    { name: 'kept.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'asks.pdf', b64: pdfs.simple(2).toString('base64') },
  ]);
  await expect.poll(() => kept(page)).toEqual({ names: ['kept.pdf', 'asks.pdf'], active: 1 });
  // Only asks.pdf needs permission again: kept.pdf's handle answers "granted".
  await page.evaluate(() => {
    sessionStorage.setItem('e2e-ask', '1');
  });
  await page.addInitScript(() => {
    const proto = FileSystemHandle.prototype as unknown as {
      queryPermission: (this: FileSystemHandle) => Promise<PermissionState>;
    };
    const ask = proto.queryPermission;
    proto.queryPermission = function (this: FileSystemHandle) {
      return this.name === 'kept.pdf' ? Promise.resolve('granted') : ask.call(this);
    };
  });
  await page.reload();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAccessibleName('kept.pdf');
  const bar = page.getByRole('region', { name: 'Pick up where you left off' });
  await expect(bar).toContainText('asks.pdf from last time is not open yet');
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  await bar.getByRole('button', { name: 'Not now' }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect.poll(() => kept(page)).toEqual({ names: ['kept.pdf'], active: 0 });
});

test('a file with unsaved changes is offered by recovery, not reopened from the disk', async ({
  page,
  pdfs,
}) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
  await page.goto('/');
  await chooseReopen(page);
  await openViaHandles(page, [
    { name: 'clean.pdf', b64: pdfs.simple(1).toString('base64') },
    { name: 'edited.pdf', b64: pdfs.simple(2).toString('base64') },
  ]);
  const { activeId } = await openState(page);
  expect(await cap(page, 'save', 'addSquares', activeId, 1)).toBeNull();
  await expect
    .poll(async () => ((await cap(page, 'storage', 'list')) as unknown[]).length, {
      timeout: 10_000,
    })
    .toBe(1);

  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved changes?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('edited.pdf');
  // Behind the dialog (hidden from the accessibility tree while it is open).
  await expect.poll(async () => (await openState(page)).names).toEqual(['clean.pdf']);
  await dialog.getByRole('button', { name: 'Recover edited.pdf' }).click();
  await expect.poll(async () => (await openState(page)).names).toEqual(['clean.pdf', 'edited.pdf']);
});

test('Privacy lists the kept files and Clear all local data goes back to the start screen', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await chooseReopen(page);
  await openViaHandles(page, [{ name: 'a.pdf', b64: pdfs.simple(1).toString('base64') }]);
  await expect.poll(() => kept(page)).toEqual({ names: ['a.pdf'], active: 0 });
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Privacy', exact: true }).click();
  await expect(backstage(page)).toContainText('pdftools › session');
  await expect(backstage(page)).toContainText('Files open last time');
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await backstage(page).getByRole('button', { name: 'Clear all local data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(confirm).toBeHidden();
  await expect(
    backstage(page)
      .getByRole('group', { name: 'When Triya PDF starts' })
      .getByRole('radio', { name: 'Show the start screen' }),
  ).toBeChecked();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(tabs(page)).toHaveCount(0);
  await expect(start(page)).toBeVisible();
});

test('without file handles (Firefox/Safari path) there is no Start-up choice', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
  });
  await page.goto('/');
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(backstage(page).getByTestId('appearance-section')).toBeVisible();
  await expect(backstage(page).getByTestId('startup-section')).toHaveCount(0);
});
