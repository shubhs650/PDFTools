import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-08·O4 (ADR-028): View › Zoom to Area, and Z held with Hand. A drag
// draws a rectangle that fills the window when released (its middle comes to
// the middle of the view, at any view rotation); a click zooms in one step at
// the pointer and Alt+click zooms out; Previous View goes back. The tool takes
// every press: no text is selected and no comment picked up under it.

const GAP = 10; // PAGE_GAP: the view's padding on each side
const view = (page: Page) => page.getByTestId('document-view');
const host = (page: Page) => page.locator('.document-host');
const viewToolbar = (page: Page) => page.getByRole('toolbar', { name: 'View' });
const zoomToArea = (page: Page) =>
  viewToolbar(page).getByRole('button', { name: 'Zoom to Area', exact: true });

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function scale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const t = (
      window as unknown as {
        __pdftoolsTest: {
          capabilities: {
            stores: {
              documents: {
                getState(): { activeId: string; docs: Record<string, { view: { scale: number } }> };
              };
            };
          };
        };
      }
    ).__pdftoolsTest.capabilities.stores.documents.getState();
    return t.docs[t.activeId]?.view.scale ?? 0;
  });
}

/** Page `i`'s box and the view's visible box, in client pixels. */
async function boxes(page: Page, i: number): Promise<{ page: Box; view: Box }> {
  return page.evaluate((index) => {
    const vp = document.querySelector<HTMLElement>('[data-testid="document-view"]');
    const el = vp?.querySelector<HTMLElement>(`.page[data-page="${String(index)}"]`);
    if (!vp || !el) throw new Error('no page');
    const v = vp.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      page: { left: r.left, top: r.top, width: r.width, height: r.height },
      view: {
        left: v.left + vp.clientLeft,
        top: v.top + vp.clientTop,
        width: vp.clientWidth,
        height: vp.clientHeight,
      },
    };
  }, i);
}

async function open(page: Page): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'drawing.pdf', b64: Buffer.from(simplePdf(3)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await view(page).focus();
  await page.keyboard.press('ControlOrMeta+0'); // Fit Page: the whole page in view
  await expect(page.getByRole('textbox', { name: 'Zoom', exact: true })).not.toHaveValue('100%');
  return id;
}

/** Drags from fraction `a` to fraction `b` of page 0; returns what is expected after. */
async function dragOnPage(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<{ zoom: number; f: { x: number; y: number } }> {
  const { page: p, view: v } = await boxes(page, 0);
  const from = { x: p.left + a.x * p.width, y: p.top + a.y * p.height };
  const to = { x: p.left + b.x * p.width, y: p.top + b.y * p.height };
  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  const s0 = await scale(page);
  const zoom = s0 * Math.min((v.width - 2 * GAP) / w, (v.height - 2 * GAP) / h);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  // The rectangle follows the pointer.
  const rect = page.getByTestId('zoom-area-rect');
  await expect(rect).toBeVisible();
  const r = await rect.boundingBox();
  expect(r?.width).toBeCloseTo(w, 0);
  expect(r?.height).toBeCloseTo(h, 0);
  await page.mouse.up();
  await expect(rect).toHaveCount(0);
  return { zoom, f: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/** The point at fraction `f` of page 0, less the middle of the view (client px). */
async function offCentre(page: Page, f: { x: number; y: number }): Promise<number> {
  const { page: p, view: v } = await boxes(page, 0);
  return Math.hypot(
    p.left + f.x * p.width - (v.left + v.width / 2),
    p.top + f.y * p.height - (v.top + v.height / 2),
  );
}

for (const rotated of [false, true]) {
  test(`View › Zoom to Area: the dragged area fills the window${rotated ? ' (view rotated 90°)' : ' @smoke'}`, async ({
    page,
  }) => {
    const id = await open(page);
    await page.getByRole('tab', { name: 'View' }).click();
    if (rotated) {
      await viewToolbar(page).getByRole('button', { name: 'Rotate View Clockwise' }).click();
      await view(page).focus();
      await page.keyboard.press('ControlOrMeta+0');
      await expect
        .poll(async () => (await boxes(page, 0)).page.width)
        .toBeGreaterThan((await boxes(page, 0)).page.height);
    }
    const s0 = await scale(page);
    await zoomToArea(page).click();
    await expect(zoomToArea(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(host(page)).toHaveAttribute('data-tool', 'zoomArea');

    // A wide area on the left of the page: its width decides.
    const want = await dragOnPage(page, { x: 0.15, y: 0.3 }, { x: 0.45, y: 0.36 });
    await expect.poll(() => scale(page)).toBeCloseTo(want.zoom, 1);
    expect(await scale(page)).toBeGreaterThan(s0 * 2);
    // Its middle is now in the middle of the view.
    await expect.poll(() => offCentre(page, want.f)).toBeLessThan(3);

    // Nothing under the drag was selected, and the tool stays on.
    expect(
      ((await cap(page, 'view', 'selection')) as { selection: unknown } | null)?.selection ?? null,
    ).toBeNull();
    expect(((await cap(page, 'annotate', 'selected', id)) as string[] | null) ?? []).toEqual([]);
    await expect(zoomToArea(page)).toHaveAttribute('aria-pressed', 'true');

    // Previous View (Alt+Left) goes back to the whole page.
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(() => scale(page)).toBeCloseTo(s0, 2);

    // Esc ends the tool: back to Select.
    await page.keyboard.press('Escape');
    await expect(zoomToArea(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(host(page)).toHaveAttribute('data-tool', 'select');
  });
}

test('Zoom to Area: a click zooms in one step at the pointer, Alt+click zooms out; the page menu has it', async ({
  page,
}) => {
  await open(page);
  // Fit Width, so the page is wider than the view after zooming in (it can scroll sideways).
  await page.keyboard.press('ControlOrMeta+2');
  await expect(page.getByRole('textbox', { name: 'Zoom', exact: true })).not.toHaveValue('100%');
  // From the page menu.
  const { page: p } = await boxes(page, 0);
  const at = { x: p.left + p.width * 0.3, y: p.top + p.height * 0.4 };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitemcheckbox', { name: 'Zoom to Area' }).click();
  await expect(host(page)).toHaveAttribute('data-tool', 'zoomArea');

  const s0 = await scale(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => scale(page)).toBeGreaterThan(s0);
  const s1 = await scale(page);
  // The point under the pointer stays under it.
  await expect
    .poll(async () => {
      const after = (await boxes(page, 0)).page;
      return Math.hypot(
        after.left + after.width * 0.3 - at.x,
        after.top + after.height * 0.4 - at.y,
      );
    })
    .toBeLessThan(3);

  await page.keyboard.down('Alt');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Alt');
  await expect.poll(() => scale(page)).toBeLessThan(s1);

  // The right button still opens the page menu with the tool on.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.getByRole('menuitemcheckbox', { name: 'Zoom to Area' })).toBeChecked();
  await page.keyboard.press('Escape');
});

test('Z held with Hand zooms to an area, and Hand is back when Z is released', async ({ page }) => {
  await open(page);
  await page.keyboard.press('h');
  await expect(host(page)).toHaveAttribute('data-tool', 'hand');
  const s0 = await scale(page);

  await page.keyboard.down('z');
  await expect(host(page)).toHaveAttribute('data-tool', 'zoomArea');
  const want = await dragOnPage(page, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.6 });
  await expect.poll(() => scale(page)).toBeCloseTo(want.zoom, 1);
  expect(await scale(page)).toBeGreaterThan(s0 * 2);
  await expect.poll(() => offCentre(page, want.f)).toBeLessThan(3);
  await page.keyboard.up('z');
  await expect(host(page)).toHaveAttribute('data-tool', 'hand');

  // Hand pans again: a drag scrolls the view, the zoom stays.
  const s1 = await scale(page);
  const before = await boxes(page, 0);
  const mid = { x: before.view.left + 300, y: before.view.top + 300 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 60, mid.y + 60, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await boxes(page, 0)).page.left)
    .toBeCloseTo(before.page.left + 60, -1);
  expect(await scale(page)).toBeCloseTo(s1, 3);
});
