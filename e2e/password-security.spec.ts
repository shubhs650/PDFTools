import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { annotatedPdf, simplePdf } from './fixtures/generate.ts';
import { makeSigner, signedPdf } from './fixtures/signed.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M6-12 (D-40 a, §7.12, ADR-022 decision 2): Protect → Password Security… and
// Remove Security. The new file is made on a copy, checked in the Work worker
// and only then written; it opens with the passwords set and refuses without
// (PDFium in the app, qpdf here); reopened with the open password, the
// restricted commands are disabled (D-19); both commands need owner rights
// (rule 9). Self-made files only (rule 13).

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Protect commands' });
const pwDialog = (page: Page) => page.getByRole('dialog', { name: 'Password Security' });
const rmDialog = (page: Page) => page.getByRole('dialog', { name: 'Remove Security' });
const banner = (page: Page) => page.getByRole('region', { name: 'Document restrictions' });
const OPEN_PW = 'Open-pässword 1';
const PERM_PW = 'Perm-Pw 2';
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-e2e-security-'));
let seq = 0;

/** qpdf's verdict on a file: opens (0 / 3: warnings) with this password, or not. */
function qpdfOpens(bytes: Buffer, password?: string): boolean {
  const file = join(tmp, `out${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  const pw = password === undefined ? [] : [`--password=${password}`];
  return [0, 3].includes(spawnSync('qpdf', [...pw, '--check', file]).status ?? -1);
}

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

async function axeClean(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

const output = async (page: Page): Promise<Buffer> =>
  Buffer.from((await cap(page, 'security', 'lastOutput')) as string, 'base64');

test('set an open and a permissions password; reopen restricted; unlock and remove security @smoke', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf checks the output');
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  const first = await open(page, annotatedPdf(), 'plan.pdf');
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Protect' }).click();
  await expect(
    bar(page).getByRole('button', { name: 'Remove Security' }),
  ).toHaveAccessibleDescription('This document has no passwords or restrictions to remove');
  await bar(page).getByRole('button', { name: 'Password Security…' }).click();
  const d = pwDialog(page);
  await expect(d).toContainText('AES-256');
  await expect(d).toContainText('A new file is created (plan-protected.pdf).');
  const openField = d.getByLabel('Open password', { exact: true });
  await expect(openField).toHaveAttribute('type', 'password');
  await expect(openField).toHaveAttribute('autocomplete', 'new-password');
  await axeClean(page);

  // Validation: empty, then a confirmation that doesn't match.
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  await expect(d.getByRole('alert')).toHaveText('Enter a password.');
  await openField.fill(OPEN_PW);
  await d.getByLabel('Confirm open password').fill('typo');
  await expect(d.getByRole('alert')).toHaveText("The passwords don't match.");
  await d.getByLabel('Confirm open password').fill(OPEN_PW);
  await expect(d.getByRole('alert')).toHaveCount(0);

  // Permissions: comments imply form filling; high-quality printing needs printing.
  await d.getByLabel('Restrict printing, changes and copying with a permissions password').check();
  await d.getByLabel('Permissions password', { exact: true }).fill(PERM_PW);
  await d.getByLabel('Confirm permissions password').fill(PERM_PW);
  const forms = d.getByLabel('Filling in forms');
  await expect(forms).toBeChecked();
  await expect(forms).toBeDisabled();
  await d.getByLabel('Comments').uncheck();
  await expect(forms).toBeEnabled();
  await forms.uncheck();
  await d.getByLabel('Printing', { exact: true }).uncheck();
  await expect(d.getByLabel('High-quality printing')).not.toBeChecked();
  await expect(d.getByLabel('High-quality printing')).toBeDisabled();
  await axeClean(page);
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  const result = d.getByTestId('security-result');
  await expect(result).toContainText('Saved plan-protected.pdf. Every check passed.', {
    timeout: 30_000,
  });
  await expect(result).toContainText('It opens only with the open password.');
  expect((await savedFiles(page)).map((f) => f.name)).toEqual(['plan-protected.pdf']);

  // qpdf agrees: refused without a password, opened with either.
  const out = await output(page);
  expect(qpdfOpens(out)).toBe(false);
  expect(qpdfOpens(out, OPEN_PW)).toBe(true);
  expect(qpdfOpens(out, PERM_PW)).toBe(true);
  // Reopened with the open password: restricted (D-19), both commands need the owner.
  await d.getByRole('button', { name: 'Open Protected File' }).click();
  const prompt = page.getByRole('dialog', { name: 'Password required' });
  await prompt.getByLabel('Password').fill(OPEN_PW);
  await prompt.getByLabel('Password').press('Enter');
  await expect(page.getByRole('tab', { name: /plan-protected\.pdf/ })).toBeVisible();
  await expect(banner(page)).toContainText('printing');
  await expect(banner(page)).toContainText('comments');
  await expect(banner(page)).toContainText('filling in forms');
  const second = (await cap(page, 'view', 'activeDocId')) as string;
  expect(second).not.toBe(first);
  expect(await cap(page, 'save', 'addSquares', second, 1)).toBe('pdfium:5');
  for (const name of ['Password Security…', 'Remove Security'])
    await expect(bar(page).getByRole('button', { name })).toHaveAccessibleDescription(
      'Needs the owner password: use Unlock with Owner Password first',
    );

  // Unlock with the permissions password, then Remove Security.
  await banner(page).getByRole('button', { name: 'Unlock…' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock with owner password' });
  await unlock.getByLabel('Owner password').fill(PERM_PW);
  await unlock.getByLabel('Owner password').press('Enter');
  await expect(banner(page)).toBeHidden();
  await bar(page).getByRole('button', { name: 'Remove Security' }).click();
  const r = rmDialog(page);
  await expect(r).toContainText('A new file without passwords or restrictions is created');
  await axeClean(page);
  await r.getByRole('button', { name: 'Remove and Save As…' }).click();
  await expect(r.getByTestId('security-result')).toContainText(
    'It opens without a password and has no restrictions.',
    { timeout: 30_000 },
  );
  expect((await savedFiles(page)).map((f) => f.name)).toEqual([
    'plan-protected.pdf',
    'plan-protected-unprotected.pdf',
  ]);
  expect(qpdfOpens(await output(page))).toBe(true);
  await r.getByRole('button', { name: 'Open Unprotected File' }).click();
  await expect(page.getByRole('tab', { name: /plan-protected-unprotected\.pdf/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Password required' })).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
});

test('a file opened with its owner password can get new passwords; Esc closes the dialog', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf makes the fixture');
  await page.goto('/');
  const locked = qpdfEncrypt(simplePdf(2), USER_PW, OWNER_PW, ['256', '--print=none']);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  const prompt = page.getByRole('dialog', { name: 'Password required' });
  await prompt.getByLabel('Password').fill(OWNER_PW);
  await prompt.getByLabel('Password').press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Protect' }).click();
  await bar(page).getByRole('button', { name: 'Password Security…' }).click();
  const d = pwDialog(page);
  await expect(d).toContainText(
    "The new file's passwords and restrictions replace the current ones.",
  );
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await bar(page).getByRole('button', { name: 'Password Security…' }).click();
  await d.getByLabel('Open password', { exact: true }).fill('new-open');
  await d.getByLabel('Confirm open password').fill('new-open');
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  await expect(d.getByTestId('security-result')).toContainText('Every check passed.', {
    timeout: 30_000,
  });
  const out = await output(page);
  expect(qpdfOpens(out, USER_PW)).toBe(false);
  expect(qpdfOpens(out, OWNER_PW)).toBe(false);
  expect(qpdfOpens(out, 'new-open')).toBe(true);
});

test('a signed document warns that its signatures will not be valid', async ({ page }) => {
  await page.goto('/');
  const signer = await makeSigner('Sam Signer');
  await open(page, await signedPdf(signer), 'signed.pdf');
  await page.getByRole('tab', { name: 'Protect' }).click();
  await bar(page).getByRole('button', { name: 'Password Security…' }).click();
  await expect(pwDialog(page).getByRole('alert')).toHaveText(
    'This document has 1 digital signature. It will not be valid in the new file.',
  );
});
