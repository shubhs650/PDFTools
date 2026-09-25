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
const body = (x: string) => `(async () => { ${opfsHandle.toString()}; ${open}; const h = await opfsHandle(); await put({ h }); ${x} })()`;
const steps: Record<string, string> = {
  getOnly: body(`const g = await get(); return String(g.h.kind);`),
  getName: body(`const g = await get(); return g.h.name;`),
  getQueryPermission: body(`const g = await get(); return await g.h.queryPermission({ mode: 'read' });`),
  getGetFile: body(`const g = await get(); return String((await g.h.getFile()).size);`),
  getIsSameEntryFresh: body(`const g = await get(); return String(await g.h.isSameEntry(g.h));`),
  liveIsSameEntry: body(`const h2 = await opfsHandle(); return String(await h.isSameEntry(h2));`),
  getIsSameEntryLive: body(`const g = await get(); return String(await g.h.isSameEntry(h));`),
  liveIsSameEntryStored: body(`const g = await get(); return String(await h.isSameEntry(g.h));`),
};

for (const [name, code] of Object.entries(steps)) {
  test(`diag ${name}`, async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(code);
    console.log(`DIAG ${name}: ${String(r)}`);
    expect(r).toBeTruthy();
  });
}
