import { expect, test } from './support/fixtures.ts';

// TEMPORARY diagnostic (not for merge): which step crashes Chrome 153?
async function opfsHandle() {
  const root = await navigator.storage.getDirectory();
  const h = await root.getFileHandle('d.pdf', { create: true });
  const w = await h.createWritable();
  await w.write('%PDF-1.7');
  await w.close();
  return h;
}

const open = `const db = await new Promise((res, rej) => { const r = indexedDB.open('diag', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const put = (v) => new Promise((res, rej) => { const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(v, 'k'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    const get = () => new Promise((res, rej) => { const r = db.transaction('s').objectStore('s').get('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });`;
const body = (x: string) =>
  `(async () => { ${opfsHandle.toString()}; ${open}; const h = await opfsHandle(); await put({ h }); ${x} })()`;
const steps: Record<string, string> = {
  getOnly: body(`const g = await get(); return String(g.h.kind);`),
  getName: body(`const g = await get(); return g.h.name;`),
  getQueryPermission: body(
    `const g = await get(); return await g.h.queryPermission({ mode: 'read' });`,
  ),
  getGetFile: body(`const g = await get(); return String((await g.h.getFile()).size);`),
  getIsSameEntryFresh: body(`const g = await get(); return String(await g.h.isSameEntry(g.h));`),
  liveIsSameEntry: body(`const h2 = await opfsHandle(); return String(await h.isSameEntry(h2));`),
  getIsSameEntryLive: body(`const g = await get(); return String(await g.h.isSameEntry(h));`),
  liveIsSameEntryStored: body(`const g = await get(); return String(await h.isSameEntry(g.h));`),
};

for (const [name, code] of Object.entries(steps)) {
  test(`diag ${name}`, async ({ page }) => {
    await page.goto('/');
    console.log(`DIAG version ${String(page.context().browser()?.version())}`);
    const r = await page.evaluate(code);
    console.log(`DIAG ${name}: ${String(r)}`);
    expect(r).toBeTruthy();
  });
}

test('diag diskHandleRoundTrip', async ({ page }, info) => {
  const { writeFileSync } = await import('node:fs');
  const file = info.outputPath('disk.pdf');
  writeFileSync(file, '%PDF-1.7 disk');
  await page.goto('/');
  console.log(`DIAG version ${String(page.context().browser()?.version())}`);
  await page.evaluate(() => {
    const w = window as unknown as { __r?: string };
    window.addEventListener(
      'dragover',
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
    window.addEventListener(
      'drop',
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        void (async () => {
          try {
            const item = e.dataTransfer?.items[0] as DataTransferItem & {
              getAsFileSystemHandle(): Promise<FileSystemFileHandle>;
            };
            const h = await item.getAsFileSystemHandle();
            w.__r = `handle ${h.name}`;
            const db = await new Promise<IDBDatabase>((res) => {
              const r = indexedDB.open('disk', 1);
              r.onupgradeneeded = () => r.result.createObjectStore('s');
              r.onsuccess = () => {
                res(r.result);
              };
            });
            await new Promise((res) => {
              const tx = db.transaction('s', 'readwrite');
              tx.objectStore('s').put({ h }, 'k');
              tx.oncomplete = res;
            });
            w.__r += ' put';
            const g = await new Promise<{ h: FileSystemFileHandle }>((res) => {
              const r = db.transaction('s').objectStore('s').get('k');
              r.onsuccess = () => {
                res(r.result as { h: FileSystemFileHandle });
              };
            });
            w.__r += ` got ${g.h.name} same=${String(await g.h.isSameEntry(h))}`;
          } catch (err) {
            w.__r = `err ${String(err)}`;
          }
        })();
      },
      true,
    );
  });
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [file], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
    await cdp.send('Input.dispatchDragEvent', { type, x: 300, y: 300, data });
  await page.waitForFunction(
    () => {
      const r = (window as unknown as { __r?: string }).__r;
      return r !== undefined && (r.includes('same=') || r.startsWith('err'));
    },
    null,
    { timeout: 10000 },
  );
  const r = await page.evaluate(() => (window as unknown as { __r?: string }).__r);
  console.log(`DIAG diskHandleRoundTrip: ${String(r)}`);
  expect(r).toContain('same=true');
});
