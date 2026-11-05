// Helpers for driving the app in e2e tests: test-hook capabilities (M1-Q3) and
// opening files by drag-and-drop.
import type { Page } from '@playwright/test';

type Caps = Record<string, Record<string, (...x: unknown[]) => unknown>>;

/** Calls `window.__pdftoolsTest.capabilities[name][method](...args)`. */
export async function cap(
  page: Page,
  name: string,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  await page.waitForFunction(
    (n) =>
      Boolean(
        (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
          .__pdftoolsTest?.capabilities[n],
      ),
    name,
  );
  return page.evaluate(
    ([n, m, a]) =>
      (window as unknown as { __pdftoolsTest: { capabilities: Caps } }).__pdftoolsTest.capabilities[
        n
      ]?.[m]?.(...a),
    [name, method, args] as const,
  );
}

export interface DropFile {
  name: string;
  b64: string;
  type?: string;
}

/** Builds the Files in the page first, so decoding test data is not measured as app work. */
export async function stage(page: Page, files: DropFile[]): Promise<void> {
  await page.evaluate((fs) => {
    (window as unknown as { __staged: File[] }).__staged = fs.map((f) => {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      return new File([bytes], f.name, { type: f.type ?? 'application/pdf' });
    });
  }, files);
}

/** Drops the staged files on the document area, as a user dragging them in would. */
export async function dropStaged(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    for (const f of (window as unknown as { __staged: File[] }).__staged) dt.items.add(f);
    const target = document.getElementById('document-panel') ?? document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
    }
  });
}

export async function drop(page: Page, files: DropFile[]): Promise<void> {
  await stage(page, files);
  await dropStaged(page);
}

/**
 * Starts watching, in the page, for page 1's preview image to load and be
 * painted (the frame after its `load`). Playwright's own waits poll with a
 * growing interval (up to 500 ms), so "first page visible" timed from them
 * measures the polling as much as the app. Call before dropping the file.
 */
export async function watchFirstPreview(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __firstPreviewAt: number | null };
    w.__firstPreviewAt = null;
    const seen = new WeakSet<HTMLImageElement>();
    const painted = (): void => {
      requestAnimationFrame(() => {
        w.__firstPreviewAt ??= performance.now();
      });
    };
    const check = (): void => {
      const img = document.querySelector<HTMLImageElement>('[data-page="0"] img.page-preview');
      if (!img || seen.has(img)) return;
      seen.add(img);
      if (img.complete && img.naturalWidth > 0) painted();
      else img.addEventListener('load', painted, { once: true });
    };
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  });
}

/** When page 1's preview was first painted (page time, ms), waiting for it. */
export async function firstPreviewAt(page: Page): Promise<number> {
  const handle = await page.waitForFunction(
    () => (window as unknown as { __firstPreviewAt: number | null }).__firstPreviewAt,
  );
  const at = await handle.jsonValue();
  if (at === null) throw new Error('no first preview');
  return at;
}

/** The theme's localStorage key (src/app/theme.ts, M7-11). */
export const THEME_KEY = 'pdftools.theme';

/**
 * Starts every page load of this test in the dark theme, as the theme toggle
 * leaves it stored on the device (M7-11, D-42). Call before `page.goto`.
 */
export async function darkTheme(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'dark');
  }, THEME_KEY);
}
