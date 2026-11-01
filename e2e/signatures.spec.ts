import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  makeSigner,
  savedAfterSigning,
  signedPdf,
  tampered,
  twiceSignedPdf,
} from './fixtures/signed.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-13: the Signatures pane, offline (D-24). The guard fixture fails the test
// on any request leaving the app's origin, so "no OCSP/CRL/AIA fetch" is
// checked by every test here.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const list = (page: Page) => page.getByRole('list', { name: 'Signatures' });
const items = (page: Page) => list(page).getByRole('listitem');
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function openSigned(page: Page, name: string, bytes: Uint8Array) {
  await page.goto('/');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const banner = page.getByRole('region', { name: 'Digital signatures' });
  await banner.getByRole('button', { name: 'Show Signatures' }).click();
  await expect(list(page)).toBeVisible({ timeout: 15_000 });
  return banner;
}

test('a valid signature: unchanged since signing, identity not verified offline @smoke', async ({
  page,
}) => {
  const alice = await makeSigner('Alice Tester');
  const banner = await openSigned(page, 'signed.pdf', await signedPdf(alice));
  await expect(banner).toContainText('This document has 1 digital signature.');
  await expect(items(page)).toHaveCount(1);
  const sig = items(page).first();
  await expect(sig).toContainText('Alice Tester');
  await expect(sig).toContainText('Unchanged since signing');
  await expect(sig).toContainText('Not verified (offline)');
  await expect(sig).toContainText('Revision 1 of 1');
  await expect(sig).toContainText('Approved');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('a tampered file says "Modified after signing"', async ({ page }) => {
  const alice = await makeSigner('Alice Tester');
  await openSigned(page, 'tampered.pdf', tampered(await signedPdf(alice)));
  await expect(items(page).first()).toContainText('Modified after signing');
});

test('twice signed: each signature with the revision it covers', async ({ page }) => {
  const two = await twiceSignedPdf(
    await makeSigner('Alice Tester'),
    await makeSigner('Bob Reviewer'),
  );
  await openSigned(page, 'twice.pdf', two);
  await expect(items(page)).toHaveCount(2);
  await expect(items(page).nth(0)).toContainText('Alice Tester');
  await expect(items(page).nth(0)).toContainText('Revision 1 of 2');
  await expect(items(page).nth(0)).toContainText('The document was changed after signing');
  await expect(items(page).nth(1)).toContainText('Bob Reviewer');
  await expect(items(page).nth(1)).toContainText('Revision 2 of 2');
  await expect(items(page)).toContainText(['Unchanged since signing', 'Unchanged since signing']);
});

test('changed after signing (a later revision), and our own Ctrl+S keeps it intact', async ({
  page,
}) => {
  const alice = await makeSigner('Alice Tester');
  const later = savedAfterSigning(await signedPdf(alice));
  await page.goto('/');
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name: 'doc.pdf', b64: b64(later) },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.getByRole('button', { name: 'Show Signatures' }).click();
  await expect(items(page).first()).toContainText('Revision 1 of 2');
  await expect(items(page).first()).toContainText('The document was changed after signing');

  // An edit and an incremental save: the signed revision's bytes stay as they were.
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await page.keyboard.press('Control+S');
  const growth = page.getByRole('dialog', { name: /grow/i });
  if (await growth.isVisible().catch(() => false)) await growth.getByRole('button').first().click();
  await expect(tabs(page).first()).toHaveAccessibleName('doc.pdf', { timeout: 15_000 });
  await expect(items(page).first()).toContainText('Revision 1 of 3', { timeout: 15_000 });
  await expect(items(page).first()).toContainText('Unchanged since signing');
});
