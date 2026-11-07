// Offline precache split (§9, D-17, ADR-003 decision 3): what the service
// worker caches at install (the core: shell, UI, Render worker, PDFium WASM,
// Latin/Arabic/Hebrew fonts) and what it caches in the background after the
// first render (Work and Snap workers, CJK fonts, ExcelJS, PDF Oxide, the Word
// builder, the OCR worker with its WASM and data) and the third-party notices (File → About). Shared by the service worker and its unit test.

export interface PrecacheEntry {
  url: string;
  revision: string | null;
}

/** The Help window's own files (M9, ADR-026 D-46): help.html, its entry chunk and CSS, the screenshots. */
const HELP_FILE = /(^|\/)(help\.html|assets\/help-[\w-]+\.(js|css)|help-img\/[\w-]+\.webp)$/;

export function isHelpFile(url: string): boolean {
  return HELP_FILE.test(url);
}

/** Background modules: needed later than the first page, or only for some documents. */
const BACKGROUND = [
  /(^|\/)assets\/work\.worker-[\w-]+\.js$/,
  // Snapping needs the Work worker's geometry anyway (M3-18, ADR-008).
  /(^|\/)assets\/snap\.worker-[\w-]+\.js$/,
  // The CRS workbook library (M3-19, ADR-015 d2): only for an export.
  /(^|\/)assets\/exceljs[\w.-]*\.js$/,
  // PDF Oxide (M4-04, ADR-009 d1): glue chunk and WASM, only for exports.
  /(^|\/)assets\/pdf_oxide[\w.-]*\.(js|wasm)$/,
  // The Word builder (M4-07): docx and the Markdown parser, only for To Word.
  /(^|\/)assets\/docxBuild[\w.-]*\.js$/,
  /(^|\/)fonts\/(sc|tc|jp|kr)\//,
  // Typed signatures' handwriting fonts (M6-13, ADR-022 d3): only for Sign Document.
  /(^|\/)fonts\/sig-[\w-]+\//,
  // OCR (M5, ADR-020 d2): the worker, Tesseract's WASM and the English data, only for OCR.
  /(^|\/)assets\/ocr\.worker-[\w-]+\.js$/,
  /(^|\/)assets\/tesseract-core[\w.-]*\.wasm$/,
  /(^|\/)ocr\/eng\.traineddata\.gz$/,
  /(^|\/)third-party-notices\.txt$/,
  // The Help window (M9, ADR-026 D-46): its page, script, style and screenshots.
  HELP_FILE,
];

/**
 * Known but never precached (§9 install budget): fetched on first use and
 * then kept by the service worker like a background module — the OCR data of
 * the languages other than English (ADR-020 d2, amended).
 */
const ON_DEMAND = [/(^|\/)ocr\/(?!eng\.)[\w]+\.traineddata\.gz$/];

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
  // Help's screenshots (M9, ADR-026).
  'webp',
  'svg',
  'webmanifest',
  'txt',
  // The OCR language data (M5), inflated by the OCR worker itself.
  'gz',
] as const;

export function splitPrecache(entries: readonly PrecacheEntry[]): {
  core: PrecacheEntry[];
  background: PrecacheEntry[];
  onDemand: PrecacheEntry[];
} {
  const core: PrecacheEntry[] = [];
  const background: PrecacheEntry[] = [];
  const onDemand: PrecacheEntry[] = [];
  for (const e of entries) {
    if (SKIP.some((r) => r.test(e.url))) continue;
    if (ON_DEMAND.some((r) => r.test(e.url))) onDemand.push(e);
    else (BACKGROUND.some((r) => r.test(e.url)) ? background : core).push(e);
  }
  return { core, background, onDemand };
}
