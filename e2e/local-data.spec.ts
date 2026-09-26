import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-26: File → Settings "Clear all local data", About (version, notices) and
// Privacy (every piece of local data). OPFS file handles stand in for files
// on disk, as in start-recent.spec.ts; edits come from the e2e save probe.

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const backstage = (page: Page) => page.getByTestId('backstage');
const snapshots = async (page: Page) => ((await cap(page, 'storage', 'list')) as unknown[]).length;

async function openHandle(page: Page, name: string, bytes: Buffer): Promise<string> {
  const before = await tabs(page).count();
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name, b64: bytes.toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await expect(tabs(page)).toHaveCount(before + 1);
  return id;
}

async function section(page: Page, name: string) {
  if (!(await backstage(page).isVisible())) await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name, exact: true }).click();
  await expect(backstage(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
});

test('Clear all local data empties recent files and recovery snapshots; the app keeps working', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await openHandle(page, 'kept.pdf', pdfs.simple(1));
  const id = await openHandle(page, 'edited.pdf', pdfs.simple(2));
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await expect.poll(() => snapshots(page), { timeout: 10_000 }).toBe(1);

  await section(page, 'Settings');
  const data = backstage(page).getByTestId('local-data');
  await expect(data.getByTestId('local-data-recent')).toHaveText('2');
  await expect(data.getByTestId('local-data-snapshots')).toHaveText('1');
  expect(await axe(page)).toEqual([]);

  // Cancel changes nothing.
  await data.getByRole('button', { name: 'Clear all local data…' }).click();
  let confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await expect(confirm.getByTestId('local-data-warning')).toContainText(
    '1 open document has unsaved changes',
  );
  expect(await axe(page)).toEqual([]);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  expect(await snapshots(page)).toBe(1);

  await data.getByRole('button', { name: 'Clear all local data…' }).click();
  confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(confirm).toBeHidden();
  await expect(data.getByRole('status')).toHaveText('Local data cleared.');
  await expect(data.getByTestId('local-data-recent')).toHaveText('0');
  await expect(data.getByTestId('local-data-snapshots')).toHaveText('0');
  expect(await snapshots(page)).toBe(0);
  // Only the test's stand-in "files on disk" remain in OPFS (rule 7: never touched).
  expect(await cap(page, 'storage', 'opfsEntries')).toEqual(['e2e-files']);

  // The open documents stay open, and the app keeps working: a new edit is
  // protected again, a new file joins the (fresh) recent list.
  await page.keyboard.press('Escape'); // backstage
  await expect(backstage(page)).toBeHidden();
  await expect(tabs(page)).toHaveCount(2);
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await expect.poll(() => snapshots(page), { timeout: 10_000 }).toBe(1);
  await openHandle(page, 'new.pdf', pdfs.simple(1));
  await section(page, 'Settings');
  await expect(data.getByTestId('local-data-recent')).toHaveText('1');
});

test('after clearing, a reload offers no recovery and lists no recent files', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const id = await openHandle(page, 'report.pdf', pdfs.simple(2));
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await expect.poll(() => snapshots(page), { timeout: 10_000 }).toBe(1);

  await section(page, 'Settings');
  await backstage(page).getByRole('button', { name: 'Clear all local data…' }).click();
  await page
    .getByRole('dialog', { name: 'Clear all local data?' })
    .getByRole('button', { name: 'Clear data' })
    .click();
  await expect(backstage(page).getByRole('status')).toHaveText('Local data cleared.');

  // Nothing unsaved is recoverable now; leave without re-editing.
  await page.reload();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(page.getByTestId('recent-list')).toContainText('No recent files yet.');
  await expect(page.getByRole('dialog', { name: 'Recover unsaved changes?' })).toHaveCount(0);
  expect(await snapshots(page)).toBe(0);
});

test('Privacy lists every local store; About shows the version and serves the notices', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await section(page, 'Privacy');
  const privacy = backstage(page).getByTestId('privacy');
  await expect(privacy).toContainText('Your documents never leave this device');
  await expect(privacy).toContainText('No analytics scripts');
  const table = privacy.getByRole('table', { name: 'Data PDFTools keeps on this device' });
  for (const where of ['pdftools › settings', 'pdftools › recent', 'recovery/', 'pdftools-…']) {
    await expect(table.getByRole('cell', { name: new RegExp(where) })).toBeVisible();
  }
  expect(await axe(page)).toEqual([]);

  await section(page, 'About');
  const about = backstage(page).getByTestId('about');
  await expect(about.getByTestId('app-version')).toHaveText(/^\d+\.\d+\.\d+/);
  const link = about.getByRole('link', { name: /Third-party notices/ });
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await axe(page)).toEqual([]);
  const res = await request.get(new URL((await link.getAttribute('href')) ?? '', page.url()).href);
  expect(res.status()).toBe(200);
  const notices = await res.text();
  for (const needle of [
    '@embedpdf/pdfium',
    'LICENSE.pdfium:',
    'SIL Open Font License, Version 1.1',
    'react-dom',
    'zustand',
  ]) {
    expect(notices).toContain(needle);
  }
});
