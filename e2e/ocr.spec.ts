import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { encryptedVariants, hasQpdf, USER_PW } from './fixtures/encrypted.ts';
import { SCANNED_NEEDLE, TEXT_PAGE_LINE } from './fixtures/scanned.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M5-04 (ADR-020): Convert → Recognize Text (OCR) on a self-made scanned
// document: the dialog, the pages without text get an invisible text layer
// (the text page is skipped), Quick Find then finds words on them, Ctrl+Z
// takes the layer away, Ctrl+S writes one verified revision; disabled without
// the modify permission (rule 9); the OCR worker is gone once the job ends.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function open(page: Page, bytes: Uint8Array): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name: 'scan.pdf', b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** Opens through a file handle (as the OS or the picker would), so Ctrl+S writes to it. */
async function openHandle(page: Page, bytes: Uint8Array): Promise<string> {
  await page.goto('/');
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name: 'scan.pdf', b64: b64(bytes) },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return id;
}

const fileOf = async (page: Page, name: string) =>
  Buffer.from((await cap(page, 'open', 'readFile', name)) as string, 'base64');

async function openDialog(page: Page) {
  await page.getByRole('tab', { name: 'Convert' }).click();
  await page
    .getByRole('toolbar', { name: 'Convert commands' })
    .getByRole('button', { name: 'Recognize Text (OCR)' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Recognize Text (OCR)' });
  await expect(dialog).toBeVisible();
  return dialog;
}

interface Outcome {
  recognized: number;
  skipped: number;
  words: number;
  blank: number;
}
const last = (page: Page) => cap(page, 'ocr', 'last') as Promise<Outcome | null>;
const waitDone = (page: Page) =>
  expect.poll(() => cap(page, 'ocr', 'busy'), { timeout: 90_000 }).toBe(false);

const bar = (page: Page) => page.getByRole('region', { name: 'Find in document' });
async function find(page: Page, needle: string): Promise<string> {
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+F');
  const field = bar(page).getByRole('searchbox', { name: 'Find' });
  await expect(field).toBeFocused();
  await field.fill(needle);
  await field.press('Enter');
  const status = bar(page).getByRole('status');
  await expect(status).not.toHaveText('', { timeout: 20_000 });
  await expect(status).not.toHaveText(/Searching/, { timeout: 20_000 });
  const text = await status.textContent();
  await page.keyboard.press('Escape');
  return text ?? '';
}

test('recognize all pages: text page skipped, the three scans get a layer, find works, undo removes it, save verified', async ({
  page,
  pdfs,
}) => {
  test.setTimeout(180_000);
  const scan = await pdfs.scanned();
  const id = await openHandle(page, scan);
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/^No results/);

  const dialog = await openDialog(page);
  await expect(dialog).toContainText('Pages that already have text are skipped');
  await expect(dialog.getByRole('checkbox', { name: 'English' })).toBeChecked();
  for (const name of ['Chinese (Simplified)', 'Hindi', 'Spanish', 'French'])
    await expect(dialog.getByRole('checkbox', { name })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Also recognize pages/ })).not.toBeChecked();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await expect(dialog.getByRole('radio', { name: 'All pages' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /Selected pages/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  await expect(dialog).toBeHidden();
  // Progress with Cancel while it runs (rule 2), then done.
  await expect(page.getByRole('dialog', { name: 'Changing pages' })).toBeVisible({
    timeout: 30_000,
  });
  await waitDone(page);
  const outcome = await last(page);
  expect(outcome).toMatchObject({ recognized: 3, skipped: 1, blank: 0 });
  expect(outcome?.words ?? 0).toBeGreaterThan(240); // 3 × 89 words, a few may be merged
  expect(await cap(page, 'ocr', 'workerRunning')).toBe(false);
  await expect(page.getByRole('tab', { name: /scan\.pdf/ })).toHaveAccessibleName(
    /unsaved changes/,
  );

  // The word is on the three recognized pages only (the text page has other words).
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/1 of 3/);
  expect(await find(page, 'already')).toMatch(/1 of 1/);
  // Pages render as before: the layer is invisible (a text pixel check is the unit test's).
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();

  // Undo: one step takes the whole layer away.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/^No results/);
  // Redo brings it back without recognizing again.
  await page.getByRole('button', { name: 'Redo' }).first().click();
  await expect.poll(() => cap(page, 'pages', 'busy')).toBe(false);
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/1 of 3/);

  // Ctrl+S: one verified revision appended to the original.
  await page.keyboard.press('Control+S');
  await expect(page.getByRole('tab', { name: /scan\.pdf/ })).not.toHaveAccessibleName(
    /unsaved changes/,
    { timeout: 30_000 },
  );
  const saved = await fileOf(page, 'scan.pdf');
  expect(saved.length).toBeGreaterThan(scan.length);
  expect(saved.subarray(0, scan.length).equals(Buffer.from(scan))).toBe(true);
  // PDFium re-encodes the streams on save (ADR-016), so the font name in each
  // recognized page's resources is what the bytes show: three pages, one layer each.
  const text = saved.toString('latin1');
  expect((text.match(/\/PDFToolsOCR\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
  expect(text).toContain(TEXT_PAGE_LINE.slice(0, 9)); // the original bytes are still there
  expect(id).toBeTruthy();
});

test('a page range and the current page; cancel mid-way leaves the document as it was', async ({
  page,
  pdfs,
}) => {
  test.setTimeout(120_000);
  await open(page, await pdfs.scanned());
  let dialog = await openDialog(page);
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('9');
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  await expect(dialog.getByText('Some pages are not in this document.')).toBeVisible();
  await dialog.getByLabel('Page range').fill('2, 4');
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  await expect(dialog).toBeHidden();
  await waitDone(page);
  expect(await last(page)).toMatchObject({ recognized: 1, skipped: 1 });
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/1 of 1/);

  // Page 1 (not recognized yet), cancelled while it runs: nothing changes.
  dialog = await openDialog(page);
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('1');
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  const progress = page.getByRole('dialog', { name: 'Changing pages' });
  await expect(progress).toBeVisible({ timeout: 30_000 });
  await progress.getByRole('button', { name: 'Cancel' }).click();
  await waitDone(page);
  expect(await cap(page, 'ocr', 'workerRunning')).toBe(false);
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/1 of 1/);
});

test('without the modify permission the command is disabled with the reason', async ({
  page,
  pdfs,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
  const v = encryptedVariants(await pdfs.scanned()).find((x) => x.name === 'R6-aes-256');
  if (!v) throw new Error('fixture');
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(v.bytes) }]);
  const pw = page.getByRole('dialog', { name: 'Password required' });
  await pw.getByLabel('Password').fill(USER_PW);
  await pw.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page.getByRole('tab', { name: 'Convert' }).click();
  const button = page
    .getByRole('toolbar', { name: 'Convert commands' })
    .getByRole('button', { name: 'Recognize Text (OCR)' });
  await expect(button).toBeDisabled();
});

test(
  'OCR offline: the core and the English data from the cache, zero outbound requests',
  { tag: '@offline' },
  async ({ page, context, pdfs }) => {
    test.setTimeout(180_000);
    await page.goto('/?sw');
    await expect(
      page.getByRole('contentinfo', { name: 'Status bar' }).getByText('✓ Ready offline'),
    ).toBeVisible({ timeout: 90_000 });
    await context.setOffline(true);
    await page.reload();
    await drop(page, [{ name: 'scan.pdf', b64: b64(await pdfs.scanned()) }]);
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
    const dialog = await openDialog(page);
    await dialog.getByRole('radio', { name: /^Current page/ }).check();
    await dialog.getByRole('button', { name: 'Recognize' }).click();
    await waitDone(page);
    expect(await last(page)).toMatchObject({ recognized: 1, skipped: 0 });
    expect(await find(page, SCANNED_NEEDLE)).toMatch(/1 of 1/);
    await context.setOffline(false);
  },
);

test('English + French: the French data is fetched on first use; re-recognizing replaces the layer instead of doubling it', async ({
  page,
  pdfs,
}) => {
  test.setTimeout(180_000);
  await open(page, await pdfs.scanned());
  const fetched: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/ocr/')) fetched.push(new URL(r.url()).pathname);
  });
  let dialog = await openDialog(page);
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('1');
  await dialog.getByRole('checkbox', { name: 'French' }).check();
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  await expect(dialog).toBeHidden();
  await waitDone(page);
  expect(await last(page)).toMatchObject({ recognized: 1, skipped: 0, replaced: 0 });
  expect(fetched).toContain('/ocr/fra.traineddata.gz');
  expect(fetched).toContain('/ocr/eng.traineddata.gz');
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/1 of 1/);

  // Again on the same page with the option on: still one hit (the earlier layer was replaced).
  dialog = await openDialog(page);
  await expect(dialog.getByRole('checkbox', { name: 'French' })).toBeChecked(); // remembered
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('1');
  await dialog.getByRole('checkbox', { name: /Also recognize pages/ }).check();
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  await waitDone(page);
  expect(await last(page)).toMatchObject({ recognized: 1, skipped: 0, replaced: 1 });
  expect(await find(page, SCANNED_NEEDLE)).toMatch(/1 of 1/);
  // Without the option the page is skipped now.
  dialog = await openDialog(page);
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('1');
  await dialog.getByRole('checkbox', { name: /Also recognize pages/ }).uncheck();
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  await waitDone(page);
  expect(await last(page)).toMatchObject({ recognized: 0, skipped: 1 });
});
