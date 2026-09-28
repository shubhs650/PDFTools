import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-10 (§7.1): the Properties pane edits the selected annotations; one change
// is one undo step for the whole selection; Copy/Apply Style; saved narrow.

interface Obj {
  id: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  strokeStyle?: number;
  cloudyBorderIntensity?: number;
  contents?: string;
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const pane = (page: Page) => page.getByTestId('properties-pane');

async function setup(page: Page): Promise<{ id: string; a: string; b: string; bytes: Uint8Array }> {
  const bytes = simplePdf(1);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'props.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  const a = (await cap(page, 'annotate', 'createSquare', id, 0, 60, 60)) as string;
  const b = (await cap(page, 'annotate', 'createSquare', id, 0, 260, 60)) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(2);
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  return { id, a, b, bytes };
}

test('two rectangles: width, opacity and style change together, as one undo step', async ({
  page,
}) => {
  const { id, a, b } = await setup(page);
  await expect(pane(page)).toContainText('Select a comment');
  await cap(page, 'annotate', 'selectMany', id, [a, b]);
  await expect(pane(page)).toContainText('2 comments selected');

  const width = pane(page).getByLabel('Line width');
  await width.fill('4');
  await width.press('Enter');
  await expect
    .poll(async () => (await objects(page, id)).map((o) => o.strokeWidth))
    .toEqual([4, 4]);
  const opacity = pane(page).getByLabel('Opacity');
  await opacity.fill('150');
  await opacity.press('Enter');
  await expect(pane(page).getByRole('alert')).toHaveText('Enter a number from 0 to 100.');
  await opacity.fill('50');
  await opacity.press('Enter');
  await expect
    .poll(async () => (await objects(page, id)).map((o) => o.opacity))
    .toEqual([0.5, 0.5]);
  await pane(page).getByLabel('Line style').selectOption({ label: 'Cloudy' });
  await expect
    .poll(async () => (await objects(page, id)).map((o) => o.cloudyBorderIntensity))
    .toEqual([2, 2]);

  // One Ctrl+Z undoes the style for both.
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await objects(page, id)).map((o) => o.cloudyBorderIntensity ?? 0))
    .toEqual([0, 0]);
  expect((await objects(page, id)).map((o) => o.opacity)).toEqual([0.5, 0.5]);

  // Mixed values once they differ.
  await cap(page, 'annotate', 'selectMany', id, [a]);
  await pane(page).getByLabel('Line width').fill('8');
  await pane(page).getByLabel('Line width').press('Enter');
  await cap(page, 'annotate', 'selectMany', id, [a, b]);
  await expect(pane(page).getByLabel('Line width')).toHaveAttribute('placeholder', 'Mixed');

  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(saved.mode).toBe('narrow');
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/CA\s*0?\.5/);
  expect(tail).toMatch(/\/W\s*8/);
});

test('contents and subject; Copy Style → Apply Style', async ({ page }) => {
  const { id, a, b } = await setup(page);
  await cap(page, 'annotate', 'selectMany', id, [a]);
  const text = pane(page).getByLabel('Comment text');
  await text.fill('Move this 50 mm left');
  await pane(page).getByLabel('Subject').focus();
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === a)?.contents)
    .toBe('Move this 50 mm left');
  await pane(page).getByLabel('Line width').fill('6');
  await pane(page).getByLabel('Line width').press('Enter');
  await pane(page).getByLabel('Line style').selectOption({ label: 'Dashed' });
  await page.getByRole('tab', { name: 'Comment' }).click();
  const ribbon = page.getByRole('toolbar', { name: 'Comment commands' });
  await ribbon.getByRole('button', { name: 'Copy Comment Style' }).click();
  await cap(page, 'annotate', 'selectMany', id, [b]);
  await ribbon.getByRole('button', { name: 'Apply Comment Style' }).click();
  await expect
    .poll(async () => {
      const o = (await objects(page, id)).find((x) => x.id === b);
      return [o?.strokeWidth, o?.strokeStyle, o?.contents ?? ''];
    })
    .toEqual([6, 2, '']); // style copied, text not
});

test('the pane passes axe with a selection', async ({ page }) => {
  const { id, a } = await setup(page);
  await cap(page, 'annotate', 'selectMany', id, [a]);
  await expect(pane(page).getByLabel('Color')).toBeEnabled();
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="properties-pane"]')
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('read-only without the annotate permission (rule 9)', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf makes the locked fixture');
  const marked = Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>',
      '<< /Type /Annot /Subtype /Square /NM (sq-1) /Rect [100 600 300 700] /C [1 0 0] /BS << /W 4 >> >>',
    ]),
  );
  const locked = qpdfEncrypt(marked, '', 'owner', ['256', '--annotate=n', '--modify=none']);
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: Buffer.from(locked).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await objects(page, id)).length).toBe(1);
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  await cap(page, 'annotate', 'selectMany', id, ['sq-1']);
  await expect(pane(page)).toContainText("doesn't allow changes to comments");
  await expect(pane(page).getByLabel('Line width')).toBeDisabled();
});
