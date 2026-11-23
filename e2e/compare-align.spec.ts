import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { overlayDrawn, overlayOf, overlayView, unfold } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';

// M12-13 (D-60, Q7, Q8; M12-26, ADR-033): manual alignment on corpus pair 04
// (sheet 1: a 1.2° skew the automatic alignment finds; sheet 2: Rev B stored
// landscape with /Rotate 90). Line up, on the overlay's floating bar, starts
// the guided steps: 1 to 3 pairs picked in Document A's and Document B's
// windows — snapped to the drawing, with a magnifier, Alt for no snapping —
// and the overlay shows the placement at once; three pairs show the error;
// Undo last point; Fine-tune takes typed values and nudges Document A with
// the arrow keys; Apply sets it on this sheet, all sheets or the sheets that
// need checking, and Use automatic alignment goes back.

type Side = 'a' | 'b';
interface Pt {
  x: number;
  y: number;
}

const panel = (page: Page) => page.getByTestId('align-panel');
const stepBar = (page: Page) => page.getByTestId('line-up-bar');
const lineUp = (page: Page) =>
  page.getByRole('toolbar', { name: 'Overlay controls' }).getByRole('button', { name: 'Line up' });
const pickLayer = (page: Page, s: Side) => page.getByTestId(`align-pick-${s}`);
const currentStatus = (page: Page) =>
  page.locator('.overlay-sheet[aria-selected="true"] .overlay-sheet-align');

/** The placement being set (A's displayed page → B's), as the panel shows it. */
async function placeShown(page: Page): Promise<number[]> {
  const v = await page.getByTestId('align-values').getAttribute('data-place');
  if (!v) throw new Error('no placement');
  return v.split(',').map(Number);
}

const apply = (m: number[], p: Pt): Pt => ({
  x: (m[0] ?? 1) * p.x + (m[2] ?? 0) * p.y + (m[4] ?? 0),
  y: (m[1] ?? 0) * p.x + (m[3] ?? 1) * p.y + (m[5] ?? 0),
});
const degOf = (m: number[]): number =>
  (Math.atan2(((m[1] ?? 0) - (m[2] ?? 0)) / 2, ((m[0] ?? 1) + (m[3] ?? 1)) / 2) * 180) / Math.PI;

/** Where a displayed page point of a side's sheet is on screen. */
async function clientOf(page: Page, s: Side, p: Pt): Promise<Pt> {
  const layer = pickLayer(page, s);
  const box = await layer.boundingBox();
  const scale = Number(await layer.getAttribute('data-scale'));
  if (!box || !(scale > 0)) throw new Error('the window is not picking');
  return { x: box.x + p.x * scale, y: box.y + p.y * scale };
}

/** A displayed page point inside the part of a side's sheet in view, at fractions of that part. */
async function inView(page: Page, s: Side, fx: number, fy: number): Promise<Pt> {
  return page.evaluate(
    ({ s, fx, fy }) => {
      const host = document.querySelector(`[data-testid="review-window-${s}"]`);
      const vp = host?.querySelector<HTMLElement>('.viewport');
      const layer = host?.querySelector<HTMLElement>(`[data-testid="align-pick-${s}"]`);
      if (!vp || !layer) throw new Error('no window');
      const v = vp.getBoundingClientRect();
      const r = layer.getBoundingClientRect();
      const scale = Number(layer.dataset.scale);
      const left = Math.max(v.left, r.left);
      const right = Math.min(v.left + vp.clientWidth, r.right);
      const top = Math.max(v.top, r.top);
      const bottom = Math.min(v.top + vp.clientHeight, r.bottom);
      return {
        x: (left + (right - left) * fx - r.left) / scale,
        y: (top + (bottom - top) * fy - r.top) / scale,
      };
    },
    { s, fx, fy },
  );
}

/** Clicks a displayed page point in a side's window, Alt held (no snapping). */
async function pickAt(page: Page, s: Side, p: Pt): Promise<void> {
  const c = await clientOf(page, s, p);
  await page.keyboard.down('Alt');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Alt');
}

/** The point picked on a side, as its mark says (displayed pt). */
async function marked(page: Page, s: Side, n: number): Promise<Pt> {
  const m = page.getByTestId(`align-point-${s}-${String(n)}`);
  await expect(m).toBeAttached();
  return { x: Number(await m.getAttribute('data-x')), y: Number(await m.getAttribute('data-y')) };
}

async function startAligning(page: Page): Promise<void> {
  await overlayOf(page, '04');
  await expect(page.getByTestId('review-window-b').locator('.page')).not.toHaveCount(0);
  // Line up is on the floating bar, always in sight; the Alignment section opens itself.
  await lineUp(page).click();
  await expect(lineUp(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepBar(page)).toBeVisible();
  await expect(page.getByTestId('fold-align')).toHaveAttribute('aria-expanded', 'true');
  await expect(pickLayer(page, 'a')).toBeVisible();
  await expect(pickLayer(page, 'b')).toBeVisible();
}

/** Opens Fine-tune in the Alignment section (folded by default, M12-26). */
async function fineTune(page: Page): Promise<void> {
  const button = page.getByTestId('align-finetune');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(page.getByTestId('align-values')).toBeVisible();
}

test.describe('manual alignment (pair 04)', () => {
  test('two point pairs line up the skewed sheet; three show the error', async ({ page }) => {
    await startAligning(page);
    await expect(currentStatus(page)).toHaveText(/^Lined up automatically/);
    const auto = await placeShown(page);
    expect(degOf(auto)).toBeCloseTo(-1.2, 1);
    await expect(page.getByTestId('align-instruction')).toContainText('Document A');
    // Step 1: the old drawing's window is outlined and says what to do.
    await expect(stepBar(page)).toHaveAttribute('data-step', '1');
    await expect(page.getByTestId('review-window-a')).toHaveAttribute('data-line-up', 'true');
    await expect(page.getByTestId('review-window-b')).not.toHaveAttribute('data-line-up', 'true');
    await expect(stepBar(page).getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();

    // Each pair: a spot on A, then the same spot on B (where the automatic alignment puts it).
    const picked: { a: Pt; b: Pt }[] = [];
    for (const [n, fx, fy] of [
      [1, 0.2, 0.25],
      [2, 0.8, 0.75],
    ] as const) {
      await pickAt(page, 'a', await inView(page, 'a', fx, fy));
      const a = await marked(page, 'a', n);
      await expect(page.getByTestId('align-instruction')).toContainText('Document B');
      await expect(page.getByTestId('review-window-b')).toHaveAttribute('data-line-up', 'true');
      await pickAt(page, 'b', apply(auto, a));
      picked.push({ a, b: await marked(page, 'b', n) });
    }
    // The pairs' own rotation, and close to what the automatic alignment found.
    const [p1, p2] = picked;
    if (!p1 || !p2) throw new Error('pairs');
    const want =
      ((Math.atan2(p2.b.y - p1.b.y, p2.b.x - p1.b.x) -
        Math.atan2(p2.a.y - p1.a.y, p2.a.x - p1.a.x)) *
        180) /
      Math.PI;
    const set = await placeShown(page);
    expect(degOf(set)).toBeCloseTo(want, 5);
    expect(Math.abs(degOf(set) - degOf(auto))).toBeLessThan(0.2);
    const far = apply(set, p2.a);
    expect(Math.hypot(far.x - p2.b.x, far.y - p2.b.y)).toBeLessThan(0.01);
    // The overlay is drawn through the placement being set.
    await expect(overlayView(page)).toHaveAttribute('data-complete', 'true', { timeout: 30_000 });

    // A third pair, 3 pt off on B: a best fit, and how far each pair is off.
    await pickAt(page, 'a', await inView(page, 'a', 0.5, 0.2));
    const a3 = await marked(page, 'a', 3);
    const b3 = apply(set, a3);
    await pickAt(page, 'b', { x: b3.x + 3, y: b3.y });
    await expect(page.getByTestId('align-error')).toContainText('Best fit');
    await expect(page.getByTestId('align-pair-error')).toHaveCount(3);
    await expect(page.getByTestId('align-instruction')).toContainText('Three pairs');
    await expect(stepBar(page)).toHaveAttribute('data-step', '4');
    await expect(pickLayer(page, 'a')).toHaveCount(0);
    // Undo last point takes back B's third point and picks again; the error goes.
    await stepBar(page).getByRole('button', { name: 'Undo last point' }).click();
    await expect(page.getByTestId('align-point-b-3')).toHaveCount(0);
    await expect(page.getByTestId('align-point-a-3')).toBeAttached();
    await expect(pickLayer(page, 'b')).toBeVisible();
    await expect(page.getByTestId('align-error')).toHaveCount(0);
    await pickAt(page, 'b', { x: b3.x + 3, y: b3.y });
    await expect(page.getByTestId('align-error')).toContainText('Best fit');
    // Removing the third pair goes back to the two.
    await panel(page).getByRole('button', { name: 'Remove pair 3' }).click();
    await expect(page.getByTestId('align-error')).toHaveCount(0);
    expect(degOf(await placeShown(page))).toBeCloseTo(want, 5);

    // Apply: the sheet is lined up by hand; Use automatic alignment goes back.
    await stepBar(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(currentStatus(page)).toContainText('Lined up by hand');
    await expect(page.getByTestId('align-editor')).toHaveCount(0);
    await expect(stepBar(page)).toHaveCount(0);
    await expect(lineUp(page)).toHaveAttribute('aria-pressed', 'false');
    await overlayDrawn(page);
    await panel(page).getByRole('button', { name: 'Use automatic alignment' }).click();
    await expect(currentStatus(page)).toHaveText(/^Lined up automatically/);
  });

  test('values, nudges and Apply to all sheets', async ({ page }) => {
    await startAligning(page);
    await stepBar(page).getByRole('button', { name: 'Pick points' }).click();
    await expect(pickLayer(page, 'a')).toHaveCount(0);
    await expect(page.getByTestId('align-instruction')).toContainText('paused');
    await fineTune(page);
    const before = await placeShown(page);

    // Arrow keys on a nudge button: 0.1 pt a press, 1 pt with Shift.
    const right = page.getByTestId('align-nudge-right');
    await right.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    let now = await placeShown(page);
    expect((now[4] ?? 0) - (before[4] ?? 0)).toBeCloseTo(0.1, 5);
    expect((now[5] ?? 0) - (before[5] ?? 0)).toBeCloseTo(1, 5);
    await right.click();
    now = await placeShown(page);
    expect((now[4] ?? 0) - (before[4] ?? 0)).toBeCloseTo(0.2, 5);

    // Typed values: rotation about the sheet's centre, scale in per cent, offsets in pt.
    const rotation = panel(page).getByRole('textbox', { name: 'Rotation' });
    await rotation.fill('-1.5');
    await rotation.press('Enter');
    await expect.poll(async () => degOf(await placeShown(page))).toBeCloseTo(-1.5, 6);
    const scale = panel(page).getByRole('textbox', { name: 'Scale' });
    await scale.fill('99.5');
    await scale.press('Enter');
    await expect
      .poll(async () => {
        const m = await placeShown(page);
        return Math.hypot(m[0] ?? 0, m[1] ?? 0);
      })
      .toBeCloseTo(0.995, 6);
    const dx = panel(page).getByRole('textbox', { name: 'X offset' });
    await dx.fill('12.25');
    await dx.press('Enter');
    await expect.poll(async () => (await placeShown(page))[4]).toBeCloseTo(12.25, 6);
    // Arrow Up in a value steps it.
    await dx.press('ArrowUp');
    await expect.poll(async () => (await placeShown(page))[4]).toBeCloseTo(12.35, 6);
    // Not a number: refused, the placement stays.
    await dx.fill('abc');
    await dx.press('Enter');
    await expect(panel(page).getByRole('alert')).toBeVisible();
    await overlayDrawn(page);

    // Apply to all sheets: the /Rotate 90 sheet is set by hand too.
    await stepBar(page).getByLabel('Apply to').selectOption('all');
    await stepBar(page).getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(currentStatus(page)).toContainText('Lined up by hand');
    const sheets = page.getByTestId('overlay-sheets');
    await sheets.focus();
    await page.keyboard.press('ArrowDown');
    await expect(currentStatus(page)).toContainText('Lined up by hand');
    await expect(currentStatus(page)).toContainText('rotation -1.50°');
  });

  test('picking snaps to the drawing on the turned sheet, with a magnifier', async ({ page }) => {
    await overlayOf(page, '04');
    const sheets = page.getByTestId('overlay-sheets');
    await sheets.focus();
    await page.keyboard.press('ArrowDown');
    await overlayDrawn(page);
    // The Alignment section's own button starts Line up too.
    await unfold(page, 'align');
    await panel(page).getByRole('button', { name: 'Line up by hand' }).click();
    await expect(pickLayer(page, 'b')).toBeVisible();
    // Move over B's drawing until the pointer snaps (Rev B is stored landscape, shown turned).
    const box = await pickLayer(page, 'b').boundingBox();
    if (!box) throw new Error('no window');
    const marker = page.getByTestId('review-window-b').getByTestId('snap-marker');
    let snapped = false;
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.4, 0.4],
      [0.6, 0.45],
      [0.3, 0.6],
      [0.55, 0.3],
      [0.45, 0.65],
    ] as const) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await page.mouse.move(box.x + box.width * fx + 1, box.y + box.height * fy);
      if (await marker.isVisible({ timeout: 2000 }).catch(() => false)) {
        snapped = true;
        break;
      }
    }
    expect(snapped).toBe(true);
    await expect(page.getByTestId('align-magnifier')).toBeVisible();
    const m = await marker.boundingBox();
    if (!m) throw new Error('no marker');
    await page.mouse.down();
    await page.mouse.up();
    // The point picked is the snapped spot, marked where the snap marker was.
    const mark = page.getByTestId('align-point-b-1');
    await expect(mark).toBeAttached();
    const at = await mark.boundingBox();
    if (!at) throw new Error('no mark');
    expect(Math.abs(at.x + at.width / 2 - (m.x + m.width / 2))).toBeLessThan(1.5);
    expect(Math.abs(at.y + at.height / 2 - (m.y + m.height / 2))).toBeLessThan(1.5);
    // Escape stops picking; the magnifier goes.
    await page.keyboard.press('Escape');
    await expect(pickLayer(page, 'b')).toHaveCount(0);
    await expect(page.getByTestId('align-magnifier')).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`the alignment pane and the Line up steps pass axe (${theme}) @a11y`, async ({ page }) => {
      if (theme === 'dark') await darkTheme(page);
      await startAligning(page);
      await pickAt(page, 'a', await inView(page, 'a', 0.3, 0.3));
      await fineTune(page);
      const results = await new AxeBuilder({ page })
        .include('[data-testid="align-panel"]')
        .include('[data-testid="line-up-bar"]')
        .include('[data-testid="line-up-button"]')
        .analyze();
      expect(results.violations).toEqual([]);
    });
});
