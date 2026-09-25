import type { Page } from '@playwright/test';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-16: single, continuous, facing, continuous facing; rotate view.

interface Doc {
  view: { page: number; mode: string; rotation: number };
  dirty: boolean;
}

async function doc(page: Page): Promise<Doc> {
  const { activeId } = (await cap(page, 'open', 'state')) as { activeId: string };
  const d = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: {
              stores: { documents: { getState(): { docs: Record<string, Doc> } } };
            };
          };
        }
      ).__pdftoolsTest.capabilities.stores.documents.getState().docs[id] ?? null,
    activeId,
  );
  if (!d) throw new Error('no active document');
  return d;
}

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const modes = (page: Page) => status(page).getByRole('group', { name: 'View mode' });
const pageBox = (page: Page) => status(page).getByRole('textbox', { name: 'Page number' });
const viewport = (page: Page) => page.getByTestId('document-view');
const shownPages = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector('[data-testid="document-view"]')?.getBoundingClientRect();
    if (!v) return [];
    return [...document.querySelectorAll<HTMLElement>('[data-page]:not([data-hidden])')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > v.top && r.top < v.bottom;
      })
      .map((el) => Number(el.dataset.page));
  });

async function open(page: Page, pdfs: { contract(n?: number): Buffer }) {
  await page.goto('/');
  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(50).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await pageBox(page).fill('25');
  await pageBox(page).press('Enter');
  await expect(pageBox(page)).toHaveValue('25');
}

test('switching modes keeps the current page in view and the document clean', async ({
  page,
  pdfs,
}) => {
  await open(page, pdfs);
  for (const [name, mode] of [
    ['Single Page', 'single'],
    ['Facing', 'facing'],
    ['Continuous Facing', 'continuousFacing'],
    ['Continuous', 'continuous'],
  ] as const) {
    const button = modes(page).getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await doc(page)).view.mode).toBe(mode);
    await expect.poll(() => shownPages(page)).toContain(24);
    expect([24, 25]).toContain((await doc(page)).view.page);
    expect((await doc(page)).dirty).toBe(false);
  }
});

test('single page shows one page; facing shows its spread; PageDown turns the page', async ({
  page,
  pdfs,
}) => {
  await open(page, pdfs);
  await modes(page).getByRole('button', { name: 'Single Page', exact: true }).click();
  await expect.poll(() => shownPages(page)).toEqual([24]);
  await viewport(page).focus();
  await page.keyboard.press('PageDown');
  await expect(pageBox(page)).toHaveValue('26');
  await expect.poll(() => shownPages(page)).toEqual([25]);

  // Facing pairs 1–2, 3–4, …: page 26 (index 25) is shown with page 25 (index 24).
  await modes(page).getByRole('button', { name: 'Facing', exact: true }).click();
  await expect.poll(() => shownPages(page)).toEqual([24, 25]);
  await viewport(page).focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => shownPages(page)).toEqual([26, 27]);
  await status(page).getByRole('button', { name: 'Previous Page' }).click();
  await expect.poll(() => shownPages(page)).toEqual([24, 25]);

  // The wheel scrolls within the page and turns it at the edge.
  await modes(page).getByRole('button', { name: 'Single Page', exact: true }).click();
  await expect.poll(() => shownPages(page)).toHaveLength(1);
  const before = (await doc(page)).view.page;
  const box = await viewport(page).boundingBox();
  if (!box) throw new Error('no viewport');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30 && (await doc(page)).view.page === before; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(60);
  }
  expect((await doc(page)).view.page).toBe(before + 1);
});

test('our spreads match the spread plugin', async ({ page, pdfs }) => {
  await page.goto('/');
  await drop(page, [{ name: 'five.pdf', b64: pdfs.simple(5).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await modes(page).getByRole('button', { name: 'Continuous Facing', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rows = new Map<number, number[]>();
        for (const el of document.querySelectorAll<HTMLElement>('[data-page]')) {
          const top = Math.round(el.getBoundingClientRect().top);
          rows.set(top, [...(rows.get(top) ?? []), Number(el.dataset.page)]);
        }
        return [...rows.values()].map((r) => r.sort((a, b) => a - b));
      }),
    )
    .toEqual([[0, 1], [2, 3], [4]]);
});

test('rotate view turns the page box, keeps the page, and never dirties the document', async ({
  page,
  pdfs,
}) => {
  await open(page, pdfs);
  const size = () =>
    page.locator('[data-page="24"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
  await page.getByRole('tab', { name: 'View' }).click();
  const toolbar = page.getByRole('toolbar', { name: 'View' });
  const portrait = await size();
  expect(portrait.h).toBeGreaterThan(portrait.w);
  await toolbar.getByRole('button', { name: 'Rotate View Clockwise' }).click();
  await expect.poll(async () => (await doc(page)).view.rotation).toBe(90);
  // Fit width refits the zoom, so compare the aspect, not the size.
  await expect
    .poll(async () => {
      const s = await size();
      return s.w > s.h;
    })
    .toBe(true);
  await expect.poll(() => shownPages(page)).toContain(24);
  await expect(page.locator('[data-page="24"] img.page-preview')).toBeVisible();
  await toolbar.getByRole('button', { name: 'Rotate View Counterclockwise' }).click();
  await toolbar.getByRole('button', { name: 'Rotate View Counterclockwise' }).click();
  await expect.poll(async () => (await doc(page)).view.rotation).toBe(270);
  expect((await doc(page)).dirty).toBe(false);
  expect(await cap(page, 'view', 'blankVisiblePages')).toBe(0);
});
