import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, encryptedVariants, hasQpdf } from './fixtures/encrypted.ts';
import { PROPERTIES, propertiesPdf } from './fixtures/generate.ts';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-12: File → Properties and Protect → Security Info.

/** The "Printing" permission row (not "High-quality printing"). */
const printRow = (dialog: ReturnType<Page['locator']>) =>
  dialog.getByRole('row', { name: /^Printing (Allowed|Not allowed)$/ });

const fact = (scope: ReturnType<Page['locator']>, name: string) =>
  scope
    .locator('.fact')
    .filter({ has: scope.page().getByText(name, { exact: true }) })
    .locator('dd');

async function openProperties(page: Page) {
  await page.getByTestId('file-tab').click();
  const backstage = page.getByRole('dialog', { name: 'File' });
  await backstage.getByRole('button', { name: 'Properties' }).click();
  return backstage.getByTestId('properties');
}

test('Properties lists the known Info values and file facts; keyboard and axe', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'datasheet.pdf', b64: pdfs.properties().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const props = await openProperties(page);
  await expect(fact(props, 'Title')).toHaveText(PROPERTIES.title);
  await expect(fact(props, 'Author')).toHaveText(PROPERTIES.author);
  await expect(fact(props, 'Keywords')).toHaveText(PROPERTIES.keywords);
  await expect(fact(props, 'Created')).toContainText('2024');
  await expect(fact(props, 'PDF version')).toHaveText('1.7');
  await expect(fact(props, 'Pages')).toHaveText('2');
  await expect(fact(props, 'Page size (page 1)')).toHaveText('210 × 297 mm (8.26 × 11.69 in)');
  await expect(fact(props, 'Tagged (accessible structure)')).toHaveText('Yes');
  await expect(fact(props, 'Revisions')).toHaveText('1');
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="backstage"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('Security Info of an unencrypted file', async ({ page, pdfs }) => {
  await page.goto('/');
  await drop(page, [{ name: 'plain.pdf', b64: pdfs.properties().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  await page.getByRole('tab', { name: 'Protect' }).click();
  await page.getByRole('button', { name: 'Security Info' }).click();
  const dialog = page.getByRole('dialog', { name: 'Security info' });
  await expect(fact(dialog, 'Encryption')).toHaveText('None');
  await expect(printRow(dialog)).toContainText('Allowed');
});

for (const variant of ['R6-aes-256', 'R3-rc4-128'] as const) {
  test(`Security Info of ${variant}: before and after the owner unlock`, async ({ page }) => {
    test.skip(!hasQpdf(), 'qpdf makes the encrypted fixtures');
    const v = encryptedVariants(propertiesPdf()).find((x) => x.name === variant);
    if (!v) throw new Error('fixture');
    await page.goto('/');
    await drop(page, [{ name: 'locked.pdf', b64: Buffer.from(v.bytes).toString('base64') }]);
    const pw = page.getByRole('dialog', { name: 'Password required' });
    await pw.getByLabel('Password').fill(USER_PW);
    await pw.getByRole('button', { name: 'Open' }).click();
    await page.locator('[data-page="0"] img.page-preview').waitFor();

    await page.getByRole('tab', { name: 'Protect' }).click();
    await page.getByRole('button', { name: 'Security Info' }).click();
    const dialog = page.getByRole('dialog', { name: 'Security info' });
    await expect(fact(dialog, 'Encryption')).toHaveText(
      variant === 'R6-aes-256'
        ? 'AES-256, 256-bit key (security handler revision 6)'
        : 'RC4, 128-bit key (security handler revision 3)',
    );
    await expect(fact(dialog, 'Owner password')).toHaveText('Set: it restricts what can be done');
    await expect(printRow(dialog)).toContainText('Not allowed');
    const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(violations.map((x) => x.id)).toEqual([]);
    await dialog.getByRole('button', { name: 'Close' }).first().click();

    await page.getByRole('button', { name: 'Unlock with Owner Password' }).click();
    const unlock = page.getByRole('dialog', { name: 'Unlock with owner password' });
    await unlock.getByLabel('Owner password').fill(OWNER_PW);
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await expect(unlock).toBeHidden();

    await page.getByRole('button', { name: 'Security Info' }).click();
    await expect(fact(dialog, 'Owner password')).toHaveText(
      'Given for this session: no restrictions',
    );
    await expect(printRow(dialog)).toContainText('Allowed');
  });
}
