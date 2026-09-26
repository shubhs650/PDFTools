// Bundle-size and install-budget report (M1-27, §9, D-17, ADR-002, ADR-003).
// Walks a production build, groups the files the service worker precaches
// into modules (core JS/CSS, workers, pdfium.wasm, core fonts, CJK fonts, …),
// and reports raw / gzip / brotli sizes. Fails when the install total
// (everything precached) exceeds 60 MB or the core precache exceeds its
// budget. Reserved lines show the later milestones' modules with their
// estimated sizes so the projection stays visible.
//
// Usage: node scripts/bundle-report.ts [dist] [--json <file>] [--markdown <file>]
// In GitHub Actions the markdown table is also appended to the job summary.

import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { PRECACHE_EXTENSIONS, splitPrecache } from '../src/sw/precacheSplit.ts';

const MB = 1_000_000;
const BROTLI_QUALITY = 9;

/** §9: total install ≤ 60 MB (decimal MB, as the browser's storage estimate reports). */
export const INSTALL_BUDGET = 60 * MB;
/**
 * Core precache (installed before the app counts as ready offline). M1
 * measured 6.66 MB; the budget leaves ~35 % headroom for M2–M4 UI code.
 * Raise it only with a reason in the PR (and the M1-27 status note).
 */
export const CORE_BUDGET = 9 * MB;

export type ModuleId =
  | 'app'
  | 'renderWorker'
  | 'workWorker'
  | 'otherWorkers'
  | 'pdfium'
  | 'coreFonts'
  | 'cjkFonts'
  | 'shell';

export const MODULES: readonly { id: ModuleId; label: string; test: RegExp }[] = [
  { id: 'renderWorker', label: 'Render worker', test: /^assets\/render\.worker-[\w-]+\.js$/ },
  { id: 'workWorker', label: 'Work worker', test: /^assets\/work\.worker-[\w-]+\.js$/ },
  {
    id: 'otherWorkers',
    label: 'Storage and encoder workers',
    test: /^assets\/[\w-]+\.worker-[\w-]+\.js$/,
  },
  { id: 'pdfium', label: 'pdfium.wasm', test: /^assets\/pdfium-[\w-]+\.wasm$/ },
  {
    id: 'coreFonts',
    label: 'Core fonts (Latin, Arabic, Hebrew)',
    test: /^fonts\/(latin|arabic|hebrew)\//,
  },
  { id: 'cjkFonts', label: 'CJK fonts (SC, TC, JP, KR)', test: /^fonts\/(sc|tc|jp|kr)\// },
  { id: 'app', label: 'App JS and CSS', test: /^assets\/[^/]+\.(js|css)$/ },
  { id: 'shell', label: 'Shell (HTML, manifest, icons, notices)', test: /.*/ },
];

/** Later milestones' modules (§9): not in the build yet; estimates from the M0 spikes. */
export const RESERVED: readonly {
  label: string;
  milestone: string;
  raw: number;
  source: string;
}[] = [
  { label: 'PDF Oxide WASM + glue', milestone: 'M2/M4', raw: 17_920_000, source: 'ADR-009' },
  { label: 'ExcelJS', milestone: 'M4', raw: 1_100_000, source: 'estimate' },
  { label: 'docx', milestone: 'M4', raw: 700_000, source: 'estimate' },
];

export interface FileSize {
  path: string;
  raw: number;
  gzip: number;
  brotli: number;
}

export interface ModuleRow extends Omit<FileSize, 'path'> {
  id: ModuleId;
  label: string;
  files: number;
  /** Precached at install (core) or after the first render (background). */
  core: number;
}

export interface Totals {
  raw: number;
  gzip: number;
  brotli: number;
  core: number;
  background: number;
  reserved: number;
  projected: number;
}

export interface Report {
  modules: ModuleRow[];
  totals: Totals;
  problems: string[];
}

export function moduleOf(path: string): ModuleId {
  const m = MODULES.find((x) => x.test.test(path));
  return m ? m.id : 'shell';
}

export function isPrecached(path: string): boolean {
  const ext = path.split('.').pop() ?? '';
  return (PRECACHE_EXTENSIONS as readonly string[]).includes(ext);
}

export function aggregate(
  files: readonly FileSize[],
  budgets: { install: number; core: number } = { install: INSTALL_BUDGET, core: CORE_BUDGET },
): Report {
  const cached = files.filter((f) => isPrecached(f.path));
  const { core, background } = splitPrecache(cached.map((f) => ({ url: f.path, revision: null })));
  const coreSet = new Set(core.map((e) => e.url));
  const inSplit = new Set([...coreSet, ...background.map((e) => e.url)]);
  const rows = new Map<ModuleId, ModuleRow>();
  for (const m of MODULES) {
    rows.set(m.id, { id: m.id, label: m.label, files: 0, raw: 0, gzip: 0, brotli: 0, core: 0 });
  }
  for (const f of cached) {
    if (!inSplit.has(f.path)) continue; // the service worker itself, never precached
    const row = rows.get(moduleOf(f.path));
    if (!row) continue;
    row.files++;
    row.raw += f.raw;
    row.gzip += f.gzip;
    row.brotli += f.brotli;
    if (coreSet.has(f.path)) row.core += f.raw;
  }
  const modules = [...rows.values()].filter((r) => r.files > 0);
  const sum = (k: 'raw' | 'gzip' | 'brotli' | 'core') => modules.reduce((s, r) => s + r[k], 0);
  const reserved = RESERVED.reduce((s, r) => s + r.raw, 0);
  const totals: Totals = {
    raw: sum('raw'),
    gzip: sum('gzip'),
    brotli: sum('brotli'),
    core: sum('core'),
    background: sum('raw') - sum('core'),
    reserved,
    projected: sum('raw') + reserved,
  };
  const problems: string[] = [];
  if (totals.raw > budgets.install) {
    problems.push(
      `Install total ${mb(totals.raw)} exceeds the ${mb(budgets.install)} budget (§9).`,
    );
  }
  if (totals.core > budgets.core) {
    problems.push(
      `Core precache ${mb(totals.core)} exceeds the ${mb(budgets.core)} budget (M1-27).`,
    );
  }
  if (!modules.some((m) => m.id === 'pdfium')) problems.push('pdfium.wasm not found in the build.');
  return { modules, totals, problems };
}

export const mb = (n: number): string => `${(n / MB).toFixed(2)} MB`;

export function renderMarkdown(r: Report): string {
  const lines = [
    '### Bundle and install budget (M1-27)',
    '',
    '| Module | Files | Raw | gzip -9 | brotli q9 | Precache |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const m of r.modules) {
    const when = m.core === m.raw ? 'core' : m.core === 0 ? 'background' : 'mixed';
    lines.push(
      `| ${m.label} | ${String(m.files)} | ${mb(m.raw)} | ${mb(m.gzip)} | ${mb(m.brotli)} | ${when} |`,
    );
  }
  for (const x of RESERVED) {
    lines.push(
      `| _${x.label} (reserved, ${x.milestone})_ | — | _${mb(x.raw)}_ (${x.source}) | | | |`,
    );
  }
  const t = r.totals;
  lines.push(
    `| **Total installed** | | **${mb(t.raw)}** | ${mb(t.gzip)} | ${mb(t.brotli)} | |`,
    '',
    `- Core precache: **${mb(t.core)}** of ${mb(CORE_BUDGET)} budget; background: ${mb(t.background)}.`,
    `- Install total: **${mb(t.raw)}** of ${mb(INSTALL_BUDGET)} budget; ` +
      `projected with reserved modules: ${mb(t.projected)}.`,
    '',
    r.problems.length ? r.problems.map((p) => `- ❌ ${p}`).join('\n') : '- ✅ Within budget.',
    '',
  );
  return lines.join('\n');
}

function walk(dir: string, root: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
}

export function measure(dist: string): FileSize[] {
  const paths: string[] = [];
  walk(dist, dist, paths);
  return paths.sort().map((path) => {
    const bytes = readFileSync(join(dist, path));
    return {
      path,
      raw: bytes.byteLength,
      gzip: gzipSync(bytes, { level: 9 }).byteLength,
      // Quality 9: close to 11 on these files and ~50× faster (11 takes minutes on the CJK fonts).
      brotli: brotliCompressSync(bytes, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
        },
      }).byteLength,
    };
  });
}

function main(argv: string[]): void {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dist = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? 'dist';
  const report = aggregate(measure(dist));
  const md = renderMarkdown(report);
  console.log(md);
  const json = flag('--json');
  if (json) writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = flag('--markdown');
  if (markdown) writeFileSync(markdown, md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (report.problems.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) main(process.argv.slice(2));
