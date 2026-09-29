import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { encryptedVariants, hasQpdf, USER_PW } from './fixtures/encrypted.ts';
import { extractionFixture, IMAGE_PAGE, STRUCTURE } from './fixtures/extraction.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { folderFiles, savedFiles, stubFolderPicker, stubSavePicker } from './support/savePicker.ts';

// M4-05 (§7.6, M4-Q5, M4-Q6): Convert → To Text / To Markdown / To HTML from
// the ribbon, through PDF Oxide in the Work worker: pages, images in reading
// order, Markdown with its images into a new folder, a self-contained HTML
// page; disabled without the copy permission (rule 9); works offline.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function open(page: Page): Promise<void> {
  await drop(page, [{ name: 'spec.pdf', b64: b64(extractionFixture()) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

async function convert(page: Page, label: string, title: string) {
  await page.getByRole('tab', { name: 'Convert' }).click();
  await page
    .getByRole('toolbar', { name: 'Convert commands' })
    .getByRole('button', { name: label })
    .click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

interface Last {
  packaging: string;
  files: { path: string; size: number; text: string | null }[];
}
const last = async (page: Page) => (await cap(page, 'extract', 'lastExport')) as Last;

test('To Markdown with images: a new folder with the .md and its image, in reading order', async ({
  page,
}) => {
  await page.goto('/');
  await open(page);
  await stubFolderPicker(page, ['spec']); // a folder of that name exists: " (2)"
  const dialog = await convert(page, 'To Markdown', 'Export as Markdown');
  await expect(dialog.getByRole('checkbox', { name: /Include images/ })).toBeChecked();
  await expect(dialog).toContainText('The Markdown file and its images go into a new folder.');
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('4-5');
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const written = await folderFiles(page);
  expect(written.map((f) => f.path)).toEqual([
    'spec (2)/spec.md',
    'spec (2)/images/page-5-image-1.png',
  ]);
  const md = (await last(page)).files[0]?.text ?? '';
  expect(md).toMatch(new RegExp(`^#+ ${STRUCTURE.h1}`, 'm'));
  const at = (s: string) => md.indexOf(s);
  expect(at(IMAGE_PAGE.before)).toBeLessThan(at('images/page-5-image-1.png'));
  expect(at('images/page-5-image-1.png')).toBeLessThan(at(IMAGE_PAGE.after));
});

test('To HTML: one self-contained file with the image embedded; To Text: form feeds', async ({
  page,
}) => {
  await page.goto('/');
  await open(page);
  await stubSavePicker(page);
  let dialog = await convert(page, 'To HTML', 'Export as HTML');
  await dialog.getByRole('radio', { name: 'Pages:' }).check();
  await dialog.getByLabel('Page range').fill('5-6');
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  let out = await last(page);
  expect(out.packaging).toBe('single');
  const html = out.files[0]?.text ?? '';
  expect(html).toContain("default-src 'none'");
  expect(html).toContain('<figure><img src="data:image/png;base64,');
  expect(html).not.toMatch(/<script|onerror=/);

  dialog = await convert(page, 'To Text', 'Export as Text');
  await dialog.getByRole('radio', { name: 'Current page' }).check();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  out = await last(page);
  expect(out.files[0]?.text).toContain('Table 1 Pipe wall thickness');
  expect((await savedFiles(page)).map((f) => f.name)).toEqual(['spec.html', 'spec.txt']);
});

test('without the copy permission the Convert commands are disabled with the reason', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
  const v = encryptedVariants(extractionFixture()).find((x) => x.name === 'R6-aes-256');
  if (!v) throw new Error('fixture');
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(v.bytes) }]);
  const pw = page.getByRole('dialog', { name: 'Password required' });
  await pw.getByLabel('Password').fill(USER_PW);
  await pw.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page.getByRole('tab', { name: 'Convert' }).click();
  const bar = page.getByRole('toolbar', { name: 'Convert commands' });
  for (const name of ['To Text', 'To Markdown', 'To HTML'])
    await expect(bar.getByRole('button', { name })).toBeDisabled();
});

test(
  'M4 exports offline: PDF Oxide from the cache, zero outbound requests',
  { tag: '@offline' },
  async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('/?sw');
    await expect(
      page.getByRole('contentinfo', { name: 'Status bar' }).getByText('✓ Ready offline'),
    ).toBeVisible({
      timeout: 60_000,
    });
    await context.setOffline(true);
    const outbound: string[] = [];
    page.on('requestfailed', (r) => {
      if (/^https?:/.test(r.url())) outbound.push(`failed ${r.url()}`);
    });
    page.on('response', (r) => {
      if (/^https?:/.test(r.url()) && !r.fromServiceWorker()) outbound.push(r.url());
    });
    try {
      await page.reload();
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await stubSavePicker(page);
      await open(page);
      const dialog = await convert(page, 'To HTML', 'Export as HTML');
      await dialog.getByRole('button', { name: 'Export' }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      expect((await savedFiles(page)).map((f) => f.name)).toEqual(['spec.html']);
      expect(outbound).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  },
);
