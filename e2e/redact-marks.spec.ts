import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M4-16 (§7.9 step 1, M4-Q3, M4-Q10): Protect → Mark for Redaction (text) and
// Mark Area for Redaction (pointer and keyboard) make standard /Redact
// annotations; Pending Redactions lists, jumps to and removes them; marks are
// undoable, saved with Ctrl+S and loaded again as pending marks.

interface Listed {
  id: string;
  page: number;
  type: number;
  contents: string | null;
}
const REDACT = 28;

const list = async (page: Page, id: string) =>
  (((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? []).filter(
    (a) => a.type === REDACT,
  );

async function open(page: Page, bytes: Uint8Array) {
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'spec.pdf', b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Protect commands' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Pending Redactions' });

/** Drags over "Page 1" of simplePdf (72, 740; 36 pt Helvetica). */
async function dragText(page: Page) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 595;
  const y = box.y + (842 - 752) * s;
  await page.mouse.move(box.x + 66 * s, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 190 * s, y, { steps: 8 });
  await page.mouse.up();
}

test('mark text and an area, list, remove, undo; saved as /Redact and loaded back as pending', async ({
  page,
}) => {
  await page.goto('/');
  const bytes = simplePdf(2);
  const id = await open(page, bytes);
  await page.getByRole('tab', { name: 'Protect' }).click();

  // Text: select first, then Mark for Redaction.
  await dragText(page);
  await bar(page).getByRole('button', { name: 'Mark for Redaction' }).click();
  await expect.poll(() => list(page, id)).toHaveLength(1);
  const [text] = await list(page, id);
  expect(text?.contents).toBe('Page 1');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('1 mark waiting to be applied.');
  await expect(panel(page).getByRole('button', { name: /^1\. Text, page 1/ })).toContainText(
    'Page 1',
  );
  await expect(page.locator('[data-page="0"] [data-testid="redact-mark"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '1 redaction mark' })).toBeVisible();

  // Area: the tool on, a drag on the page.
  const area = bar(page).getByRole('button', { name: 'Mark Area for Redaction' });
  await area.click();
  await expect(area).toHaveAttribute('aria-pressed', 'true');
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  await page.mouse.move(box.x + 100, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 380, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => list(page, id)).toHaveLength(2);
  await page.keyboard.press('Escape');

  // Undo removes the last mark; redo brings it back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => list(page, id)).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+y');
  await expect.poll(() => list(page, id)).toHaveLength(2);

  // A click on a mark selects it (the fill shows); Delete removes it; undo restores it.
  const marks = page.locator('[data-page="0"] [data-testid="redact-mark"]');
  await marks.last().click();
  await expect(marks.last()).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Delete');
  await expect.poll(() => list(page, id)).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => list(page, id)).toHaveLength(2);

  const { violations } = await new AxeBuilder({ page }).include('.redact-panel').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // Remove the text mark from the list.
  await panel(page)
    .getByRole('button', { name: /^Remove mark 1\. Text, page 1/ })
    .click();
  await expect.poll(() => list(page, id)).toHaveLength(1);
  await expect(panel(page)).toContainText('1 mark waiting to be applied.');

  // Ctrl+S: a /Redact annotation with /QuadPoints and /IC in the saved revision.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { tail: string; mode: string };
  const tail = Buffer.from(saved.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/Subtype\s*\/Redact/);
  expect(tail).toMatch(/\/QuadPoints/);
  expect(tail).toMatch(/\/IC\s*\[\s*0\s+0\s+0\s*\]/);

  // Reopened: the mark is pending again.
  const file = Buffer.concat([Buffer.from(bytes), Buffer.from(saved.tail, 'base64')]);
  await page.goto('/');
  const id2 = await open(page, file);
  await expect.poll(() => list(page, id2)).toHaveLength(1);
  await expect(page.getByRole('button', { name: '1 redaction mark' })).toBeVisible();
});

test('tool first: Mark for Redaction on, each text selection becomes a mark until Esc', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1));
  await page.getByRole('tab', { name: 'Protect' }).click();
  const mark = bar(page).getByRole('button', { name: 'Mark for Redaction' });
  await mark.click();
  await expect(mark).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page)).toBeVisible();
  await dragText(page);
  await expect.poll(() => list(page, id)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(mark).toHaveAttribute('aria-pressed', 'false');
});

// The zoom changing during an area drag (fit width catching up with a pane that
// opened, as seen on CI) keeps the drag: the mark is still made.
test('a zoom change in the middle of an area drag still makes the mark', async ({ page }) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1));
  await page.getByRole('tab', { name: 'Protect' }).click();
  const area = bar(page).getByRole('button', { name: 'Mark Area for Redaction' });
  await area.click();
  await expect(area).toHaveAttribute('aria-pressed', 'true');
  const content = page.locator('[data-page="0"] .page-content');
  const box = await content.boundingBox();
  if (!box) throw new Error('page not laid out');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 80, { steps: 3 });
  await cap(page, 'view', 'zoom', 0.75);
  await expect.poll(async () => (await content.boundingBox())?.width).not.toBe(box.width);
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => list(page, id)).toHaveLength(1);
});

test('keyboard: Ctrl+A then Mark for Redaction; the area rectangle from the keyboard', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1));
  await page.getByRole('tab', { name: 'Protect' }).click();
  // Ctrl+A selects the page's text (M3-Q6); the command marks it.
  await page.locator('[data-page="0"] .page-content').click({ position: { x: 300, y: 500 } });
  await page.keyboard.press('ControlOrMeta+a');
  const mark = bar(page).getByRole('button', { name: 'Mark for Redaction' });
  await mark.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => list(page, id)).toHaveLength(1);

  // Mark Area from the keyboard: the rectangle at the page's centre, moved, resized, marked.
  await page.waitForTimeout(600);
  const area = bar(page).getByRole('button', { name: 'Mark Area for Redaction' });
  await area.focus();
  await page.keyboard.press('Enter');
  const rect = page.getByRole('application', { name: 'Area to mark for redaction' });
  await expect(rect).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => list(page, id)).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect(rect).toHaveCount(0);
  await expect(area).toHaveAttribute('aria-pressed', 'false');
});
