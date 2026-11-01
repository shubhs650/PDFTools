import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { encryptedVariants, hasQpdf } from './fixtures/encrypted.ts';
import { FORM_DEFAULTS, ROW_ORDER, fullFormPdf, xfaPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-14 (D-26, §7.10): fill the five AcroForm field types, in tab order, from
// the keyboard; Ctrl+S saves them narrow; they reopen; Reset Form; XFA banner;
// no filling when the document forbids it (rule 9).

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const field = (page: Page, name: string) => page.locator(`[data-field="${name}"]`);

async function openHandle(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name, b64: Buffer.from(bytes).toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await field(page, 'first').waitFor();
}

function qpdfCheck(bytes: Buffer): number | null | 'absent' {
  if (!hasQpdf()) return 'absent';
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-forms-')), 'saved.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

/** Waits for a Ctrl+S to finish; a tiny file can trip the > 30 % growth prompt: keep it incremental. */
async function saved(page: Page, name: string): Promise<void> {
  const prompt = page.getByRole('dialog', { name: 'Save optimized instead?' });
  await expect(prompt.or(page.getByRole('tab', { name, exact: true }))).toBeVisible();
  if (await prompt.isVisible()) {
    await prompt.getByRole('button', { name: 'Just save' }).click();
    await expect(tabs(page).first()).toHaveAccessibleName(name);
  }
  await expect(page.getByRole('status').filter({ hasText: /Saving|Checking|Writing/ })).toHaveCount(
    0,
  );
}

test('keyboard-only: fields in /Tabs /R order, named by /TU, flags honoured; Ctrl+S saves and they reopen', async ({
  page,
}) => {
  const original = fullFormPdf();
  await page.goto('/');
  await openHandle(page, 'form.pdf', original);

  // Tab order: /Annots is deliberately out of row order in the fixture.
  await field(page, 'first').focus();
  const order: string[] = [];
  for (let i = 0; i < ROW_ORDER.length + 1; i++) {
    order.push(await page.evaluate(() => document.activeElement?.getAttribute('data-field') ?? ''));
    await page.keyboard.press('Tab');
  }
  // Two radio buttons for "choice".
  expect(order).toEqual([
    'first',
    'name',
    'readonly',
    'required',
    'agree',
    'choice',
    'choice',
    'size',
    'material',
  ]);

  await expect(page.getByRole('textbox', { name: 'first field' })).toHaveValue('Top');
  await expect(page.getByRole('textbox', { name: 'required field' })).toHaveAttribute(
    'aria-required',
    'true',
  );
  const readonly = page.getByRole('textbox', { name: 'readonly field' });
  await expect(readonly).toHaveAttribute('readonly', '');
  await readonly.focus();
  await page.keyboard.type('xyz');
  await expect(readonly).toHaveValue('Fixed');

  // Fill each type from the keyboard.
  const first = page.getByRole('textbox', { name: 'first field' });
  await first.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Filled in');
  await page.keyboard.press('Tab'); // commits on blur
  await page.getByRole('checkbox', { name: 'Agree' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'Agree' })).toBeChecked();
  await page.getByRole('radio', { name: 'Choice' }).nth(1).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: 'Choice' }).nth(1)).toBeChecked();
  await page.getByRole('combobox', { name: 'Size' }).selectOption('DN100');
  await page.getByRole('listbox', { name: 'Material' }).selectOption('Duplex');
  await expect(tabs(page).first()).toHaveAccessibleName(/unsaved/);
  const { violations } = await new AxeBuilder({ page }).include('.form-layer').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.keyboard.press('Control+S');
  await saved(page, 'form.pdf');
  const bytes = Buffer.from((await cap(page, 'open', 'readFile', 'form.pdf')) as string, 'base64');
  expect(bytes.subarray(0, original.length).equals(Buffer.from(original))).toBe(true);
  expect(bytes.length).toBeGreaterThan(original.length);
  expect([0, 3, 'absent']).toContain(qpdfCheck(bytes));
  // For the owner's interop run (e2e/interop/CHECKLIST.md §M2): M2_INTEROP_OUT=1 npm run owner:interop:m2
  if (process.env.M2_INTEROP_OUT === '1') {
    mkdirSync('e2e/fixtures/self-made/m2-interop', { recursive: true });
    writeFileSync('e2e/fixtures/self-made/m2-interop/form__filled.pdf', bytes);
    writeFileSync('e2e/fixtures/self-made/m2-interop/form__original.pdf', original);
  }

  // Reopen the saved bytes in a fresh page.
  await page.goto('/');
  await openHandle(page, 'reopened.pdf', bytes);
  await expect(page.getByRole('textbox', { name: 'first field' })).toHaveValue('Filled in');
  await expect(page.getByRole('checkbox', { name: 'Agree' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Choice' }).nth(1)).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Choice' }).nth(0)).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Size' })).toHaveValue('2'); // DN100
  await expect(page.getByRole('listbox', { name: 'Material' })).toHaveValue('2'); // Duplex
  await expect(page.getByRole('textbox', { name: 'readonly field' })).toHaveValue('Fixed');
});

test('Reset Form asks first, then restores /DV defaults and leaves read-only fields', async ({
  page,
}) => {
  await page.goto('/');
  await openHandle(page, 'reset.pdf', fullFormPdf());
  const name = page.getByRole('textbox', { name: 'name field' });
  await name.fill('Changed');
  await name.press('Enter');
  await expect(tabs(page).first()).toHaveAccessibleName(/unsaved/);

  await page.getByRole('tab', { name: 'Home' }).click();
  const reset = page
    .getByRole('toolbar', { name: 'Home commands' })
    .getByRole('button', { name: 'Reset Form' });
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Reset Form' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(name).toHaveValue('Changed');

  await reset.click();
  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(name).toHaveValue(FORM_DEFAULTS.name);
  await expect(page.getByRole('textbox', { name: 'first field' })).toHaveValue(FORM_DEFAULTS.first);
  await expect(page.getByRole('textbox', { name: 'readonly field' })).toHaveValue(
    FORM_DEFAULTS.readonly,
  );
  await expect(page.getByRole('checkbox', { name: 'Agree' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Choice' }).nth(1)).toBeChecked(); // B
  await expect(page.getByRole('combobox', { name: 'Size' })).toHaveValue('0'); // DN50
  await expect(page.getByRole('listbox', { name: 'Material' })).toHaveValue('-1'); // none
});

test('XFA: a full XFA form shows the banner and no fields; a hybrid still fills its AcroForm', async ({
  page,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'xfa.pdf', b64: Buffer.from(xfaPdf(true)).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await expect(page.getByTestId('xfa-banner')).toHaveText('XFA forms are not supported.');
  await page.waitForTimeout(500); // past the form layer's settle delay
  await expect(page.locator('[data-form-control]')).toHaveCount(0);

  await page.goto('/');
  await drop(page, [{ name: 'hybrid.pdf', b64: Buffer.from(xfaPdf(false)).toString('base64') }]);
  await expect(page.getByTestId('xfa-banner')).toContainText('XFA forms are not supported.');
  const fallback = page.getByRole('textbox', { name: 'Fallback' });
  await expect(fallback).toHaveValue('Hybrid');
  await fallback.fill('Filled');
  await fallback.press('Enter');
  await expect(tabs(page).first()).toHaveAccessibleName(/unsaved/);
});

test('a document that forbids form filling shows fields read-only with the reason (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
  const locked = encryptedVariants(fullFormPdf()).find((x) => x.name === 'R6-owner-only');
  if (!locked) throw new Error('fixture');
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: Buffer.from(locked.bytes).toString('base64') }]);
  const first = page.getByRole('textbox', { name: 'first field' });
  await expect(first).toHaveAttribute('readonly', '');
  await expect(first).toHaveAttribute('title', /don't allow filling forms/);
  await first.focus();
  await page.keyboard.type('x');
  await expect(first).toHaveValue('Top');
  await page.getByRole('checkbox', { name: 'Agree' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'Agree' })).not.toBeChecked();
  await expect(tabs(page).first()).not.toHaveAccessibleName(/unsaved/);

  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(
    page
      .getByRole('toolbar', { name: 'Home commands' })
      .getByRole('button', { name: 'Reset Form' }),
  ).toHaveAttribute('aria-disabled', 'true');
});

test('Ctrl+S from inside a text field saves the value being typed (no Enter, no blur)', async ({
  page,
}) => {
  const original = fullFormPdf();
  await page.goto('/');
  await openHandle(page, 'typed.pdf', original);
  const name = page.getByRole('textbox', { name: 'name field' });
  await name.fill('Typed then saved');
  await expect(name).toBeFocused();
  await page.keyboard.press('Control+S');
  await saved(page, 'typed.pdf');
  await expect(name).toBeFocused();
  const bytes = Buffer.from((await cap(page, 'open', 'readFile', 'typed.pdf')) as string, 'base64');
  expect(bytes.length).toBeGreaterThan(original.length);
  expect(bytes.subarray(original.length).toString('latin1')).toContain('(Typed then saved)');
  expect(qpdfCheck(bytes)).not.toBe(2);
});
