import type { Page } from '@playwright/test';

/**
 * Counts print() calls on print frames instead of opening a dialog (headless
 * Chromium has none). Call before page.goto: it watches for new iframes.
 */
export async function stubFramePrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { printCalls: number };
    w.printCalls = 0;
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes)
          if (n instanceof HTMLIFrameElement && n.contentWindow)
            n.contentWindow.print = () => {
              w.printCalls++;
            };
    }).observe(document, { childList: true, subtree: true });
  });
}

export const printCalls = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { printCalls: number }).printCalls);
