import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { snapSheet } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M13-02·O2 (D-68, ADR-034): Line, Arrow, Polyline and Callout comments get
// the loupe (the Measure ribbon's Loupe toggle, on by default) and snapping:
// with snapping on, their points land on the page's geometry (the callout's
// arrow tip and knee; its box does not snap). Picking them does not turn
// snapping on; that stays with the measuring tools (P3).

const H = 600; // snapSheet is 600 × 600 pt: user y → EmbedPDF y = H − y
const commentTab = (page: Page) => page.getByRole('toolbar', { name: 'Comment commands' });
const loupe = (page: Page) => page.getByTestId('measure-loupe');
const toggle = (page: Page) => page.getByTestId('snap-toggle');

interface Obj {
  id: string;
  type: number;
  linePoints?: { start: { x: number; y: number }; end: { x: number; y: number } };
  vertices?: { x: number; y: number }[];
  calloutLine?: { x: number; y: number }[];
}

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
  await page.getByRole('tab', { name: 'Comment' }).click();
  return id;
}

async function snappingOn(page: Page, id: string): Promise<void> {
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages[
          `${id}/0`
        ],
    )
    .toBe('ready');
}

/** Moves near the user point (x, y) until the loupe shows the pointer snapped to an endpoint. */
async function snapNear(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const a = await at(page, x, y);
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
  await expect(page.getByTestId('measure-loupe-label')).toHaveText('Endpoint');
  return a;
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];

async function added(page: Page, id: string, before: string[]): Promise<Obj> {
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => !before.includes(o.id)).length)
    .toBe(1);
  const o = (await objects(page, id)).find((x) => !before.includes(x.id));
  if (!o) throw new Error('nothing drawn');
  return o;
}

const near = (p: { x: number; y: number } | undefined, x: number, y: number) => {
  expect(p?.x).toBeCloseTo(x, 1);
  expect(p?.y).toBeCloseTo(y, 1);
};

for (const name of ['Line', 'Arrow'])
  test(`${name}: the loupe shows the snap, both ends land on the rectangle's corners`, async ({
    page,
  }) => {
    const id = await open(page);
    await snappingOn(page, id);
    await commentTab(page).getByRole('button', { name, exact: true }).click();
    const a = await snapNear(page, 403, 447);
    await expect(loupe(page)).toBeVisible();
    const before = (await objects(page, id)).map((o) => o.id);
    await page.mouse.down();
    const b = await at(page, 497, 452);
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    const o = await added(page, id, before);
    near(o.linePoints?.start, 400, H - 450);
    near(o.linePoints?.end, 500, H - 450);
    expect(a).toBeDefined();
  });

test('Polyline: each vertex snaps; the loupe follows', async ({ page }) => {
  const id = await open(page);
  await snappingOn(page, id);
  await commentTab(page).getByRole('button', { name: 'Polyline', exact: true }).click();
  const before = (await objects(page, id)).map((o) => o.id);
  const a = await snapNear(page, 403, 447);
  await page.mouse.click(a.x, a.y);
  const b = await snapNear(page, 497, 452);
  await page.mouse.click(b.x, b.y);
  const c = await snapNear(page, 497, 403);
  await page.mouse.dblclick(c.x, c.y);
  const o = await added(page, id, before);
  near(o.vertices?.[0], 400, H - 450);
  near(o.vertices?.[1], 500, H - 450);
  near(o.vertices?.[2], 500, H - 400);
});

test('Callout: the arrow tip snaps (drag and three clicks), the box does not', async ({ page }) => {
  const id = await open(page);
  await snappingOn(page, id);
  const callout = commentTab(page).getByRole('button', { name: 'Callout', exact: true });
  // One drag from the point it marks to where its box goes.
  await callout.click();
  let before = (await objects(page, id)).map((o) => o.id);
  await snapNear(page, 403, 447);
  await page.mouse.down();
  const box = await at(page, 300, 530);
  await page.mouse.move(box.x, box.y, { steps: 8 });
  await page.mouse.up();
  let o = await added(page, id, before);
  near(o.calloutLine?.[0], 400, H - 450);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Three clicks: the tip and the knee snap.
  await callout.click();
  before = (await objects(page, id)).map((o2) => o2.id);
  const tip = await snapNear(page, 497, 403);
  await page.mouse.click(tip.x, tip.y);
  const knee = await snapNear(page, 497, 452);
  await page.mouse.click(knee.x, knee.y);
  const c1 = await at(page, 520, 520);
  const c2 = await at(page, 580, 560);
  await page.mouse.move(c1.x, c1.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(c2.x, c2.y, { steps: 5 });
  await page.mouse.up();
  o = await added(page, id, before);
  near(o.calloutLine?.[0], 500, H - 400);
  near(o.calloutLine?.[1], 500, H - 450);
});

test('picking a line comment tool leaves snapping as it was; the loupe shows without a snap', async ({
  page,
}) => {
  await open(page);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await commentTab(page).getByRole('button', { name: 'Line', exact: true }).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  const a = await at(page, 300, 300);
  await page.mouse.move(a.x - 10, a.y - 10);
  await page.mouse.move(a.x, a.y, { steps: 3 });
  await expect(loupe(page)).toBeVisible();
  await expect(page.getByTestId('measure-loupe-marker')).toHaveCount(0);
  // The Measure ribbon's Loupe toggle hides it for line comments too.
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Loupe', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await commentTab(page).getByRole('button', { name: 'Arrow', exact: true }).click();
  await page.mouse.move(a.x + 5, a.y + 5, { steps: 3 });
  await expect(loupe(page)).toHaveCount(0);
  // Rectangle is not a line comment: no loupe even with it on.
  await page.getByRole('tab', { name: 'Measure' }).click();
  await page
    .getByRole('toolbar', { name: 'Measure commands' })
    .getByRole('button', { name: 'Loupe', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await commentTab(page).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(a.x - 5, a.y - 5, { steps: 3 });
  await expect(loupe(page)).toHaveCount(0);
});

for (const dark of [false, true])
  test(`the loupe with a line comment passes axe (${dark ? 'dark' : 'light'}) @a11y`, async ({
    page,
  }) => {
    if (dark) await darkTheme(page);
    const id = await open(page);
    await snappingOn(page, id);
    await commentTab(page).getByRole('button', { name: 'Callout', exact: true }).click();
    await snapNear(page, 403, 447);
    const r = await new AxeBuilder({ page })
      .include('[role="toolbar"][aria-label="Comment commands"]')
      .include('[data-testid="measure-loupe"]')
      .analyze();
    expect(r.violations).toEqual([]);
  });
