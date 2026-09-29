import type { Page } from '@playwright/test';
import { snapSheet } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-18 (§7.4, ADR-008): with snapping on, the page's geometry is extracted in
// the Work worker and queried in the Snap worker; a distance drawn near known
// endpoints lands exactly on them.

const H = 600; // snapSheet is 600 × 600 pt: user y → EmbedPDF y = H − y
const measureTab = (page: Page) => page.getByRole('toolbar', { name: 'Measure commands' });

async function at(page: Page, x: number, yUser: number) {
  const box = await page.locator('[data-page="0"] .page-content').boundingBox();
  if (!box) throw new Error('page not laid out');
  const s = box.width / 600;
  return { x: box.x + x * s, y: box.y + (H - yUser) * s };
}

test('snapped distance: exact value between two known endpoints; Alt turns snapping off', async ({
  page,
}) => {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: 'snap.pdf', b64: Buffer.from(snapSheet()).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure' }).click();

  // 1:100 in metres, 4 decimals: the 100 pt rectangle edge is 3.5278 m.
  await measureTab(page).getByRole('button', { name: 'Set Scale' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set scale' });
  await dialog.getByLabel('Real').fill('100');
  await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
  await dialog.getByLabel('Decimal places').selectOption({ value: '4' });
  await dialog.getByRole('button', { name: 'Apply' }).click();

  const toggle = page.getByTestId('snap-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(measureTab(page).getByRole('button', { name: 'Enable Snapping' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(async () => {
      const st = (await cap(page, 'annotate', 'snap')) as { errors: unknown[] };
      if (st.errors.length) throw new Error(JSON.stringify(st.errors));
      return true;
    })
    .toBe(true);
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages[
          `${id}/0`
        ],
    )
    .toBe('ready');

  await measureTab(page).getByRole('button', { name: 'Distance', exact: true }).click();
  // Near (400, 450) and (500, 450): a few points off each corner.
  const a = await at(page, 403, 447);
  await page.mouse.move(a.x - 20, a.y - 20);
  await page.mouse.move(a.x, a.y, { steps: 4 });
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'endpoint');
  await page.mouse.down();
  const b = await at(page, 497, 452);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await expect(page.getByTestId('snap-marker')).toHaveAttribute('data-kind', 'endpoint');
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  await expect
    .poll(async () =>
      ((await cap(page, 'annotate', 'list', id)) as { type: number; contents: string | null }[])
        .filter((o) => o.type === 4)
        .map((o) => o.contents),
    )
    .toEqual(['3.5278 m']);

  // Alt held: no marker, no snapping.
  await page.keyboard.down('Alt');
  await page.mouse.move(a.x + 1, a.y + 1, { steps: 3 });
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await page.keyboard.up('Alt');

  // Snap kinds are toggles on the Measure tab.
  const endpoint = measureTab(page).getByRole('button', { name: 'Snap to Endpoint' });
  await expect(endpoint).toHaveAttribute('aria-pressed', 'true');
  await endpoint.click();
  await expect(endpoint).toHaveAttribute('aria-pressed', 'false');
});
