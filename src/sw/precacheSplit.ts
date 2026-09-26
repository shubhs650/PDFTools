// Offline precache split (§9, D-17, ADR-003 decision 3): what the service
// worker caches at install (the core: shell, UI, Render worker, PDFium WASM,
// Latin/Arabic/Hebrew fonts) and what it caches in the background after the
// first render (Work worker, CJK fonts; later milestones add PDF Oxide,
// ExcelJS, docx) and the third-party notices (File → About). Shared by the service worker and its unit test.

export interface PrecacheEntry {
  url: string;
  revision: string | null;
}

/** Background modules: needed later than the first page, or only for some documents. */
const BACKGROUND = [
  /(^|\/)assets\/work\.worker-[\w-]+\.js$/,
  /(^|\/)fonts\/(sc|tc|jp|kr)\//,
  /(^|\/)third-party-notices\.txt$/,
];

/** Never precached: the service worker itself, and font license texts. */
const SKIP = [/(^|\/)sw\.js$/, /(^|\/)workbox-[\w-]+\.js$/, /(^|\/)LICENSE$/, /(^|\/)_headers$/];

/** File types the service worker precaches (vite.config.ts globPatterns; the bundle report). */
export const PRECACHE_EXTENSIONS = [
  'html',
  'js',
  'css',
  'wasm',
  'ttf',
  'otf',
  'png',
  'svg',
  'webmanifest',
  'txt',
] as const;

export function splitPrecache(entries: readonly PrecacheEntry[]): {
  core: PrecacheEntry[];
  background: PrecacheEntry[];
} {
  const core: PrecacheEntry[] = [];
  const background: PrecacheEntry[] = [];
  for (const e of entries) {
    if (SKIP.some((r) => r.test(e.url))) continue;
    (BACKGROUND.some((r) => r.test(e.url)) ? background : core).push(e);
  }
  return { core, background };
}
