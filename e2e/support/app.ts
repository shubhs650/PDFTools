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
