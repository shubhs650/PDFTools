import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { drop } from './support/app.ts';
import { overlayDrawn, overlayOf, overlayView } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';

// M12-16 (D-59, ADR-032 route 2): the vector overlay. Compare → Export
// Overlay… writes the PDF overlay as a new vector PDF, one page per sheet,
// without attachments; the file reopens here with old red, new green and the
// same black. "Vector overlay (beta)" on the floating bar draws the sheet from
// that PDF's page instead of the two tinted revisions.

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Overlay controls' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export Overlay' });

interface Counts {
  red: number;
  green: number;
  black: number;
}

/** Counts a PNG's red, green and black pixels (decoded in the page). */
async function countPng(page: Page, png: Buffer): Promise<Counts> {
  return page.evaluate(
    async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      const out = { red: 0, green: 0, black: 0 };
      if (!g) return out;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] ?? 0;
        const gr = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        // At a fit zoom thin lines are smoothed: count where a colour dominates.
        if (r < 60 && gr < 60 && b < 60) out.black++;
        else if (r - gr > 80 && r - b > 80) out.red++;
        else if (gr - r > 80 && gr - b > 80) out.green++;
      }
      return out;
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
}

/** The overlay as drawn on screen (the window's top layer of tiles). */
async function overlayColours(page: Page): Promise<Counts> {
  return overlayView(page).evaluate((el) => {
    const layers = el.querySelectorAll('.overlay-tiles');
    const top = layers[layers.length - 1];
    const out = { red: 0, green: 0, black: 0 };
    if (!top) return out;
    for (const c of top.querySelectorAll('canvas')) {
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      const ctx = copy.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(c, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] ?? 0;
        const g = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        if (r < 60 && g < 60 && b < 60) out.black++;
        else if (r > 200 && g < 90 && b < 90) out.red++;
        else if (g > 200 && r < 90 && b < 90) out.green++;
      }
    }
    return out;
  });
}

async function openExport(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: 'Export Overlay…' }).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}

test('Export Overlay… writes a vector PDF that reopens with old red, new green and the same black @smoke', async ({
  page,
}) => {
  // The download path (no save picker): the bytes are read back here.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await overlayOf(page, '01');
  const d = await openExport(page);
  await expect(d.getByRole('radio', { name: 'All sheets (1)' })).toBeChecked();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  const download = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Export…' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Pair 01 RevA vs Pair 01 RevB (overlay).pdf');
  await expect(dialog(page)).toHaveCount(0);
  const bytes = readFileSync(await file.path());
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  // A plain PDF: no attachments (that is Save comparison…), not encrypted.
  expect(text).not.toContain('/EmbeddedFiles');
  expect(text).not.toContain('/Encrypt');
  expect(text).toMatch(/\/Count 1\b/);

  // Reopened here: the overlay is in the page itself.
  await drop(page, [{ name: 'overlay.pdf', b64: bytes.toString('base64') }]);
  await expect(page.getByRole('tab', { name: /overlay\.pdf/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const first = page.locator('#document-panel .page[data-page="0"]').first();
  await expect(first.locator('.page-tiles img').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300); // the sharp tiles replace the preview
  const c = await countPng(page, await first.screenshot());
  expect(c.red).toBeGreaterThan(100);
  expect(c.green).toBeGreaterThan(100);
  expect(c.black).toBeGreaterThan(1000);
});

test('Export Overlay… can export the sheet shown; Close leaves without a file', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await overlayOf(page, '07');
  let d = await openExport(page);
  await expect(d.getByRole('radio', { name: 'All sheets (2)' })).toBeChecked();
  await d.locator('button:not(.ui-dialog-close)', { hasText: 'Close' }).click();
  await expect(dialog(page)).toHaveCount(0);

  d = await openExport(page);
  await d.getByRole('radio', { name: 'The sheet shown' }).check();
  const download = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Export…' }).click();
  const bytes = readFileSync(await (await download).path());
  expect(bytes.toString('latin1')).toMatch(/\/Count 1\b/);
});

test('Export Overlay… is off outside a PDF overlay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  const button = page.getByRole('button', { name: 'Export Overlay…' });
  await expect(button).toBeDisabled();
});

test('Vector overlay (beta) draws the sheet from the vector PDF, with the same colours', async ({
  page,
}) => {
  await overlayOf(page, '01');
  await expect(overlayView(page)).toHaveAttribute('data-display', 'raster');
  const screen = await overlayColours(page);
  const vector = bar(page).getByRole('button', { name: /^Vector overlay \(beta\)/ });
  await vector.click();
  await expect(vector).toHaveAttribute('aria-pressed', 'true');
  await expect(overlayView(page)).toHaveAttribute('data-display', 'vector', { timeout: 20_000 });
  await overlayDrawn(page);
  const drawn = await overlayColours(page);
  expect(drawn.red).toBeGreaterThan(screen.red * 0.7);
  expect(drawn.red).toBeLessThan(screen.red * 1.3 + 50);
  expect(drawn.green).toBeGreaterThan(screen.green * 0.7);
  expect(drawn.green).toBeLessThan(screen.green * 1.3 + 50);
  expect(drawn.black).toBeGreaterThan(screen.black * 0.6);

  // The screen drawing's own controls are off.
  await expect(bar(page).getByRole('button', { name: 'Fade unchanged' })).toBeDisabled();
  await expect(bar(page).getByRole('button', { name: /^Thicken thin lines/ })).toBeDisabled();
  await expect(bar(page).getByRole('slider', { name: /^Balance/ })).toBeDisabled();
  await expect(bar(page).getByRole('button', { name: /^Blink/ })).toBeDisabled();

  // Show and hide still apply: without the old revision, no red.
  await bar(page).getByRole('button', { name: 'Show Document A (old)' }).click();
  await overlayDrawn(page);
  await expect(overlayView(page)).toHaveAttribute('data-display', 'vector');
  expect((await overlayColours(page)).red).toBe(0);
  await bar(page).getByRole('button', { name: 'Show Document A (old)' }).click();

  // Back to the usual drawing.
  await vector.click();
  await expect(overlayView(page)).toHaveAttribute('data-display', 'raster');
  await overlayDrawn(page);
  await expect(bar(page).getByRole('button', { name: 'Fade unchanged' })).toBeEnabled();
});
