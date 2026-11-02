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
      const handle = {
        name,
        // Opening the written file in a new tab compares it with the open ones' handles.
        isSameEntry: (other: unknown) => Promise.resolve(other === handle),
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
      };
      return Promise.resolve(handle);
    };
  });
}

export const savedFiles = (page: Page): Promise<{ name: string; bytes: number }[]> =>
  page.evaluate(() => (window as unknown as { saved: { name: string; bytes: number }[] }).saved);

/**
 * Replaces showDirectoryPicker with a fake folder that records every file
 * written into it (path from the chosen folder and byte count), including
 * sub-folders. Read the record with `folderFiles(page)`.
 */
export async function stubFolderPicker(page: Page, existing: string[] = []): Promise<void> {
  await page.evaluate((names) => {
    const w = window as unknown as {
      folderFiles: { path: string; bytes: number }[];
      showDirectoryPicker: () => Promise<unknown>;
    };
    w.folderFiles = [];
    const dir = (path: string, initial: string[]): unknown => {
      const entries = new Set(initial);
      return {
        name: path.split('/').pop() ?? '',
        keys: async function* () {
          for (const n of entries) yield await Promise.resolve(n);
        },
        getDirectoryHandle: (name: string) => {
          entries.add(name);
          return Promise.resolve(dir(path ? `${path}/${name}` : name, []));
        },
        getFileHandle: (name: string) => {
          entries.add(name);
          const full = path ? `${path}/${name}` : name;
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
                  w.folderFiles.push({ path: full, bytes });
                  return Promise.resolve();
                },
                abort: () => Promise.resolve(),
              }),
          });
        },
      };
    };
    w.showDirectoryPicker = () => Promise.resolve(dir('', names));
  }, existing);
}

export const folderFiles = (page: Page): Promise<{ path: string; bytes: number }[]> =>
  page.evaluate(
    () => (window as unknown as { folderFiles: { path: string; bytes: number }[] }).folderFiles,
  );
