// Service worker (M1-25, §9, D-17, D-18, ADR-003). Built by vite-plugin-pwa
// (injectManifest): `self.__WB_MANIFEST` is the list of built files.
// - install: cache the core (precacheSplit.ts); the first install activates at
//   once, an update waits (installed → "Update ready" in the app);
// - the app asks for the background precache after its first render;
// - fetch: same-origin GETs from the cache, else the network (a background
//   or on-demand module fetched on demand is cached and reported, for the
//   app's spinner);
// - SKIP_WAITING from the app activates a waiting update (never while
//   documents are open — the app decides).
// No other origin is ever contacted (rule 4).
import { splitPrecache, type PrecacheEntry } from './precacheSplit';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] };

const MANIFEST = self.__WB_MANIFEST;
const { core, background, onDemand } = splitPrecache(MANIFEST);
const REVISION_HEADER = 'x-pdftools-revision';

/** One cache per build: its name hashes the manifest, so any change is a new version. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
const VERSION = hash(JSON.stringify(MANIFEST));
const CACHE = `pdftools-${VERSION}`;

const abs = (url: string): string => new URL(url, self.registration.scope).href;
const coreUrls = new Map(core.map((e) => [abs(e.url), e.revision]));
const backgroundUrls = new Map(background.map((e) => [abs(e.url), e.revision]));
/** Never precached, cached when first fetched (OCR languages other than English, ADR-020). */
const onDemandUrls = new Map(onDemand.map((e) => [abs(e.url), e.revision]));
const INDEX = abs('index.html');

async function broadcast(message: unknown): Promise<void> {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true }))
    c.postMessage(message);
}

/** The response, marked with its revision so a later version can reuse it. */
async function tagged(res: Response, revision: string | null): Promise<Response> {
  const headers = new Headers(res.headers);
  headers.set(REVISION_HEADER, revision ?? '');
  return new Response(await res.blob(), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/** An unchanged copy from an older version's cache (hashed files never change). */
async function fromOlderCache(url: string, revision: string | null): Promise<Response | undefined> {
  for (const name of await caches.keys()) {
    if (name === CACHE || !name.startsWith('pdftools-')) continue;
    const hit = await (await caches.open(name)).match(url);
    if (hit && (hit.headers.get(REVISION_HEADER) ?? '') === (revision ?? '')) return hit;
  }
  return undefined;
}

async function cacheEntry(cache: Cache, url: string, revision: string | null): Promise<void> {
  if (await cache.match(url)) return;
  const old = await fromOlderCache(url, revision);
  if (old) {
    await cache.put(url, old);
    return;
  }
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok) throw new Error(`precache failed: ${String(res.status)}`);
  await cache.put(url, await tagged(res, revision));
}

async function precache(
  entries: Map<string, string | null>,
  kind: 'core' | 'background',
): Promise<void> {
  const cache = await caches.open(CACHE);
  let done = 0;
  for (const [url, revision] of entries) {
    await cacheEntry(cache, url, revision);
    done++;
    await broadcast({ type: 'precache-progress', kind, done, total: entries.size });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precache(coreUrls, 'core');
      // The first version takes over at once; an update waits for the app (or the next launch).
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('pdftools-') && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

let priority = 0;
async function setPriority(delta: number): Promise<void> {
  priority += delta;
  await broadcast({ type: 'priority-fetch', pending: priority });
}

async function respond(request: Request, url: URL): Promise<Response> {
  const cache = await caches.open(CACHE);
  if (request.mode === 'navigate') return (await cache.match(INDEX)) ?? fetch(request);
  const key = url.origin + url.pathname;
  const hit = await cache.match(key);
  if (hit) return hit;
  const isBackground = backgroundUrls.has(key) || onDemandUrls.has(key);
  if (isBackground) await setPriority(1);
  try {
    const res = await fetch(request);
    if (res.ok && (isBackground || coreUrls.has(key))) {
      await cache.put(
        key,
        await tagged(
          res.clone(),
          backgroundUrls.get(key) ?? onDemandUrls.get(key) ?? coreUrls.get(key) ?? null,
        ),
      );
    }
    return res;
  } finally {
    if (isBackground) await setPriority(-1);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Same origin only; the opt-in error report and test endpoints are never cached.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__')) return;
  event.respondWith(respond(request, url));
});

async function status(): Promise<{ total: number; done: number }> {
  const cache = await caches.open(CACHE);
  const all = [...coreUrls.keys(), ...backgroundUrls.keys()];
  let done = 0;
  for (const url of all) if (await cache.match(url)) done++;
  return { total: all.length, done };
}

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  const reply = (message: unknown): void => {
    event.source?.postMessage(message);
  };
  if (data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (data?.type === 'precache-background') {
    event.waitUntil(
      precache(backgroundUrls, 'background').then(
        () => broadcast({ type: 'precache-done' }),
        () => broadcast({ type: 'precache-failed' }),
      ),
    );
  } else if (data?.type === 'status') {
    event.waitUntil(
      status().then((s) => {
        reply({ type: 'status', version: VERSION, ...s });
      }),
    );
  }
});
