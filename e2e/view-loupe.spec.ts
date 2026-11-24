import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { snapSheet } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M13-02·O1 (D-68, ADR-034): View → Loupe turns the Measure loupe on in every
// tool (off by default, kept on this device): the spot under the pointer
// larger, drawn by the Render worker, beside the pointer and hidden off the
// page. The Measure ribbon's own Loupe toggle still governs the measuring tools
// while View → Loupe is off.

const viewTab = (page: Page) => page.getByRole('toolbar', { name: 'View commands' });
const loupe = (page: Page) => page.getByTestId('measure-loupe');
const button = (page: Page) => viewTab(page).getByRole('button', { name: 'Loupe', exact: true });

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'snap.pdf', b64: Buffer.from(snapSheet()).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'View' }).click();
}

/** A point of the page, as a fraction of its box. */
async function onPage(page: Page, fx: number, fy: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function hover(page: Page, fx: number, fy: number): Promise<void> {
  const p = await onPage(page, fx, fy);
  await page.mouse.move(p.x - 8, p.y - 8);
  await page.mouse.move(p.x, p.y, { steps: 3 });
}

async function offPage(page: Page): Promise<void> {
  const ribbon = await viewTab(page).boundingBox();
  if (!ribbon) throw new Error('no ribbon');
  await page.mouse.move(ribbon.x + 10, ribbon.y + 10, { steps: 3 });
}

test('View → Loupe shows the loupe in every tool, beside the pointer, hidden off the page @smoke', async ({
  page,
}) => {
  await open(page);
  await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
  // Off by default: no loupe with Select.
  await hover(page, 0.5, 0.5);
  await expect(loupe(page)).toHaveCount(0);

  await button(page).click();
  await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
  await hover(page, 0.5, 0.5);
  await expect(loupe(page)).toBeVisible();
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'loupe')) as { drawn: number }).drawn)
    .toBeGreaterThan(0);
  const lens = await loupe(page).boundingBox();
  const p = await onPage(page, 0.5, 0.5);
  if (!lens) throw new Error('no loupe');
  expect(
    p.x < lens.x || p.x > lens.x + lens.width || p.y < lens.y || p.y > lens.y + lens.height,
  ).toBe(true);
  // No snapping outside a tool that snaps: no marker or kind.
  await expect(page.getByTestId('measure-loupe-marker')).toHaveCount(0);

  await offPage(page);
  await expect(loupe(page)).toHaveCount(0);

  // Hand, a comment tool and a measuring tool: still shown.
  await page.getByRole('tab', { name: 'Home' }).click();
  const home = page.getByRole('toolbar', { name: 'Home commands' });
  await home.getByRole('button', { name: 'Hand', exact: true }).click();
  await hover(page, 0.4, 0.6);
  await expect(loupe(page)).toBeVisible();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  await hover(page, 0.3, 0.3);
  await expect(loupe(page)).toBeVisible();
  await page.getByRole('tab', { name: 'Measure' }).click();
  const measure = page.getByRole('toolbar', { name: 'Measure commands' });
  // The Measure ribbon's Loupe off: View → Loupe still shows it while measuring.
  await measure.getByRole('button', { name: 'Loupe', exact: true }).click();
  await measure.getByRole('button', { name: 'Distance', exact: true }).click();
  await hover(page, 0.6, 0.4);
  await expect(loupe(page)).toBeVisible();

  // Kept on this device.
  const stored = await page.evaluate(() => localStorage.getItem('pdftools.measureLoupe'));
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ on: false, anywhere: true });
  await open(page);
  await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
  await hover(page, 0.5, 0.5);
  await expect(loupe(page)).toBeVisible();
  // Off again: gone with Select.
  await button(page).click();
  await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
  await hover(page, 0.55, 0.55);
  await expect(loupe(page)).toHaveCount(0);
});

test('View → Loupe follows a turned view: the spot shown is the one under the pointer', async ({
  page,
}) => {
  await open(page);
  await button(page).click();
  const at = async () =>
    (await cap(page, 'annotate', 'loupePointer')) as { page: number; x: number; y: number } | null;
  // (Upper part of the page: in view at the opening zoom.)
  await hover(page, 0.25, 0.35);
  await expect(loupe(page)).toBeVisible();
  // snapSheet is 600 × 600 pt.
  let p = await at();
  expect(p?.page).toBe(0);
  expect(p?.x).toBeCloseTo(150, -1);
  expect(p?.y).toBeCloseTo(210, -1);
  // One clockwise turn: the view's (150, 210) is the page's own (210, 450).
  await viewTab(page).getByRole('button', { name: 'Rotate View Clockwise' }).click();
  await offPage(page);
  await hover(page, 0.25, 0.35);
  await expect(loupe(page)).toBeVisible();
  p = await at();
  expect(p?.x).toBeCloseTo(210, -1);
  expect(p?.y).toBeCloseTo(450, -1);
  // The same spot as Distance reports it from its own pointer handler.
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Distance', exact: true })
    .click();
  await hover(page, 0.25, 0.35);
  await expect(loupe(page)).toBeVisible();
  const d = await at();
  expect(Math.abs((d?.x ?? 0) - (p?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((d?.y ?? 0) - (p?.y ?? 0))).toBeLessThan(2);
});

for (const dark of [false, true])
  test(`View → Loupe and the loupe pass axe (${dark ? 'dark' : 'light'}), keyboard reachable @a11y`, async ({
    page,
  }) => {
    if (dark) await darkTheme(page);
    await open(page);
    await button(page).focus();
    await page.keyboard.press('Enter');
    await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
    await hover(page, 0.5, 0.5);
    await expect(loupe(page)).toBeVisible();
    const r = await new AxeBuilder({ page })
      .include('[role="toolbar"][aria-label="View commands"]')
      .include('[data-testid="measure-loupe"]')
      .analyze();
    expect(r.violations).toEqual([]);
  });

// M13-09 (D-68): M shows or hides the loupe where the person is — View → Loupe in
// a tool the Measure loupe does not serve, the Measure loupe in Distance.
test('M shows or hides the loupe in the tool in use', async ({ page }) => {
  await open(page);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('m');
  await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
  await hover(page, 0.5, 0.5);
  await expect(loupe(page)).toBeVisible();
  await page.keyboard.press('m');
  await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
  await hover(page, 0.45, 0.45);
  await expect(loupe(page)).toHaveCount(0);

  await page.getByRole('tab', { name: 'Measure' }).click();
  const measure = page.getByRole('toolbar', { name: 'Measure commands' });
  const measureLoupe = measure.getByRole('button', { name: 'Loupe', exact: true });
  await expect(measureLoupe).toHaveAttribute('aria-pressed', 'true');
  await measure.getByRole('button', { name: 'Distance', exact: true }).click();
  await hover(page, 0.6, 0.4);
  await expect(loupe(page)).toBeVisible();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('m');
  await expect(measureLoupe).toHaveAttribute('aria-pressed', 'false');
  await hover(page, 0.55, 0.45);
  await expect(loupe(page)).toHaveCount(0);
  await page.keyboard.press('m');
  await expect(measureLoupe).toHaveAttribute('aria-pressed', 'true');
  await hover(page, 0.6, 0.4);
  await expect(loupe(page)).toBeVisible();
  // View → Loupe stayed off: the key turned the Measure loupe back on.
  await page.getByRole('tab', { name: 'View' }).click();
  await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
});
