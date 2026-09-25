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

const steps: Record<string, string> = {
  opfsWrite: `(async () => { ${opfsHandle.toString()}; await opfsHandle(); return 'ok'; })()`,
  queryPermission: `(async () => { ${opfsHandle.toString()}; const h = await opfsHandle(); return await h.queryPermission({ mode: 'read' }); })()`,
  structuredClone: `(async () => { ${opfsHandle.toString()}; const h = await opfsHandle(); structuredClone(h); return 'ok'; })()`,
  idbPut: `(async () => { ${opfsHandle.toString()}; const h = await opfsHandle();
    const db = await new Promise((res, rej) => { const r = indexedDB.open('diag', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put({ h }, 'k'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return 'ok'; })()`,
  idbPutGetSame: `(async () => { ${opfsHandle.toString()}; const h = await opfsHandle();
    const db = await new Promise((res, rej) => { const r = indexedDB.open('diag2', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put({ h }, 'k'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    const got = await new Promise((res, rej) => { const r = db.transaction('s').objectStore('s').get('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return String(await got.h.isSameEntry(h)); })()`,
};

for (const [name, code] of Object.entries(steps)) {
  test(`diag ${name}`, async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(code);
    console.log(`DIAG ${name}: ${String(r)}`);
    expect(r).toBeTruthy();
  });
}
