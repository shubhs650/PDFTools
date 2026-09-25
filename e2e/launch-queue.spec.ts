import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M1-19: installable PWA; OS-launched PDFs arrive through launchQueue and open
// as tabs in the existing window. The browser's launchQueue is stubbed so the
// test can deliver handles (OPFS handles stand in for files from Explorer).
// Owner check: install on Windows and open a PDF from Explorer (M1 owner pack).

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

async function launch(page: Page, files: { name: string; b64: string }[]) {
  await page.evaluate(async (fs) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('launched', { create: true });
    const handles = [];
    for (const f of fs) {
      const h = await dir.getFileHandle(f.name, { create: true });
      const w = await h.createWritable();
      await w.write(Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)));
      await w.close();
      handles.push(h);
    }
    const consumer = (
      window as unknown as {
        __launchConsumer?: (p: { files: FileSystemHandle[] }) => Promise<void>;
      }
    ).__launchConsumer;
    if (!consumer) throw new Error('launch consumer not registered');
    await consumer({ files: handles });
  }, files);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      value: {
        setConsumer: (c: unknown) => {
          (window as unknown as { __launchConsumer: unknown }).__launchConsumer = c;
        },
      },
    });
  });
});

test('launched files open as tabs; launching an open file again focuses it', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => '__launchConsumer' in window);
  await launch(page, [
    { name: 'drawing.pdf', b64: pdfs.simple(2).toString('base64') },
    { name: 'spec.pdf', b64: pdfs.simple(3).toString('base64') },
  ]);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAccessibleName('drawing.pdf');
  await expect(tabs(page).nth(1)).toHaveAccessibleName('spec.pdf');

  await launch(page, [{ name: 'drawing.pdf', b64: pdfs.simple(2).toString('base64') }]);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('the manifest is linked, valid and points at our icons', async ({
  page,
  request,
  appServer,
}) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const res = await request.get(`${appServer}/manifest.webmanifest`);
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as {
    name: string;
    icons: { src: string }[];
    file_handlers: unknown[];
    launch_handler: unknown;
  };
  expect(m.name).toBe('PDFTools');
  expect(m.file_handlers).toHaveLength(1);
  expect(m.launch_handler).toEqual({ client_mode: 'focus-existing' });
  for (const icon of m.icons) {
    expect((await request.get(`${appServer}/${icon.src}`)).ok()).toBe(true);
  }
});
