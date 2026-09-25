import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M1-12: OPFS recovery store in the storage worker, fingerprints off the main
// thread, and the FSA append path with abort (Chromium).

async function storage(page: Page, method: string, ...args: unknown[]): Promise<unknown> {
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __pdftoolsTest?: { capabilities: Record<string, unknown> } })
        .__pdftoolsTest?.capabilities.storage,
    ),
  );
  return page.evaluate(
    ([m, a]) => {
      const p = (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: Record<string, Record<string, (...x: unknown[]) => unknown>>;
          };
        }
      ).__pdftoolsTest.capabilities.storage;
      return p?.[m]?.(...a);
    },
    [method, args] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await storage(page, 'clearAll');
});

test('OPFS round trip from the worker: put original, write tails, list, read, discard', async ({
  page,
  guard,
}) => {
  await guard.startMeasuring();
  const fp = (await storage(page, 'fingerprint', '%PDF-1.7 original')) as string;
  expect(fp).toMatch(/^[0-9a-f]{64}$/);
  expect(await storage(page, 'fingerprint', '%PDF-1.7 original')).toBe(fp);

  const put = (await storage(page, 'putOriginal', fp, '%PDF-1.7 original')) as {
    size: number;
    progress: number[];
  };
  expect(put.size).toBe(17);
  // Stored once: a second put is a no-op.
  expect((await storage(page, 'putOriginal', fp, 'something else')) as { size: number }).toEqual({
    size: 17,
    progress: [],
  });

  await storage(page, 'writeTail', fp, 'tail-1', { page: 3, zoom: 1.5 });
  await storage(page, 'writeTail', fp, 'tail-2-longer');
  const list = (await storage(page, 'list')) as {
    fp: string;
    originalBytes: number;
    tailBytes: number;
    ui: unknown;
  }[];
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    fp,
    originalBytes: 17,
    tailBytes: 13,
    ui: { page: 3, zoom: 1.5 },
  });

  // The fingerprint is the key; tails live beside the original and never change it.
  expect(await storage(page, 'read', fp)).toEqual({
    original: '%PDF-1.7 original',
    tail: 'tail-2-longer',
    ui: { page: 3, zoom: 1.5 },
  });
  expect(await storage(page, 'opfsEntries')).toEqual(['recovery']);

  await storage(page, 'discard', fp);
  expect(await storage(page, 'list')).toEqual([]);
});

test('a tail without an original is refused (snapshots are always original + tail)', async ({
  page,
}) => {
  const fp = 'ab'.repeat(32);
  await expect(storage(page, 'writeTail', fp, 'x')).rejects.toThrow();
  expect(await storage(page, 'list')).toEqual([]);
});

test('the main thread cannot open sync access handles; OPFS writes go through the worker', async ({
  page,
}) => {
  expect(await storage(page, 'mainThreadSyncAccess')).toBe(false);
});

test('FSA append writes the tail in place; an aborted append leaves the file untouched', async ({
  page,
}) => {
  expect(await storage(page, 'append', '%PDF-orig', '+tail', false)).toEqual({
    after: '%PDF-orig+tail',
    error: null,
  });
  expect(await storage(page, 'append', '%PDF-orig', '+tail', true)).toEqual({
    after: '%PDF-orig',
    error: 'abort',
  });
  expect(await storage(page, 'appendChanged')).toEqual({
    after: 'abcdef',
    error: 'FileChangedError',
  });
});
