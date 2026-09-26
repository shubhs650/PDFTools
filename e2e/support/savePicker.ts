import type { Page } from '@playwright/test';

/**
 * Replaces showSaveFilePicker with a fake handle that records what is
 * written (name and byte count), so a save runs end to end without a native
 * dialog. Read the record with `savedFiles(page)`.
 */
export async function stubSavePicker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      saved: { name: string; bytes: number }[];
      showSaveFilePicker: (o: { suggestedName?: string }) => Promise<unknown>;
    };
    w.saved = [];
    w.showSaveFilePicker = (o) => {
      const name = o.suggestedName ?? '';
      let bytes = 0;
      return Promise.resolve({
        name,
        createWritable: () =>
          Promise.resolve({
            write: (chunk: Blob | BufferSource) => {
              bytes += chunk instanceof Blob ? chunk.size : chunk.byteLength;
              return Promise.resolve();
            },
            close: () => {
              w.saved.push({ name, bytes });
              return Promise.resolve();
            },
            abort: () => Promise.resolve(),
          }),
      });
    };
  });
}

export const savedFiles = (page: Page): Promise<{ name: string; bytes: number }[]> =>
  page.evaluate(() => (window as unknown as { saved: { name: string; bytes: number }[] }).saved);
