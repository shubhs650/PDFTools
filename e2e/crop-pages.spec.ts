import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { buildPdf, simplePdf } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M11-08·O9 (D-55, §7.8): Organize › Crop Pages and the Crop Tool. Margins
// (mm or inches) are cut off the pages as shown, for a page range, as one undo
// step; only /CropBox changes, so other readers honour it and Remove Crop
// shows the whole sheet again. Measurement scales keep their page
// coordinates, so values stay right on a cropped page. Needs modify (rule 9).

const MM = 72 / 25.4;
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const organize = (page: Page) => page.getByRole('toolbar', { name: 'Organize commands' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Crop Pages' });
const sizes = async (page: Page, id: string) =>
  ((await cap(page, 'pages', 'info', id)) as { w: number; h: number }[]).map((p) => [p.w, p.h]);
const crops = async (page: Page, id: string) =>
  (await cap(page, 'pages', 'crop', id)) as (number[] | null)[];

async function open(page: Page, bytes: Uint8Array, name = 'sheet.pdf'): Promise<string> {
  await page.goto('/');
  await skipReviewerPrompt(page);
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

async function openCrop(page: Page) {
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Crop Pages' }).click();
  await expect(dialog(page)).toBeVisible();
}

async function margins(
  page: Page,
  m: { top?: string; bottom?: string; left?: string; right?: string },
) {
  for (const [side, v] of Object.entries(m))
    await dialog(page)
      .getByLabel(side.charAt(0).toUpperCase() + side.slice(1), { exact: true })
      .fill(v);
}

async function undo(page: Page) {
  await page.getByRole('button', { name: 'Undo' }).first().click();
}

async function save(page: Page, id: string, original: Uint8Array) {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(s).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(s.tail, 'base64');
  return { file: Buffer.concat([Buffer.from(original), tail]), tail: tail.toString('latin1') };
}

test('Crop Pages: margins in mm on all pages, preview, one undo step, saved as /CropBox @smoke', async ({
  page,
}) => {
  const bytes = simplePdf(3);
  const id = await open(page, bytes);
  await openCrop(page);
  await expect(dialog(page).getByLabel('All pages (3)')).toBeChecked();
  await margins(page, { top: '20', bottom: '20', left: '10', right: '10' });
  // 595 × 842 pt is 209.9 × 297.0 mm.
  await expect(dialog(page).getByTestId('crop-summary')).toHaveText(
    'Page 1 will be 189.9 × 257 mm.',
  );
  await expect(dialog(page).getByTestId('crop-preview-kept')).toBeVisible();
  // Nothing is cropped yet: nothing to remove.
  await expect(dialog(page).getByRole('button', { name: 'Remove Crop' })).toBeDisabled();

  // The same lengths in inches.
  await dialog(page).getByLabel('Units').selectOption({ label: 'in' });
  await expect(dialog(page).getByLabel('Top', { exact: true })).toHaveValue('0.79');
  await dialog(page).getByLabel('Units').selectOption({ label: 'mm' });
  await expect(dialog(page).getByLabel('Top', { exact: true })).toHaveValue('20');

  // Too much: refused with the page named.
  await margins(page, { left: '200' });
  await expect(dialog(page).getByRole('alert')).toHaveText(
    'These margins leave too little of page 1.',
  );
  await expect(dialog(page).getByRole('button', { name: 'Crop', exact: true })).toBeDisabled();
  await margins(page, { left: 'x' });
  await expect(dialog(page).getByText('Type a number, 0 or more.')).toBeVisible();
  await margins(page, { left: '10' });

  await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze()
    .then((r) => {
      expect(r.violations.map((v) => v.id)).toEqual([]);
    });
  await dialog(page).getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  const cropped = [538, 729];
  await expect.poll(() => sizes(page, id)).toEqual([cropped, cropped, cropped]);
  expect((await crops(page, id))[0]).toEqual([28, 57, 567, 785]);

  // One undo step for all three pages; redo crops them again.
  await undo(page);
  await expect
    .poll(() => sizes(page, id))
    .toEqual([
      [595, 842],
      [595, 842],
      [595, 842],
    ]);
  await page.getByRole('button', { name: 'Redo' }).first().click();
  await expect.poll(() => sizes(page, id)).toEqual([cropped, cropped, cropped]);

  // Saved as one narrow revision: each page dictionary gets its /CropBox.
  const { file, tail } = await save(page, id, bytes);
  expect(tail.match(/\/CropBox/g)).toHaveLength(3);
  const id2 = await open(page, file, 'reopened.pdf');
  expect(await sizes(page, id2)).toEqual([cropped, cropped, cropped]);
});

test('Crop Tool: the area drawn on a page opens Crop Pages for that page; Remove Crop', async ({
  page,
}) => {
  const id = await open(page, simplePdf(2));
  await page.getByRole('tab', { name: 'Organize' }).click();
  const tool = organize(page).getByRole('button', { name: 'Crop Tool' });
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');

  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  const at = (x: number, y: number) => ({ x: box.x + x * s, y: box.y + y * s });
  const a = at(100, 150);
  const b = at(400, 600);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await expect(page.getByTestId('crop-area-draft')).toBeVisible();
  await page.mouse.up();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('The page you drew on (1)')).toBeChecked();
  // 100 pt from the left is 35.3 mm; 150 pt from the top is 52.9 mm (within a pixel's drag).
  const mm = async (label: string) =>
    Number(await dialog(page).getByLabel(label, { exact: true }).inputValue());
  expect(Math.abs((await mm('Left')) - 100 / MM)).toBeLessThan(1);
  expect(Math.abs((await mm('Top')) - 150 / MM)).toBeLessThan(1);
  expect(Math.abs((await mm('Right')) - 195 / MM)).toBeLessThan(1);
  expect(Math.abs((await mm('Bottom')) - 242 / MM)).toBeLessThan(1);
  await dialog(page).getByRole('button', { name: 'Crop', exact: true }).click();
  await expect.poll(async () => (await sizes(page, id))[1]).toEqual([595, 842]);
  const [w = 0, h = 0] = (await sizes(page, id))[0] ?? [];
  expect(Math.abs(w - 300)).toBeLessThanOrEqual(2);
  expect(Math.abs(h - 450)).toBeLessThanOrEqual(2);
  // The tool stays on until Esc.
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(tool).toHaveAttribute('aria-pressed', 'false');

  // Remove Crop for the current page: the whole sheet again.
  await organize(page).getByRole('button', { name: 'Crop Pages' }).click();
  await dialog(page).getByLabel('Current page (1)').check();
  await dialog(page).getByRole('button', { name: 'Remove Crop' }).click();
  await expect
    .poll(() => sizes(page, id))
    .toEqual([
      [595, 842],
      [595, 842],
    ]);
});

test('a page turned 90°: the margins are as the page is shown; dark theme, axe', async ({
  page,
}) => {
  await darkTheme(page);
  const bytes = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 90 >>',
  ]);
  const id = await open(page, bytes);
  // The viewer's page space is the stored page's: 595 × 842, shown turned (842 × 595).
  expect(await sizes(page, id)).toEqual([[595, 842]]);
  await openCrop(page);
  // 100 pt off the top as shown: the stored page's left edge.
  await margins(page, { top: String(100 / MM) });
  await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze()
    .then((r) => {
      expect(r.violations.map((v) => v.id)).toEqual([]);
    });
  await dialog(page).getByRole('button', { name: 'Crop', exact: true }).click();
  await expect.poll(() => sizes(page, id)).toEqual([[495, 842]]);
  expect(await crops(page, id)).toEqual([[100, 0, 595, 842]]);
});

test('Crop Tool on a page turned 90°: the area drawn as shown is kept', async ({ page }) => {
  const bytes = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate 90 >>',
  ]);
  const id = await open(page, bytes);
  await page.getByRole('tab', { name: 'Organize' }).click();
  await organize(page).getByRole('button', { name: 'Crop Tool' }).click();
  // The page is shown 842 × 595: points as shown from its top-left corner.
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 842;
  const a = { x: box.x + 100 * s, y: box.y + 150 * s };
  const b = { x: box.x + 400 * s, y: box.y + 500 * s };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(dialog(page)).toBeVisible();
  const mm = async (label: string) =>
    Number(await dialog(page).getByLabel(label, { exact: true }).inputValue());
  expect(Math.abs((await mm('Left')) - 100 / MM)).toBeLessThan(1);
  expect(Math.abs((await mm('Top')) - 150 / MM)).toBeLessThan(1);
  expect(Math.abs((await mm('Right')) - 442 / MM)).toBeLessThan(1);
  expect(Math.abs((await mm('Bottom')) - 95 / MM)).toBeLessThan(1);
  await dialog(page).getByRole('button', { name: 'Crop', exact: true }).click();
  // 300 × 350 as shown is 350 × 300 on the stored page.
  await expect
    .poll(async () => {
      const [w = 0, h = 0] = (await sizes(page, id))[0] ?? [];
      return Math.abs(w - 350) <= 2 && Math.abs(h - 300) <= 2;
    })
    .toBe(true);
});

test('measurement scales keep their page coordinates: values stay right on a cropped page', async ({
  page,
}) => {
  // The page at 1:100 in metres; Detail A at 1:5 in millimetres over the lower right.
  const m = ((25.4 / 72) * 100) / 1000;
  const d = (25.4 / 72) * 5;
  const vp = [
    `<< /Type /Viewport /BBox [0 0 595 842] /Name (Plan) /Measure << /Type /Measure /Subtype /RL /R (1 m = 100 m) /X [<< /Type /NumberFormat /U (m) /C ${m.toFixed(10)} /D 100 >>] /D [<< /U (m) /C 1 >>] /A [<< /U (sq m) /C 1 >>] >> >>`,
    `<< /Type /Viewport /BBox [300 100 560 400] /Name (Detail A) /Measure << /Type /Measure /Subtype /RL /R (1 mm = 5 mm) /X [<< /Type /NumberFormat /U (mm) /C ${d.toFixed(8)} /D 10 >>] /D [<< /U (mm) /C 1 >>] /A [<< /U (sq mm) /C 1 >>] >> >>`,
  ];
  const bytes = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /VP [${vp.join(' ')}] >>`,
  ]);
  const id = await open(page, bytes);
  interface Obj {
    id: string;
    contents?: string;
  }
  const contents = async (annot: string) =>
    (((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? []).find(
      (o) => o.id === annot,
    )?.contents ?? null;

  // Before: 80 mm on paper inside the detail (user y 150 is 692 from the top).
  const inDetail = (await cap(page, 'annotate', 'measure', id, 0, 'distance', [
    { x: 320, y: 692 },
    { x: 320 + 80 * MM, y: 692 },
  ])) as string;
  await expect.poll(() => contents(inDetail)).toBe('400.0 mm');

  // Crop 50 mm off the left and 100 mm off the top.
  await openCrop(page);
  await margins(page, { left: '50', top: '100' });
  await dialog(page).getByRole('button', { name: 'Crop', exact: true }).click();
  await expect.poll(async () => (await sizes(page, id))[0]?.[0]).toBe(453);
  const left = 50 * MM;
  const top = 842 - 100 * MM;
  // The measurement drawn before keeps its value.
  await expect.poll(() => contents(inDetail)).toBe('400.0 mm');

  // New ones on the cropped page: the same paper spots, now nearer the top-left.
  const again = (await cap(page, 'annotate', 'measure', id, 0, 'distance', [
    { x: 320 - left, y: top - 150 },
    { x: 320 + 80 * MM - left, y: top - 150 },
  ])) as string;
  await expect.poll(() => contents(again)).toBe('400.0 mm');
  const plan = (await cap(page, 'annotate', 'measure', id, 0, 'distance', [
    { x: 160 - left, y: top - 500 },
    { x: 160 + 200 * MM - left, y: top - 500 },
  ])) as string;
  await expect.poll(() => contents(plan)).toBe('20.00 m');
});

test('without the modify permission Crop Pages and the Crop Tool are disabled', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf is needed to make the restricted fixture');
  const bytes = qpdfEncrypt(simplePdf(2), USER_PW, OWNER_PW, ['256', '--modify=none']);
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(bytes) }]);
  const pw = page.getByRole('dialog', { name: 'Password required' });
  await pw.getByLabel('Password').fill(USER_PW);
  await pw.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await page.getByRole('tab', { name: 'Organize' }).click();
  for (const name of ['Crop Pages', 'Crop Tool'])
    await expect(organize(page).getByRole('button', { name })).toBeDisabled();
});
