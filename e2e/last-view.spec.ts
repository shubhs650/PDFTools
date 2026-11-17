import type { Page } from '@playwright/test';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-08·O3 (D-53): each file's page, zoom, layout and view rotation are kept
// on the device by the file's fingerprint and restored when it is opened
// again: after closing its tab, after reloading the app, for a file opened in
// a background tab, and for a file that was edited and saved. Listed in
// Privacy and forgotten by Clear all local data.

interface View {
  page: number;
  zoom: number | string;
  mode: string;
  rotation: number;
}

async function viewOf(page: Page): Promise<View> {
  const { activeId } = (await cap(page, 'open', 'state')) as { activeId: string };
  const view = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: {
              stores: { documents: { getState(): { docs: Record<string, { view: View }> } } };
            };
          };
        }
      ).__pdftoolsTest.capabilities.stores.documents.getState().docs[id]?.view ?? null,
    activeId,
  );
  if (!view) throw new Error('no active document');
  return { page: view.page, zoom: view.zoom, mode: view.mode, rotation: view.rotation };
}

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const pageBox = (page: Page) => status(page).getByRole('textbox', { name: 'Page number' });
const zoomBox = (page: Page) => status(page).getByRole('textbox', { name: 'Zoom' });
const modes = (page: Page) => status(page).getByRole('group', { name: 'View mode' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const pageShown = (page: Page, i: number) =>
  page.locator(`[data-page="${String(i)}"]:not([data-hidden]) img.page-preview`);

async function dropFile(page: Page, name: string, bytes: Buffer): Promise<void> {
  await drop(page, [{ name, b64: bytes.toString('base64') }]);
  await expect(tabs(page).filter({ hasText: name })).toHaveAttribute('aria-selected', 'true');
}

/** Page 25, 150 %, Single Page, rotated 90°: everything that is remembered. */
async function leaveAt(page: Page): Promise<void> {
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await modes(page).getByRole('button', { name: 'Single Page', exact: true }).click();
  await page.getByRole('tab', { name: 'View' }).click();
  await page
    .getByRole('toolbar', { name: 'View' })
    .getByRole('button', { name: 'Rotate View Clockwise' })
    .click();
  await zoomBox(page).fill('150');
  await zoomBox(page).press('Enter');
  await expect(zoomBox(page)).toHaveValue('150%');
  await pageBox(page).fill('25');
  await pageBox(page).press('Enter');
  await expect(pageBox(page)).toHaveValue('25');
}

const LEFT: View = { page: 24, zoom: 1.5, mode: 'single', rotation: 90 };

async function expectRestored(page: Page): Promise<void> {
  await expect.poll(() => viewOf(page)).toEqual(LEFT);
  await expect(pageBox(page)).toHaveValue('25');
  await expect(zoomBox(page)).toHaveValue('150%');
  await expect(
    modes(page).getByRole('button', { name: 'Single Page', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(pageShown(page, 24)).toBeVisible();
  // The pages are shown again once the view is in place.
  await expect(page.locator('.document-host[data-restoring]')).toHaveCount(0);
  await expect(page.getByTestId('document-view')).not.toHaveAttribute('aria-busy', /.*/);
}

test("a file reopens at its last page, zoom, layout and rotation; another file doesn't @smoke", async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await dropFile(page, 'contract.pdf', pdfs.contract(50));
  await leaveAt(page);
  await page.getByRole('button', { name: 'Close contract.pdf' }).click();
  await expect(tabs(page)).toHaveCount(0);

  // The same file under another name: the fingerprint, not the name, finds it.
  await dropFile(page, 'renamed copy.pdf', pdfs.contract(50));
  await expectRestored(page);

  // A file never seen before opens as always: page 1, fit width, continuous.
  await dropFile(page, 'other.pdf', pdfs.contract(30));
  await expect(pageBox(page)).toHaveValue('1');
  expect(await viewOf(page)).toEqual({
    page: 0,
    zoom: 'fitWidth',
    mode: 'continuous',
    rotation: 0,
  });

  // Back to the default view: the next open needs no restoring.
  await tabs(page).filter({ hasText: 'renamed copy.pdf' }).click();
  await modes(page).getByRole('button', { name: 'Continuous', exact: true }).click();
  await page.getByRole('tab', { name: 'View' }).click();
  await page
    .getByRole('toolbar', { name: 'View' })
    .getByRole('button', { name: 'Rotate View Counterclockwise' })
    .click();
  await page.keyboard.press('Control+2');
  await pageBox(page).fill('1');
  await pageBox(page).press('Enter');
  await expect
    .poll(() => viewOf(page))
    .toEqual({
      page: 0,
      zoom: 'fitWidth',
      mode: 'continuous',
      rotation: 0,
    });
  await page.getByRole('button', { name: 'Close renamed copy.pdf' }).click();
  await dropFile(page, 'contract.pdf', pdfs.contract(50));
  await expect(pageBox(page)).toHaveValue('1');
  expect(await viewOf(page)).toEqual({
    page: 0,
    zoom: 'fitWidth',
    mode: 'continuous',
    rotation: 0,
  });
});

test('the view is kept without closing the tab, and a background tab is restored when shown', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await dropFile(page, 'contract.pdf', pdfs.contract(50));
  await leaveAt(page);
  // Written about a second after the last change, so a reload (or a crash) keeps it.
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();

  // Opened together with another file: the other one is shown, this one waits.
  await drop(page, [
    { name: 'contract.pdf', b64: pdfs.contract(50).toString('base64') },
    { name: 'other.pdf', b64: pdfs.contract(30).toString('base64') },
  ]);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).filter({ hasText: 'other.pdf' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(pageBox(page)).toHaveValue('1');
  await tabs(page).filter({ hasText: 'contract.pdf' }).click();
  await expectRestored(page);
});

test('an edited and saved file reopens where it was left', async ({ page, pdfs }) => {
  await page.goto('/');
  await dropFile(page, 'doc.pdf', pdfs.contract(50));
  const { activeId: id } = (await cap(page, 'open', 'state')) as { activeId: string };
  await leaveAt(page);
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
  // Saved to a file (an OPFS handle stands in for the picked file): its fingerprint changes.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('e2e-files', { create: true });
      return dir.getFileHandle('doc.pdf', { create: true });
    };
  });
  await page.keyboard.press('Control+S');
  await expect(tabs(page).first()).toHaveAccessibleName('doc.pdf');
  const saved = Buffer.from((await cap(page, 'open', 'readFile', 'doc.pdf')) as string, 'base64');
  expect(saved.length).toBeGreaterThan(pdfs.contract(50).length);
  await page.getByRole('button', { name: 'Close doc.pdf' }).click();
  await expect(tabs(page)).toHaveCount(0);

  await dropFile(page, 'doc.pdf', saved);
  await expectRestored(page);
});

test('Privacy lists the last views and Clear all local data forgets them', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await dropFile(page, 'contract.pdf', pdfs.contract(50));
  await leaveAt(page);
  await page.getByRole('button', { name: 'Close contract.pdf' }).click();

  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Privacy', exact: true }).click();
  const row = backstage.getByRole('row', { name: /Where you left each file/ });
  await expect(row).toContainText('pdftools › lastViews');
  await expect(row).toContainText('Yes');

  await backstage.getByRole('button', { name: 'Settings', exact: true }).click();
  await backstage.getByRole('button', { name: 'Clear all local data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(backstage.getByTestId('local-data').getByRole('status')).toHaveText(
    'Local data cleared.',
  );
  await page.keyboard.press('Escape');

  await dropFile(page, 'contract.pdf', pdfs.contract(50));
  await expect(pageBox(page)).toHaveValue('1');
  expect(await viewOf(page)).toEqual({
    page: 0,
    zoom: 'fitWidth',
    mode: 'continuous',
    rotation: 0,
  });
});
