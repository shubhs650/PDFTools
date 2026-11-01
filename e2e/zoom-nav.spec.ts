import type { Page } from '@playwright/test';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-15: zoom, page navigation, Hand and Select.

interface View {
  page: number;
  zoom: number | string;
  scale: number;
}

async function viewState(page: Page): Promise<View> {
  const s = (await cap(page, 'open', 'state')) as { activeId: string };
  const view = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: {
              stores: { documents: { getState(): { docs: Record<string, { view: View }> } } };
            };
          };
        }
      ).__pdftoolsTest.capabilities.stores.documents.getState().docs[id]?.view ?? null,
    s.activeId,
  );
  if (!view) throw new Error('no active document');
  return view;
}

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const zoomBox = (page: Page) => status(page).getByRole('textbox', { name: 'Zoom' });
const pageBox = (page: Page) => status(page).getByRole('textbox', { name: 'Page number' });
const viewport = (page: Page) => page.getByTestId('document-view');
const settle = (page: Page) => cap(page, 'view', 'settle');

async function openContract(page: Page, pdfs: { contract(n?: number): Buffer }, pages = 50) {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(pages).toString('base64') }]);
  await expect(viewport(page)).toBeVisible();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await expect(pageBox(page)).toHaveValue('1');
  await expect(status(page)).toContainText(`of ${String(pages)}`);
}

test('zoom shortcuts, the zoom box, the level menu and the 1 %–6400 % clamp @smoke', async ({
  page,
  pdfs,
}) => {
  await openContract(page, pdfs);
  expect((await viewState(page)).zoom).toBe('fitWidth');
  await viewport(page).focus();

  await page.keyboard.press('Control+1');
  await expect(zoomBox(page)).toHaveValue('100%');
  expect((await viewState(page)).zoom).toBe(1);
  await page.keyboard.press('Control+=');
  await expect(zoomBox(page)).toHaveValue('125%');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await expect(zoomBox(page)).toHaveValue('75%');
  await page.keyboard.press('Control+0');
  await expect.poll(async () => (await viewState(page)).zoom).toBe('fitPage');
  await page.keyboard.press('Control+2');
  await expect.poll(async () => (await viewState(page)).zoom).toBe('fitWidth');
  const fitWidth = (await viewState(page)).scale;

  await zoomBox(page).fill('250');
  await zoomBox(page).press('Enter');
  await expect(zoomBox(page)).toHaveValue('250%');
  await zoomBox(page).fill('9000 %');
  await zoomBox(page).press('Enter');
  await expect(zoomBox(page)).toHaveValue('6,400%');
  await zoomBox(page).fill('0.5');
  await zoomBox(page).press('Enter');
  await expect(zoomBox(page)).toHaveValue('1%');
  await viewport(page).focus();
  await page.keyboard.press('Control+-');
  await expect(zoomBox(page)).toHaveValue('1%');
  await zoomBox(page).fill('abc');
  await zoomBox(page).press('Enter');
  await expect(zoomBox(page)).toHaveAttribute('aria-invalid', 'true');
  await zoomBox(page).press('Escape');
  await expect(zoomBox(page)).toHaveValue('1%');

  // Fit visible fits the content (text block), so it zooms in past fit width.
  await status(page).getByRole('button', { name: 'Zoom levels' }).click();
  await page.getByRole('menuitem', { name: 'Fit Visible' }).click();
  await expect.poll(async () => (await viewState(page)).zoom).toBe('fitVisible');
  expect((await viewState(page)).scale).toBeGreaterThan(fitWidth * 1.1);
  await status(page).getByRole('button', { name: 'Zoom levels' }).click();
  await page.getByRole('menuitem', { name: '200%' }).click();
  await expect(zoomBox(page)).toHaveValue('200%');

  // Ribbon buttons run the same commands.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page
    .getByRole('toolbar', { name: 'Home' })
    .getByRole('button', { name: 'Zoom In' })
    .click();
  await expect(zoomBox(page)).toHaveValue('300%');
});

test('Ctrl+wheel zooms at the pointer: the point under it stays put', async ({ page, pdfs }) => {
  await openContract(page, pdfs);
  // Start wider than the viewport: while a page is narrower it stays centred,
  // so only the vertical position could be kept.
  await zoomBox(page).fill('200');
  await zoomBox(page).press('Enter');
  await expect(zoomBox(page)).toHaveValue('200%');
  await settle(page);
  const box = await viewport(page).boundingBox();
  if (!box) throw new Error('no viewport');
  const at = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.4 };
  // Where the pointer is, in page-0 points.
  const docPoint = () =>
    page.evaluate(({ x, y }) => {
      const el = document.querySelector('[data-page="0"]');
      const r = el?.getBoundingClientRect();
      if (!r) return null;
      const scale = r.width / 612;
      return { x: (x - r.left) / scale, y: (y - r.top) / scale };
    }, at);
  const before = await docPoint();
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await viewState(page)).scale).toBeGreaterThan(2.3);
  await settle(page);
  const after = await docPoint();
  expect(before && after).toBeTruthy();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(3);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(3);
});

test('page navigation: buttons, the page box, Home/End in the document', async ({ page, pdfs }) => {
  await openContract(page, pdfs);
  const bar = status(page);
  await bar.getByRole('button', { name: 'Next Page' }).click();
  await expect(pageBox(page)).toHaveValue('2');
  await bar.getByRole('button', { name: 'Last Page' }).click();
  await expect(pageBox(page)).toHaveValue('50');
  await bar.getByRole('button', { name: 'Previous Page' }).click();
  await expect(pageBox(page)).toHaveValue('49');
  await bar.getByRole('button', { name: 'First Page' }).click();
  await expect(pageBox(page)).toHaveValue('1');

  await pageBox(page).fill('25');
  await pageBox(page).press('Enter');
  await expect(pageBox(page)).toHaveValue('25');
  await expect(page.locator('[data-page="24"] img.page-preview')).toBeVisible();
  for (const bad of ['0', '51', 'x', '2.5']) {
    await pageBox(page).fill(bad);
    await pageBox(page).press('Enter');
    await expect(pageBox(page)).toHaveAttribute('aria-invalid', 'true');
  }
  await pageBox(page).press('Escape');
  await expect(pageBox(page)).toHaveValue('25');

  await viewport(page).focus();
  await page.keyboard.press('End');
  await expect(pageBox(page)).toHaveValue('50');
  await page.keyboard.press('Home');
  await expect(pageBox(page)).toHaveValue('1');
  await page.keyboard.press('PageDown');
  await expect.poll(() => viewport(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
});

test('Hand drag-pans, Space switches to Hand while held, Esc returns to Select', async ({
  page,
  pdfs,
}) => {
  await openContract(page, pdfs);
  const host = page.locator('.document-host');
  await expect(host).toHaveAttribute('data-tool', 'select');
  await viewport(page).focus();
  await page.keyboard.press('h');
  await expect(host).toHaveAttribute('data-tool', 'hand');
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(
    page.getByRole('toolbar', { name: 'Home' }).getByRole('button', { name: 'Hand' }),
  ).toHaveAttribute('aria-pressed', 'true');

  const box = await viewport(page).boundingBox();
  if (!box) throw new Error('no viewport');
  const top = () => viewport(page).evaluate((el) => el.scrollTop);
  const start = await top();
  await page.mouse.move(box.x + 300, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  expect((await top()) - start).toBeGreaterThan(250);

  await viewport(page).focus();
  await page.keyboard.press('Escape');
  await expect(host).toHaveAttribute('data-tool', 'select');

  await viewport(page).focus();
  await page.keyboard.down(' ');
  await expect(host).toHaveAttribute('data-tool', 'hand');
  const beforeSpace = await top();
  await page.keyboard.up(' ');
  await expect(host).toHaveAttribute('data-tool', 'select');
  expect(await top()).toBe(beforeSpace); // Space did not scroll the page
  await page.keyboard.press('v');
  await expect(host).toHaveAttribute('data-tool', 'select');
});

// Long tasks and timings for this scenario are gated in e2e/perf/zoom.spec.ts.
test('zoom to 6400 % on the A0 sheet: sharp tiles after it settles', async ({ page, pdfs }) => {
  await page.goto('/');
  await drop(page, [{ name: 'a0.pdf', b64: pdfs.a0(20_000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await settle(page);
  for (const z of ['800', '6400', '100']) {
    await zoomBox(page).fill(z);
    await zoomBox(page).press('Enter');
    await expect(zoomBox(page)).toHaveValue(z === '6400' ? '6,400%' : `${z}%`);
    await settle(page);
    expect(await cap(page, 'view', 'sharpVisiblePages')).toBeGreaterThan(0);
    expect(await cap(page, 'view', 'blankVisiblePages')).toBe(0);
  }
});
