import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { drop } from './support/app.ts';
import {
  compareSide,
  corpusFile,
  dropOn,
  overlayDrawn,
  overlayOf,
  textOf,
} from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { corpusBytes, corpusPair } from './fixtures/comparison-corpus/index.ts';
import { certifiedPdf, makeSigner, signedPdf } from './fixtures/signed.ts';

// M12-20 (D-65, ADR-032): the comparison file. Compare → Save Comparison…
// writes one PDF holding both documents and the comparison (the dialog says
// so); dropped back in, it becomes the live comparison again, and Export
// Document A / B give the files back byte for byte. A password-protected
// input makes a password-protected file; a signed or certified Document B
// comes back unchanged.

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Save Comparison' });
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** Where the screenshots for the owner go (SHOTS=1 only). */
const SHOTS = process.env.SHOTS ? (process.env.SHOTS_DIR ?? 'test-results/m12-20-shots') : null;
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

let kept = 0;

/** No save picker: every file is a download the test reads back. */
async function downloads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
}

async function compareRibbon(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
}

/** Save Comparison… → Save…: the file's name and bytes. */
async function saveComparison(
  page: Page,
  password?: string,
  shotName?: string,
): Promise<{ name: string; bytes: Buffer }> {
  await compareRibbon(page);
  await page.getByRole('button', { name: 'Save Comparison…' }).click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d).toContainText('contains both documents');
  if (password !== undefined) {
    await d.getByLabel('Open password', { exact: true }).fill(password);
    await d.getByLabel('Confirm the password').fill(password);
  }
  if (shotName) await shot(page, shotName);
  const download = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Save…' }).click();
  const file = await download;
  await expect(d).toHaveCount(0, { timeout: 60_000 });
  const out = { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
  // The owner's interop pack (SHOTS=1): every comparison file the tests write.
  if (SHOTS) {
    mkdirSync(`${SHOTS}/files`, { recursive: true });
    writeFileSync(`${SHOTS}/files/${String(++kept)} ${out.name}`, out.bytes);
  }
  return out;
}

async function exportSide(page: Page, side: 'A' | 'B', count = 1): Promise<Buffer[]> {
  await compareRibbon(page);
  const out: Buffer[] = [];
  const files: Promise<Buffer>[] = [];
  const all = new Promise<void>((resolve) => {
    page.on('download', (d) => {
      files.push(d.path().then((p) => readFileSync(p)));
      if (files.length === count) resolve();
    });
  });
  await page.getByRole('button', { name: `Export Document ${side}…` }).click();
  await all;
  for (const f of files) out.push(await f);
  page.removeAllListeners('download');
  return out;
}

// Building and reopening comparison files takes a while in a debug build.
test.describe.configure({ timeout: 180_000 });

const resultShown = (page: Page) =>
  expect(page.getByTestId('compare-result')).toBeVisible({ timeout: 60_000 });

test('a PDF overlay saved as a comparison file reopens as the comparison; Export Document A / B give the files back @smoke', async ({
  page,
}) => {
  await downloads(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '01');
  await compareRibbon(page);
  // Export Document A / B are for a comparison reopened from its file.
  await expect(page.getByRole('button', { name: 'Export Document A…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save Comparison…' }).click();
  await expect(dialog(page)).toContainText(
    'This file contains both documents, Pair 01 RevA.pdf and Pair 01 RevB.pdf',
  );
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Close' }).last().click();
  const saved = await saveComparison(page, undefined, '1-save-comparison-overlay');
  expect(saved.name).toBe('Pair 01 RevA vs Pair 01 RevB (comparison).pdf');
  const text = saved.bytes.toString('latin1');
  expect(text).toContain('/TriyaComparison');
  expect(text).toContain('/EmbeddedFiles');
  expect(text).toContain('TriyaCompare-data');
  expect(text).not.toContain('/Encrypt');

  // Dropped in again: the comparison, not a document tab.
  await page.goto('/');
  await drop(page, [{ name: saved.name, b64: b64(saved.bytes) }]);
  await resultShown(page);
  await overlayDrawn(page);
  await expect(page.getByRole('tab', { name: /\(comparison\)\.pdf/ })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Pair 01 RevA.*Pair 01 RevB/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shot(page, '2-reopened-overlay');
  const [a] = await exportSide(page, 'A');
  expect(a?.equals(Buffer.from(corpusBytes(corpusPair('overlay', '01'), 'old')))).toBe(true);
  const [b] = await exportSide(page, 'B');
  expect(b?.equals(Buffer.from(corpusBytes(corpusPair('overlay', '01'), 'new')))).toBe(true);
});

test('a text comparison file is Document B with its changes marked; it reopens as the comparison', async ({
  page,
}) => {
  await downloads(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '05');
  const saved = await saveComparison(page, undefined, '3-save-comparison-text');
  const bNew = Buffer.from(corpusBytes(corpusPair('text', '05'), 'new'));
  // B's own bytes come first, then one section of ours.
  expect(saved.bytes.subarray(0, bNew.length).equals(bNew)).toBe(true);
  const tail = saved.bytes.subarray(bNew.length).toString('latin1');
  expect(tail).toContain('/Highlight');
  expect(tail).toContain('/Caret');
  expect(tail).toContain('triya-cmp-');

  await page.goto('/');
  await drop(page, [{ name: saved.name, b64: b64(saved.bytes) }]);
  await resultShown(page);
  await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('text-view-b').locator('.page').first()).toBeVisible();
  await shot(page, '4-reopened-text');
  const [b] = await exportSide(page, 'B');
  expect(b?.equals(bNew)).toBe(true);
  const [a] = await exportSide(page, 'A');
  expect(a?.equals(Buffer.from(corpusBytes(corpusPair('text', '05'), 'old')))).toBe(true);
});

test('pair 12: a password-protected input makes a password-protected comparison file', async ({
  page,
}) => {
  await downloads(page);
  await page.goto('/');
  await compareRibbon(page);
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(compareSide(page, 'a'), [corpusFile('12', 'old', 'Pair 12 RevA.pdf')]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1);
  await dropOn(compareSide(page, 'b'), [corpusFile('12', 'new', 'Pair 12 RevB.pdf')]);
  const ask = page.getByRole('dialog', { name: 'Password required' });
  await ask.getByLabel('Password').fill('test1234');
  await ask.getByRole('button', { name: 'Open' }).click();
  await expect(compareSide(page, 'b').getByTestId('compare-file')).toHaveCount(1);
  // Copying content is restricted (rule 9): the owner password lifts it.
  for (const s of ['a', 'b'] as const) {
    const unlockButton = compareSide(page, s).getByRole('button', { name: /^Unlock / });
    if ((await unlockButton.count()) === 0) continue;
    await unlockButton.click();
    const unlock = page.getByRole('dialog', { name: 'Unlock with owner password' });
    await unlock.getByLabel('Owner password').fill('overlay_owner_2026');
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(unlock).toBeHidden();
  }
  await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 30_000,
  });
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await overlayDrawn(page);

  // The dialog asks for an open password, and both must match.
  await compareRibbon(page);
  await page.getByRole('button', { name: 'Save Comparison…' }).click();
  const d = dialog(page);
  await expect(d).toContainText('Pair 12 RevB.pdf needs a password to open');
  await d.getByLabel('Open password', { exact: true }).fill('cmp-secret');
  await d.getByLabel('Confirm the password').fill('other');
  await d.getByRole('button', { name: 'Save…' }).click();
  await expect(d.getByRole('alert')).toContainText('The passwords don’t match.');
  await shot(page, '5-save-comparison-password');
  await d.getByRole('button', { name: 'Close' }).last().click();
  const saved = await saveComparison(page, 'cmp-secret');
  expect(saved.bytes.toString('latin1')).toContain('/Encrypt');

  // Reopened: the file's password, then B's own (A has none).
  await page.goto('/');
  await drop(page, [{ name: saved.name, b64: b64(saved.bytes) }]);
  await expect(ask).toContainText('Pair 12 RevA vs Pair 12 RevB (comparison).pdf');
  await ask.getByLabel('Password').fill('cmp-secret');
  await ask.getByRole('button', { name: 'Open' }).click();
  // A opens without one; B's own password is not the file's, so it is asked for.
  await expect(ask).toContainText('“Pair 12 RevB.pdf” is protected', { timeout: 30_000 });
  await expect(ask.getByRole('alert')).toHaveCount(0);
  await ask.getByLabel('Password').fill('test1234');
  await ask.getByRole('button', { name: 'Open' }).click();
  await resultShown(page);
  await overlayDrawn(page);
  const [b] = await exportSide(page, 'B');
  expect(b?.equals(Buffer.from(corpusBytes(corpusPair('overlay', '12'), 'new')))).toBe(true);
});

test('a signed Document B is kept as it was; a certified one that forbids comments too', async ({
  page,
}) => {
  await downloads(page);
  const signer = await makeSigner('Comparison E2E Signer');
  const a = await certifiedPdf(signer, 3, 'Certified old page');
  for (const b of [await signedPdf(signer), await certifiedPdf(signer, 1, 'Certified new page')]) {
    await page.goto('/');
    await compareRibbon(page);
    await page.getByRole('button', { name: 'Text Comparison' }).click();
    await dropOn(compareSide(page, 'a'), [{ name: 'Old.pdf', b64: b64(a) }]);
    await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(1);
    await dropOn(compareSide(page, 'b'), [{ name: 'New.pdf', b64: b64(b) }]);
    await expect(compareSide(page, 'b').getByTestId('compare-file')).toHaveCount(1);
    await page
      .getByTestId('compare-input')
      .getByRole('button', { name: 'Compare', exact: true })
      .click();
    await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
      timeout: 60_000,
    });
    const saved = await saveComparison(page);
    const signedOnly = !Buffer.from(b).toString('latin1').includes('/DocMDP');
    // A signed B is the file's own start (its signature still covers it);
    // a certified B that forbids comments is attached, under an unsigned copy.
    expect(saved.bytes.subarray(0, b.length).equals(Buffer.from(b))).toBe(signedOnly);
    await page.goto('/');
    await drop(page, [{ name: saved.name, b64: b64(saved.bytes) }]);
    await resultShown(page);
    const [back] = await exportSide(page, 'B');
    expect(back?.equals(Buffer.from(b))).toBe(true);
  }
});

test('a set of several files on each side comes back as the same set', async ({ page }) => {
  await downloads(page);
  await page.goto('/');
  await compareRibbon(page);
  await page.getByRole('button', { name: 'PDF Overlay' }).click();
  await dropOn(compareSide(page, 'a'), [
    corpusFile('01', 'old', 'Set A1.pdf'),
    corpusFile('07', 'old', 'Set A2.pdf'),
  ]);
  await expect(compareSide(page, 'a').getByTestId('compare-file')).toHaveCount(2);
  await dropOn(compareSide(page, 'b'), [
    corpusFile('01', 'new', 'Set B1.pdf'),
    corpusFile('07', 'new', 'Set B2.pdf'),
  ]);
  await expect(compareSide(page, 'b').getByTestId('compare-file')).toHaveCount(2);
  await expect(page.getByTestId('compare-pairing')).toHaveAttribute('data-status', 'done', {
    timeout: 30_000,
  });
  await page
    .getByTestId('compare-input')
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await overlayDrawn(page);
  const saved = await saveComparison(page);
  expect(saved.bytes.toString('latin1')).toContain('TriyaCompare-A2');

  await page.goto('/');
  await drop(page, [{ name: saved.name, b64: b64(saved.bytes) }]);
  await resultShown(page);
  await expect(page.getByRole('tab', { name: /Set A1.*Set B1/ })).toBeVisible();
  const files = await exportSide(page, 'A', 2);
  const want = [
    Buffer.from(corpusBytes(corpusPair('overlay', '01'), 'old')),
    Buffer.from(corpusBytes(corpusPair('overlay', '07'), 'old')),
  ];
  expect(files.map((f) => want.findIndex((w) => w.equals(f))).sort()).toEqual([0, 1]);
});

/** Every deflated stream of a file, inflated, as Latin-1 text. */
function streamsText(bytes: Buffer): string {
  const text = bytes.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try {
      out.push(inflateSync(bytes.subarray(start, end)).toString('latin1'));
    } catch {
      // not deflated
    }
  }
  return out.join('\n');
}

test('M12-21: the summary page comes first in an overlay comparison file, as chosen', async ({
  page,
}) => {
  await downloads(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '01');
  await compareRibbon(page);
  await page.getByRole('button', { name: 'Save Comparison…' }).click();
  const box = dialog(page).getByRole('checkbox', { name: 'Add a summary page' });
  await expect(box).toBeChecked();
  await shot(page, '5-save-comparison-summary');
  await dialog(page).getByRole('button', { name: 'Close' }).last().click();
  const withPage = await saveComparison(page);
  const data = streamsText(withPage.bytes);
  expect(data).toContain('"leadingPages":1');
  // Its words in a font shipped with the app, embedded (no system font).
  const utf16 = (t: string): string =>
    Array.from({ length: t.length }, (_, i) =>
      t.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase(),
    ).join('');
  expect(data).toContain(`/ActualText <FEFF${utf16('Comparison summary')}>`);
  expect(withPage.bytes.toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-/);

  // Unticked: no summary page (and the choice is kept for the next file).
  await compareRibbon(page);
  await page.getByRole('button', { name: 'Save Comparison…' }).click();
  await dialog(page).getByRole('checkbox', { name: 'Add a summary page' }).uncheck();
  await dialog(page).getByRole('button', { name: 'Close' }).last().click();
  const without = await saveComparison(page);
  expect(streamsText(without.bytes)).not.toContain('leadingPages":1');
  await compareRibbon(page);
  await page.getByRole('button', { name: 'Save Comparison…' }).click();
  await expect(
    dialog(page).getByRole('checkbox', { name: 'Add a summary page' }),
  ).not.toBeChecked();
  await dialog(page).getByRole('button', { name: 'Close' }).last().click();

  // Reopened, the summary page is not a sheet: the comparison has its one sheet.
  await page.goto('/');
  await drop(page, [{ name: withPage.name, b64: b64(withPage.bytes) }]);
  await resultShown(page);
  await overlayDrawn(page);
  await expect(page.getByRole('tab', { name: /Pair 01 RevA.*Pair 01 RevB/ })).toBeVisible();
});

test('M12-21: a text comparison file has no summary option (it is Document B itself)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '05');
  await compareRibbon(page);
  await page.getByRole('button', { name: 'Save Comparison…' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('checkbox', { name: 'Add a summary page' })).toHaveCount(0);
});
