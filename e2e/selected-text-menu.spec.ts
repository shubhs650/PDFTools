import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M11-08·O1 (ADR-028, plan O1): a right click on selected text opens the
// selected-text menu (Copy, Highlight, Underline, Strikeout, Squiggly, Mark for
// Redaction, Search for "…") and keeps the selection; elsewhere the page menu
// as before. Shift+F10 with text selected opens it too. Rule 9: Copy and Search
// are disabled where the document forbids copying, the markups where it
// forbids commenting.

interface Listed {
  id: string;
  page: number;
  type: number;
  contents: string | null;
}
const TYPES = { highlight: 9, underline: 10, squiggly: 11, strikeout: 12, redact: 28 } as const;

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const view = (page: Page) => page.getByTestId('document-view');
const menu = (page: Page) => page.getByRole('menu');
const selectionRects = (page: Page) =>
  page.locator('[data-page="0"] .page-content div[style*="mix-blend-mode"] > div');
const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];

async function open(page: Page, bytes = simplePdf(3)): Promise<string> {
  await skipReviewerPrompt(page);
  await drop(page, [{ name: 'drawing.pdf', b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** Screen point of a PDF-space point (origin bottom-left) on page 0. */
async function at(page: Page, x: number, y: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  return { x: box.x + x * s, y: box.y + (842 - y) * s };
}

/** Drags over "Page 1" (72, 740; 36 pt Helvetica). */
async function selectPageOne(page: Page): Promise<void> {
  const from = await at(page, 66, 752);
  const to = await at(page, 190, 752);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(selectionRects(page).first()).toBeVisible();
}

/** A right click in the middle of the selected "Page 1". */
async function rightClickSelection(page: Page): Promise<void> {
  const p = await at(page, 125, 752);
  await page.mouse.click(p.x, p.y, { button: 'right' });
}

async function clipboard(context: BrowserContext, page: Page, set?: string): Promise<string> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  if (set !== undefined) await page.evaluate((t) => navigator.clipboard.writeText(t), set);
  return page.evaluate(() => navigator.clipboard.readText());
}

const ITEMS = [
  'Copy',
  'Highlight',
  'Underline',
  'Strikeout',
  'Squiggly',
  'Mark for Redaction',
  'Search for “Page 1”',
];

test('@smoke right click on selected text: the text menu, the selection kept; Copy copies it', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await open(page);
  await clipboard(context, page, 'before');
  await selectPageOne(page);
  await rightClickSelection(page);
  const m = menu(page);
  await expect(m).toHaveAccessibleName('Selected Text');
  await expect(m.getByRole('menuitem')).toHaveText(ITEMS.map((s) => new RegExp(`^${s}`)));
  // Plain items, never the tools' check boxes; the selection is still there.
  await expect(m.getByRole('menuitemcheckbox')).toHaveCount(0);
  await expect(selectionRects(page).first()).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).include('.ui-context-menu').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await m.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect(m).toBeHidden();
  await expect.poll(() => clipboard(context, page)).toBe('Page 1');

  // Elsewhere on the page: the page menu, as before (and the selection ends).
  const away = await at(page, 400, 700);
  await page.mouse.click(away.x, away.y, { button: 'right' });
  await expect(m).toHaveAccessibleName('Page');
  await page.keyboard.press('Escape');
});

for (const [name, type] of [
  ['Highlight', TYPES.highlight],
  ['Underline', TYPES.underline],
  ['Strikeout', TYPES.strikeout],
  ['Squiggly', TYPES.squiggly],
] as const)
  test(`${name} from the text menu marks the selected text at once`, async ({ page }) => {
    await page.goto('/');
    const id = await open(page);
    await selectPageOne(page);
    await rightClickSelection(page);
    await menu(page).getByRole('menuitem', { name, exact: true }).click();
    await expect.poll(async () => (await list(page, id)).map((a) => a.type)).toEqual([type]);
    expect((await list(page, id))[0]?.contents).toBe('Page 1');
    // The tool did not stay on: the pointer is still Select.
    await expect(page.locator('.document-host')).toHaveAttribute('data-tool', 'select');
    // One undo step.
    await view(page).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await list(page, id)).length).toBe(0);
  });

test('Mark for Redaction from the text menu marks the text and shows Pending Redactions', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page);
  await selectPageOne(page);
  await rightClickSelection(page);
  await menu(page).getByRole('menuitem', { name: 'Mark for Redaction', exact: true }).click();
  await expect
    .poll(async () => (await list(page, id)).map((a) => [a.type, a.contents]))
    .toEqual([[TYPES.redact, 'Page 1']]);
  await expect(page.getByRole('complementary', { name: 'Pending Redactions' })).toBeVisible();
});

test('Search for “…” fills the Search pane and runs it at once', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await selectPageOne(page);
  await rightClickSelection(page);
  await menu(page).getByRole('menuitem', { name: 'Search for “Page 1”' }).click();
  const pane = page.getByRole('region', { name: 'Search Results' });
  await expect(pane.getByRole('searchbox', { name: 'Search for' })).toHaveValue('Page 1');
  await expect(pane.getByRole('status')).toHaveText('1 result');
});

test('Shift+F10 with text selected opens the text menu on it; Esc returns to the document', async ({
  page,
}) => {
  await page.goto('/');
  await open(page);
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(selectionRects(page).first()).toBeVisible();
  await page.keyboard.press('Shift+F10');
  const m = menu(page);
  await expect(m).toHaveAccessibleName('Selected Text');
  await expect(m.getByRole('menuitem', { name: 'Search for “Page 1”' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(m).toBeHidden();
  await expect(view(page)).toBeFocused();
  await expect(selectionRects(page).first()).toBeVisible();
});

test('Select Text over a highlight: a right click on the selected text opens the text menu', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page);
  await selectPageOne(page);
  await rightClickSelection(page);
  await menu(page).getByRole('menuitem', { name: 'Highlight', exact: true }).click();
  await expect.poll(async () => (await list(page, id)).length).toBe(1);
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Select Text' })
    .click();
  await selectPageOne(page);
  await rightClickSelection(page);
  await expect(menu(page)).toHaveAccessibleName('Selected Text');
  await expect(selectionRects(page).first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('dark theme: the text menu passes axe', async ({ page }) => {
  await darkTheme(page);
  await page.goto('/');
  await open(page);
  await selectPageOne(page);
  await rightClickSelection(page);
  await expect(menu(page)).toHaveAccessibleName('Selected Text');
  const { violations } = await new AxeBuilder({ page }).include('.ui-context-menu').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('a document that forbids copying and commenting: the items are disabled and say why (rule 9)', async ({
  page,
  context,
}) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  await clipboard(context, page, 'before');
  const locked = qpdfEncrypt(simplePdf(1), USER_PW, OWNER_PW, [
    '256',
    '--extract=n',
    '--annotate=n',
    '--modify=none',
  ]);
  await skipReviewerPrompt(page);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  await page
    .getByRole('dialog', { name: 'Password required' })
    .getByLabel('Password')
    .fill(USER_PW);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await selectPageOne(page);
  await rightClickSelection(page);
  const m = menu(page);
  await expect(m).toHaveAccessibleName('Selected Text');
  // The text is not quoted where it may not be copied.
  for (const name of [
    'Copy',
    'Highlight',
    'Underline',
    'Strikeout',
    'Squiggly',
    'Mark for Redaction',
    'Search for Selected Text',
  ]) {
    const item = m.getByRole('menuitem', { name, exact: true });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAccessibleDescription(
      "Not allowed by this document's security settings",
    );
  }
  await m.getByRole('menuitem', { name: 'Copy', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(m).toBeVisible(); // a disabled item does nothing
  await page.keyboard.press('Escape');
  expect(await clipboard(context, page)).toBe('before');
});
