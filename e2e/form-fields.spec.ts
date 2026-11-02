import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M6-14 (ADR-021 D-39, ADR-022 decision 4, §7.10; beta review C3; rules 6, 7,
// 9, 12): the Form tab. Text, Check Box, Radio Button, List Box and Dropdown
// fields drawn on the page (readable unique names, radio ids Choice1…, radio
// buttons drawn one after another in one group), Field Properties (name,
// tooltip /TU, flags, options, default /DV), the tab order panel, Select
// Fields, Highlight Fields; then filled by the existing form layer, saved by
// Ctrl+S narrow and reopened. Designing needs modify + annotate.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const TEXT = 6;
const CHECKBOX = 2;
const RADIO = 3;
const COMBO = 4;
const LIST = 5;

interface W {
  id: string;
  name: string;
  type: number;
  value: string;
  flag: number;
  tooltip: string;
  exportValue?: string;
  options: string[];
  maxLen?: number;
}

const widgets = async (page: Page, id: string) =>
  ((await cap(page, 'save', 'widgets', id, 0)) as W[] | null) ?? [];

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Form commands' });
const props = (page: Page) => page.getByTestId('field-properties');

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  // The page's annotations are loaded (the plugin's layer takes the drawing).
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** The page's box once the layout has settled (opening Properties re-fits the zoom). */
async function pageBox(page: Page) {
  const content = page.locator('[data-page="0"] .page-content');
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await content.boundingBox());
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
  const box = await content.boundingBox();
  if (!box) throw new Error('page not laid out');
  return box;
}

/** The on-screen position of a page point (top-left origin). */
async function screenPoint(page: Page, x: number, y: number) {
  const box = await pageBox(page);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await screenPoint(page, ...from);
  const b = await screenPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
}

async function click(page: Page, x: number, y: number) {
  const p = await screenPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

/** Every annotation committed (the plugin's commit is async). */
async function settled(page: Page, id: string) {
  await expect
    .poll(async () => {
      const list = (await cap(page, 'annotate', 'list', id)) as { commit: string }[] | null;
      return list?.every((a) => a.commit === 'synced') ?? false;
    })
    .toBe(true);
}

test('Form tab: draw the five field types, set their properties, fill them, Ctrl+S narrow, reopen @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const source = simplePdf(1);
  const id = await open(page, source, 'blank-form.pdf');

  await page.getByRole('tab', { name: 'Form', exact: true }).click();
  const bar = toolbar(page);
  for (const name of [
    'Hand',
    'Select Text',
    'Select Fields',
    'Text Field',
    'Check Box',
    'Radio Button',
    'List Box',
    'Dropdown',
    'Highlight Fields',
    'Reset Form',
  ])
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  // No fields yet: nothing to reset.
  await expect(bar.getByRole('button', { name: 'Reset Form', exact: true })).toBeDisabled();

  // Text field: drag a box. It gets a readable name and is selected.
  await bar.getByRole('button', { name: 'Text Field', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Text Field', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await drag(page, [100, 100], [300, 124]);
  await expect.poll(async () => (await widgets(page, id)).map((w) => w.name)).toEqual(['Text1']);
  await expect(props(page)).toBeVisible();
  await expect(props(page).getByLabel('Name', { exact: true })).toHaveValue('Text1');
  await expect(props(page).getByLabel('Type')).toHaveValue('Text field');

  // Field Properties: name, tooltip, required, maximum length.
  await props(page).getByLabel('Name', { exact: true }).fill('customer');
  await props(page).getByLabel('Name', { exact: true }).press('Tab');
  await expect.poll(async () => (await widgets(page, id)).map((w) => w.name)).toEqual(['customer']);
  await props(page).getByLabel('Tooltip').fill('Customer name');
  await props(page).getByLabel('Tooltip').press('Tab');
  await props(page).getByRole('checkbox', { name: 'Required' }).check();
  await expect.poll(async () => ((await widgets(page, id))[0]?.flag ?? 0) & 2).toBe(2);
  await props(page).getByLabel('Maximum length').fill('20');
  await props(page).getByLabel('Maximum length').press('Enter');
  await expect.poll(async () => (await widgets(page, id))[0]?.maxLen).toBe(20);
  await props(page).getByLabel('Default value').fill('n/a');
  await props(page).getByLabel('Default value').press('Tab');
  expect(await axe(page)).toEqual([]);

  // Check box (a click: the default size).
  await bar.getByRole('button', { name: 'Check Box', exact: true }).click();
  await click(page, 110, 160);
  // Two radio buttons drawn one after another: one group, export values Choice1 / Choice2.
  await bar.getByRole('button', { name: 'Radio Button', exact: true }).click();
  await click(page, 110, 200);
  await click(page, 150, 200);
  // Dropdown and list box.
  await bar.getByRole('button', { name: 'Dropdown', exact: true }).click();
  await drag(page, [100, 240], [260, 262]);
  await props(page).getByLabel('Items (one per line)').fill('DN50\nDN80\nDN100');
  await props(page).getByLabel('Items (one per line)').press('Tab');
  await bar.getByRole('button', { name: 'List Box', exact: true }).click();
  await drag(page, [100, 290], [260, 350]);
  await settled(page, id);

  await expect
    .poll(async () =>
      (await widgets(page, id)).map((w) => [w.name, w.type, w.exportValue ?? null]).sort(),
    )
    .toEqual(
      [
        ['customer', TEXT, null],
        ['Check Box1', CHECKBOX, 'Yes'],
        ['Group1', RADIO, 'Choice1'],
        ['Group1', RADIO, 'Choice2'],
        ['Dropdown1', COMBO, null],
        ['List Box1', LIST, null],
      ].sort(),
    );
  expect((await widgets(page, id)).find((w) => w.type === COMBO)?.options).toEqual([
    'DN50',
    'DN80',
    'DN100',
  ]);

  // Esc: back to Select Fields with the last field still selected; the tab order panel
  // lists the page's fields once nothing is selected.
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('button', { name: 'Select Fields', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  const panel = page.getByTestId('tab-order-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('listitem')).toHaveCount(6);
  await panel.getByLabel('Tab order', { exact: true }).selectOption({ label: 'Row order' });
  await expect(panel.getByRole('listitem').first()).toHaveText('1. customer');
  expect(await axe(page)).toEqual([]);

  // Select Fields moves a field (its box), one undo step.
  const before = (await cap(page, 'annotate', 'objects', id)) as {
    id: string;
    rect: { origin: { x: number } };
  }[];
  const listBox = (await widgets(page, id)).find((w) => w.type === LIST);
  await click(page, 180, 320);
  await expect.poll(() => cap(page, 'annotate', 'selected', id)).toEqual([listBox?.id]);
  await drag(page, [180, 320], [380, 320]);
  await settled(page, id);
  const after = (await cap(page, 'annotate', 'objects', id)) as typeof before;
  const moved = after.find((o) => o.id === listBox?.id);
  expect(moved?.rect.origin.x).toBeGreaterThan(
    (before.find((o) => o.id === listBox?.id)?.rect.origin.x ?? 0) + 150,
  );

  // Hand / Select: the fields are filled on the page, named by their tooltip.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Customer name' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Customer name' }).fill('Ada Lovelace');
  await page.getByRole('textbox', { name: 'Customer name' }).press('Enter');
  await page.locator('[data-field="Check Box1"]').check();
  await page.locator('[data-field="Group1"]').nth(1).check();
  await page.locator('[data-field="Dropdown1"]').selectOption({ label: 'DN80' });
  await expect
    .poll(async () => (await widgets(page, id)).find((w) => w.type === TEXT)?.value)
    .toBe('Ada Lovelace');

  // Highlight Fields off: no tint.
  await page.getByRole('tab', { name: 'Form', exact: true }).click();
  await bar.getByRole('button', { name: 'Highlight Fields', exact: true }).click();
  await expect(page.locator('.form-layer[data-highlight]')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Highlight Fields', exact: true }).click();
  await expect(page.locator('.form-layer[data-highlight]').first()).toBeVisible();

  // Ctrl+S: a narrow, verified revision; the reopened file has every field, value and tooltip.
  await settled(page, id);
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  expect(Buffer.from(saved.tail, 'base64').toString('latin1')).not.toMatch(/\/JavaScript|\/JS\b/);
  const file = Buffer.concat([Buffer.from(source), Buffer.from(saved.tail, 'base64')]);
  const again = await open(page, new Uint8Array(file), 'filled-form.pdf');
  await expect.poll(async () => (await widgets(page, again)).length).toBe(6);
  const back = await widgets(page, again);
  const text = back.find((w) => w.type === TEXT);
  expect(text).toMatchObject({ name: 'customer', value: 'Ada Lovelace', tooltip: 'Customer name' });
  expect((text?.flag ?? 0) & 2).toBe(2);
  expect(back.find((w) => w.type === CHECKBOX)?.value).toBe('Yes');
  expect(back.filter((w) => w.type === RADIO).map((w) => w.value)).toEqual(['Choice2', 'Choice2']);
  expect(back.find((w) => w.type === COMBO)?.value).toBe('DN80');
  await expect(page.getByRole('textbox', { name: 'Customer name' })).toHaveValue('Ada Lovelace');
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);
});

test('Form tab: keyboard creation, delete and undo; a document that forbids changes keeps the commands off', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1), 'keys.pdf');
  await page.getByRole('tab', { name: 'Form', exact: true }).click();
  const bar = toolbar(page);
  // From the keyboard: the tool, then Enter on the page places a field mid-page.
  await bar.getByRole('button', { name: 'Text Field', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(bar.getByRole('button', { name: 'Text Field', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await widgets(page, id)).map((w) => w.name)).toEqual(['Text1']);
  await settled(page, id);
  // Delete, then undo brings it back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await widgets(page, id)).length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await widgets(page, id)).map((w) => w.name)).toEqual(['Text1']);

  test.skip(!hasQpdf(), 'qpdf not installed');
  // Forms may be filled and comments added, but not the document changed (no bit 4).
  const locked = qpdfEncrypt(simplePdf(1), '', OWNER_PW, ['256', '--modify=annotate']);
  await open(page, locked, 'locked.pdf');
  await page.getByRole('tab', { name: 'Form', exact: true }).click();
  for (const name of [
    'Select Fields',
    'Text Field',
    'Check Box',
    'Radio Button',
    'List Box',
    'Dropdown',
  ])
    await expect(bar.getByRole('button', { name, exact: true })).toBeDisabled();
});
