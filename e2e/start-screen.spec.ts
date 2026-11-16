import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M10-05 (ADR-027 D-47; review R6, R8, R15): the start screen is a centred column (drop
// card, quick actions, Recent files) and the empty document-tab strip collapses.

const start = (page: Page) => page.getByTestId('start-screen');
const dropCard = (page: Page) => page.getByTestId('start-drop');
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' });

/** Files dragged over the window (no drop yet). */
async function dragIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' }));
    for (const type of ['dragenter', 'dragover'])
      window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, cancelable: true }));
  });
}

async function dragOut(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' }));
    window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt }));
  });
}

for (const theme of ['light', 'dark'] as const)
  test(`the start screen: drop card, quick actions, Recent files, no empty tab strip (${theme}) @smoke`, async ({
    page,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    await page.goto('/');
    await expect(start(page)).toBeVisible();

    // R8: nothing open, so no tab strip; the panel starts right under the banner's ribbon.
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.locator('.tab-strip')).toHaveCount(0);

    const card = dropCard(page);
    await expect(card.getByRole('heading', { name: 'Open a PDF to get started' })).toBeVisible();
    const open = card.getByRole('button', { name: 'Open…' });
    await expect(open).toHaveAccessibleName('Open…'); // the shortcut is shown, not read twice
    await expect(open).toContainText('Ctrl+O');
    await expect(card).toContainText('Your files stay on this device.');

    const actions = start(page).getByRole('list', { name: 'Quick actions' });
    await expect(actions.getByRole('button')).toHaveText([
      /Create blank PDF/, // M10-08·O4
      /Merge files/,
      /Getting started/,
      /Keyboard shortcuts/,
    ]);
    await expect(actions.getByRole('button', { name: 'Merge files' })).toHaveAccessibleDescription(
      'Combine PDFs into one',
    );
    await expect(start(page).getByRole('region', { name: 'Recent files' })).toBeVisible();

    // A centred column: the drop card, actions and Recent share their left and right edges.
    const boxes = await Promise.all(
      [card, actions, start(page).getByTestId('recent-list')].map(async (l) => l.boundingBox()),
    );
    const [c, a, r] = boxes.map((b) => b ?? { x: 0, y: 0, width: 0, height: 0 });
    for (const b of [a, r]) {
      expect(Math.abs((b?.x ?? 0) - (c?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((b?.width ?? 0) - (c?.width ?? 0))).toBeLessThanOrEqual(1);
    }
    const panel = (await start(page).boundingBox()) ?? { x: 0, width: 0 };
    const mid = (c?.x ?? 0) + (c?.width ?? 0) / 2;
    expect(Math.abs(mid - (panel.x + panel.width / 2))).toBeLessThanOrEqual(2);

    expect(
      (
        await new AxeBuilder({ page }).include('[data-testid="start-screen"]').analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
  });

test('quick actions open Merge Files, Help at its start page and the shortcut sheet; keyboard reaches each @smoke', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const open = dropCard(page).getByRole('button', { name: 'Open…' });
  await open.focus();
  // Open, then the four actions, in reading order (Create blank PDF first, M10-08·O4).
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create blank PDF' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Merge files' })).toBeFocused();
  await page.keyboard.press('Enter');
  const merge = page.getByRole('dialog', { name: 'Merge Files' });
  await expect(merge).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(merge).toBeHidden();

  await page.getByRole('button', { name: 'Keyboard shortcuts' }).focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Getting started' }).click();
  const help = await popup;
  await help.waitForLoadState();
  await expect(help).toHaveURL(/\/help#welcome$/);
});

test('the tab strip appears with the first document and collapses after the last closes @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.tab-strip')).toHaveCount(0);
  const before = (await page.locator('#document-panel').boundingBox())?.y ?? 0;

  await drop(page, [{ name: 'one.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
  const withTabs = (await page.locator('#document-panel').boundingBox())?.y ?? 0;
  expect(withTabs).toBeGreaterThan(before + 20); // the strip takes its row again

  await page.getByRole('button', { name: 'Close one.pdf' }).click();
  await expect(start(page)).toBeVisible();
  await expect(page.locator('.tab-strip')).toHaveCount(0);
  expect((await page.locator('#document-panel').boundingBox())?.y ?? 0).toBe(before);
});

test('dragging files over the window highlights the drop card; with a document, the overlay card shows @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await dragIn(page);
  await expect(dropCard(page)).toHaveAttribute('data-over', '');
  await expect(dropCard(page)).toContainText('Drop PDF files to open them');
  const overlay = page.locator('.drop-overlay');
  await expect(overlay).toHaveAttribute('data-start', '');
  await expect(overlay.locator('.drop-overlay-card')).toHaveCount(0);
  await dragOut(page);
  await expect(dropCard(page)).not.toHaveAttribute('data-over');
  await expect(overlay).toHaveCount(0);

  await drop(page, [{ name: 'one.pdf', b64: Buffer.from(simplePdf(1)).toString('base64') }]);
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
  await dragIn(page);
  await expect(overlay).not.toHaveAttribute('data-start');
  await expect(overlay.locator('.drop-overlay-card')).toHaveText('Drop PDF files to open them');
});

test('Recent files on the start screen: a card with name, size and when', async ({ page }) => {
  await page.goto('/');
  await cap(page, 'open', 'showRecent', [
    { name: 'Site plan rev C.pdf', size: 2_480_000, agoMinutes: 3 },
    { name: 'Pump datasheet.pdf', size: 312_000, agoMinutes: 95 },
  ]);
  const items = start(page).getByTestId('recent-list').getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Site plan rev C.pdf');
  await expect(items.nth(0)).toContainText('2.5 MB');
  await expect(items.nth(0)).toContainText('3 minutes ago');
  await expect(items.nth(1)).toContainText('312 kB');
  await expect(start(page).getByRole('button', { name: /^Site plan rev C\.pdf/ })).toBeVisible();
});

test('forced-colors and reduced motion: system-coloured frames, no transitions', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/');
  const look = await dropCard(page).evaluate((card) => {
    const badge = card.querySelector('.start-badge');
    const b = badge ? getComputedStyle(badge) : null;
    const s = getComputedStyle(card);
    return {
      cardBorder: s.borderTopStyle,
      cardDuration: s.transitionDuration,
      badgeBorder: b?.borderTopStyle,
      badgeDuration: b?.transitionDuration,
    };
  });
  expect(look.cardBorder).toBe('dashed');
  expect(look.badgeBorder).toBe('solid');
  expect(look.cardDuration.split(',').every((d) => d.trim() === '0s')).toBe(true);
  expect(look.badgeDuration).toBe('0s');
  await dragIn(page);
  await expect(dropCard(page)).toHaveAttribute('data-over', '');
  const over = await dropCard(page).evaluate((card) => getComputedStyle(card).borderTopColor);
  const rest = await start(page)
    .getByTestId('recent-list')
    .evaluate((r) => getComputedStyle(r).color);
  expect(over).not.toBe(rest); // Highlight, not the text colour
});
