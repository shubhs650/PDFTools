import type { Page } from '@playwright/test';
import { drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M10-08·O5 (ADR-027): a page or thumbnail that is still rendering shows a soft
// shimmer instead of blank white. It sits inside the page or thumbnail frame (no
// layout change), the image replaces it, and prefers-reduced-motion keeps a still
// tint. A heavy A0 sheet keeps the renders busy long enough to see it; a
// MutationObserver records each placeholder as it appears, so the checks never race
// the render.

interface Seen {
  where: 'page' | 'thumb';
  shimmer: string;
  shimmerShown: string;
  delay: string;
  fills: boolean;
}

async function watchPlaceholders(page: Page) {
  await page.addInitScript(() => {
    const seen: Seen[] = [];
    (window as unknown as { __placeholders: Seen[] }).__placeholders = seen;
    const record = (el: Element) => {
      const parent = el.parentElement;
      const box = el as HTMLElement;
      if (!parent) return;
      const after = getComputedStyle(el, '::after');
      seen.push({
        where: el.closest('[data-page]') ? 'page' : 'thumb',
        shimmer: after.animationName,
        shimmerShown: after.display,
        delay: getComputedStyle(el).animationDelay,
        // Layout boxes (the page's rotation is a transform): the frame's inside, exactly.
        fills:
          box.offsetParent === parent &&
          box.offsetLeft === 0 &&
          box.offsetTop === 0 &&
          box.offsetWidth === parent.clientWidth &&
          box.offsetHeight === parent.clientHeight,
      });
    };
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches('.ui-placeholder')) record(n);
          for (const el of n.querySelectorAll('.ui-placeholder')) record(el);
        }
    }).observe(document, { childList: true, subtree: true });
  });
}

const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __placeholders: Seen[] }).__placeholders);

async function openHeavy(page: Page, b64: string) {
  await watchPlaceholders(page);
  await page.goto('/');
  await skipReviewerPrompt(page);
  await drop(page, [{ name: 'sheet.pdf', b64 }]);
}

test.describe('with motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('pages and thumbnails shimmer until their image arrives, then the shimmer is gone @smoke', async ({
    page,
    pdfs,
  }) => {
    await openHeavy(page, pdfs.a0(200_000, 3).toString('base64'));
    await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
    await expect(page.locator('.thumb-img').first()).toBeVisible();

    const all = await seen(page);
    const pages = all.filter((s) => s.where === 'page');
    const thumbs = all.filter((s) => s.where === 'thumb');
    expect(pages.length).toBeGreaterThan(0);
    expect(thumbs.length).toBeGreaterThan(0);
    for (const s of all) {
      // The sweep runs, after the short wait that spares cached pages a flash.
      expect(s).toMatchObject({ shimmer: 'ui-shimmer', shimmerShown: 'block', delay: '0.2s' });
      // It fills the page or thumbnail frame exactly: nothing moves.
      expect(s.fills).toBe(true);
    }

    // Each image replaces its placeholder, so no shimmer keeps running.
    await expect(page.locator('[data-page="0"] .ui-placeholder')).toHaveCount(0);
    await expect(page.locator('.ui-placeholder')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.thumb-image')).toHaveCount(
      await page.locator('.thumb-img').count(),
    );
    // Placeholders are decoration, like the page images (alt="").
    expect(
      await page.evaluate(
        () => document.querySelectorAll('.ui-placeholder:not([aria-hidden="true"])').length,
      ),
    ).toBe(0);
  });
});

test('with reduced motion the placeholder is a still tint (no shimmer)', async ({ page, pdfs }) => {
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
  await openHeavy(page, pdfs.a0(200_000, 2).toString('base64'));
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const all = await seen(page);
  expect(all.length).toBeGreaterThan(0);
  for (const s of all) expect(s).toMatchObject({ shimmer: 'none', shimmerShown: 'none' });
  await expect(page.locator('.ui-placeholder')).toHaveCount(0, { timeout: 30_000 });
});
