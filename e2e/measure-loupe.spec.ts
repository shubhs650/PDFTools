import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { snapSheet } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M13-02 (D-68, ADR-034, owner choice P3): a loupe beside the pointer for
// Distance, Perimeter, Area, Calibrate and drawing a Scale Viewport — the
// spot under the pointer larger (drawn by the Render worker), a crosshair, the
// snap marker and the snap kind; hidden off the page; Alt: no snap. Picking a
// measuring tool turns snapping on (a short note says so) and its end turns it
// back, unless the person switched it meanwhile. Loupe toggle in the Measure
// ribbon's Snap group; Settings → Measure: size, magnification, auto-snap.

const H = 600; // snapSheet is 600 × 600 pt: user y → EmbedPDF y = H − y
const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });
const loupe = (page: Page) => page.getByTestId('measure-loupe');
const toggle = (page: Page) => page.getByTestId('snap-toggle');
const backstage = (page: Page) => page.getByTestId('backstage');

async function at(page: Page, x: number, yUser: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 600;
  return { x: box.x + x * s, y: box.y + (H - yUser) * s };
}

async function open(page: Page): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'snap.pdf', b64: Buffer.from(snapSheet()).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure' }).click();
  return id;
}

/** Picks a measuring tool the way a person does (Calibrate through its dialog's Pick button). */
async function pick(page: Page, name: string): Promise<void> {
  await measureTab(page).getByRole('button', { name, exact: true }).click();
  if (name === 'Calibrate') {
    const dialog = page.getByRole('dialog', { name: 'Calibrate' });
    await dialog.getByRole('button', { name: 'Pick two points on the page' }).click();
    await expect(dialog).toBeHidden();
  }
}

/** Moves near the rectangle's corner (400, 450) until the pointer snaps to it. */
async function hoverCorner(page: Page): Promise<void> {
  const a = await at(page, 403, 447);
  await expect
    .poll(
      async () => {
        await page.mouse.move(a.x - 12, a.y - 9);
        await page.mouse.move(a.x, a.y, { steps: 3 });
        return page.getByTestId('measure-loupe-marker').getAttribute('data-kind', { timeout: 500 });
      },
      { timeout: 20_000 },
    )
    .toBe('endpoint');
}

for (const tool of ['Distance', 'Perimeter', 'Area', 'Calibrate', 'Scale Viewport'])
  test(`${tool}: the loupe follows the pointer with the snap kind, hides off the page`, async ({
    page,
  }) => {
    await open(page);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await pick(page, tool);
    // Picking a measuring tool turns snapping on.
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await hoverCorner(page);
    await expect(loupe(page)).toBeVisible();
    await expect(page.getByTestId('measure-loupe-label')).toHaveText('Endpoint');
    // The page drawn inside it by the Render worker (a picture, not the page's own tiles).
    await expect
      .poll(async () => ((await cap(page, 'annotate', 'loupe')) as { drawn: number }).drawn)
      .toBeGreaterThan(0);
    const lens = await loupe(page).boundingBox();
    const corner = await at(page, 403, 447);
    if (!lens) throw new Error('no loupe');
    // Beside the pointer, never under it.
    expect(
      corner.x < lens.x ||
        corner.x > lens.x + lens.width ||
        corner.y < lens.y ||
        corner.y > lens.y + lens.height,
    ).toBe(true);
    // Medium (the default) is 176 px.
    expect(Math.round(lens.width)).toBe(176);
    // Alt held: no snap for that spot (the loupe stays, without a marker or kind).
    await page.keyboard.down('Alt');
    const b = await at(page, 404, 446);
    await page.mouse.move(b.x, b.y, { steps: 2 });
    await expect(page.getByTestId('measure-loupe-marker')).toHaveCount(0);
    await expect(page.getByTestId('measure-loupe-label')).toHaveCount(0);
    await page.keyboard.up('Alt');
    // Off the page (over the ribbon): hidden.
    const ribbon = await measureTab(page).boundingBox();
    if (!ribbon) throw new Error('no ribbon');
    await page.mouse.move(ribbon.x + ribbon.width / 2, ribbon.y + ribbon.height + 4, { steps: 4 });
    await page.mouse.move(ribbon.x + 10, ribbon.y + 10, { steps: 2 });
    await expect(loupe(page)).toHaveCount(0);
    // Esc ends the tool: snapping goes back off. (The ribbon button picked has the
    // focus: the first Esc takes it back to the document, the second ends the tool.)
    await page.mouse.move(corner.x, corner.y, { steps: 3 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(loupe(page)).toHaveCount(0);
  });

test('auto snap: a note says so, one session across tools, the person’s own switch wins', async ({
  page,
}) => {
  await open(page);
  await pick(page, 'Distance');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('snapshot-toast')).toHaveText(
    'Snapping is on while you measure. It goes back to how it was when you finish.',
  );
  // Another measuring tool: still one session; another kind of tool ends it.
  await pick(page, 'Area');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Line', exact: true })
    .click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  // Switched off and on by the person while measuring: it stays on afterwards, and is kept.
  await page.getByRole('tab', { name: 'Measure' }).click();
  await pick(page, 'Perimeter');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await toggle(page).click();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  // Snapping already on: picking a tool changes nothing and no note shows.
  await page.getByTestId('snapshot-toast').waitFor({ state: 'detached', timeout: 8000 });
  await pick(page, 'Distance');
  await expect(page.getByTestId('snapshot-toast')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
});

test('Settings → Measure and the ribbon toggle: size, magnification, auto-snap, kept on the device', async ({
  page,
}) => {
  await open(page);
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  const section = backstage(page).getByTestId('measure-section');
  await expect(section).toBeVisible();
  await section
    .getByRole('group', { name: 'Loupe size' })
    .getByRole('radio', { name: 'Large' })
    .check();
  await section
    .getByRole('group', { name: 'Loupe magnification' })
    .getByRole('radio', { name: '8×' })
    .check();
  const auto = section.getByRole('checkbox', { name: 'Turn on snapping when measuring' });
  await expect(auto).toBeChecked();
  await auto.uncheck();
  await page.keyboard.press('Escape');
  await expect(backstage(page)).toBeHidden();

  // Auto-snap off: picking Distance leaves snapping off; the loupe still shows, larger.
  await pick(page, 'Distance');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  const c = await at(page, 300, 300);
  await page.mouse.move(c.x - 10, c.y - 10);
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await expect(loupe(page)).toBeVisible();
  const lens = await loupe(page).boundingBox();
  expect(Math.round(lens?.width ?? 0)).toBe(240);

  // The ribbon's Loupe toggle (Snap group) hides it; the choice survives a reload.
  const button = measureTab(page).getByRole('button', { name: 'Loupe', exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await pick(page, 'Distance');
  await page.mouse.move(c.x + 5, c.y + 5, { steps: 3 });
  await expect(loupe(page)).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem('pdftools.measureLoupe'));
  expect(JSON.parse(stored ?? '{}')).toEqual({
    on: false,
    size: 'large',
    mag: 8,
    autoSnap: false,
    anywhere: false,
  });
  await open(page);
  await expect(
    measureTab(page).getByRole('button', { name: 'Loupe', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

for (const dark of [false, true])
  test(`the loupe, the Snap group and Settings → Measure pass axe (${dark ? 'dark' : 'light'}) @a11y`, async ({
    page,
  }) => {
    if (dark) await darkTheme(page);
    await open(page);
    await pick(page, 'Distance');
    await hoverCorner(page);
    await expect(loupe(page)).toBeVisible();
    const ribbon = await new AxeBuilder({ page })
      .include('[role="toolbar"][aria-label="Measure commands"]')
      .include('[data-testid="measure-loupe"]')
      .analyze();
    expect(ribbon.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByTestId('file-tab').click();
    await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(backstage(page).getByTestId('measure-section')).toBeVisible();
    const settings = await new AxeBuilder({ page })
      .include('[data-testid="measure-section"]')
      .analyze();
    expect(settings.violations).toEqual([]);
    // Keyboard: Tab reaches the size radios.
    await backstage(page).getByRole('radio', { name: 'Medium' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(backstage(page).getByRole('radio', { name: 'Large' })).toBeChecked();
  });
