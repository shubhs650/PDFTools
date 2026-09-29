import { describe, expect, it } from 'vitest';
import {
  CORE_BUDGET,
  INSTALL_BUDGET,
  RESERVED,
  aggregate,
  isPrecached,
  moduleOf,
  renderMarkdown,
  type FileSize,
} from '../scripts/bundle-report.ts';

const f = (path: string, raw: number): FileSize => ({
  path,
  raw,
  gzip: Math.round(raw / 2),
  brotli: Math.round(raw / 3),
});

const BUILD: FileSize[] = [
  f('index.html', 600),
  f('sw.js', 5_000),
  f('_headers', 700),
  f('manifest.webmanifest', 700),
  f('third-party-notices.txt', 100_000),
  f('icons/icon-192.png', 3_000),
  f('assets/index-abc.js', 800_000),
  f('assets/index-abc.css', 20_000),
  f('assets/render.worker-x1.js', 340_000),
  f('assets/work.worker-x2.js', 330_000),
  f('assets/storage.worker-x3.js', 6_000),
  f('assets/encoder.worker-x4.js', 2_000),
  f('assets/pdfium-x5.wasm', 4_600_000),
  f('fonts/latin/NotoSans-Regular.ttf', 630_000),
  f('fonts/latin/LICENSE', 4_000),
  f('fonts/sc/NotoSansHans-Regular.otf', 8_000_000),
];

describe('bundle report (M1-27)', () => {
  it('classifies files into modules', () => {
    expect(moduleOf('assets/render.worker-x1.js')).toBe('renderWorker');
    expect(moduleOf('assets/work.worker-x2.js')).toBe('workWorker');
    expect(moduleOf('assets/storage.worker-x3.js')).toBe('otherWorkers');
    expect(moduleOf('assets/pdfium-x5.wasm')).toBe('pdfium');
    expect(moduleOf('assets/exceljs.min-Bq12.js')).toBe('excelJs');
    expect(moduleOf('assets/pdf_oxide-Zx12.js')).toBe('oxide');
    expect(moduleOf('assets/pdf_oxide_bg-Zx34.wasm')).toBe('oxide');
    expect(moduleOf('fonts/hebrew/NotoSansHebrew-Regular.ttf')).toBe('coreFonts');
    expect(moduleOf('fonts/kr/NotoSansKR-Regular.otf')).toBe('cjkFonts');
    expect(moduleOf('assets/index-abc.js')).toBe('app');
    expect(moduleOf('icons/icon-192.png')).toBe('shell');
  });

  it('counts only what the service worker precaches', () => {
    expect(isPrecached('fonts/latin/LICENSE')).toBe(false);
    expect(isPrecached('_headers')).toBe(false);
    expect(isPrecached('assets/pdfium-x5.wasm')).toBe(true);
    const r = aggregate(BUILD);
    const all = r.modules.reduce((s, m) => s + m.files, 0);
    // everything but sw.js, _headers and the font LICENSE
    expect(all).toBe(BUILD.length - 3);
  });

  it('sums raw/gzip/brotli and splits core vs background like the service worker', () => {
    const r = aggregate(BUILD);
    const raw = BUILD.filter((x) => !['sw.js', '_headers', 'fonts/latin/LICENSE'].includes(x.path))
      .map((x) => x.raw)
      .reduce((a, b) => a + b, 0);
    expect(r.totals.raw).toBe(raw);
    expect(r.totals.background).toBe(330_000 + 8_000_000 + 100_000);
    expect(r.totals.core).toBe(raw - r.totals.background);
    expect(r.modules.find((m) => m.id === 'workWorker')?.core).toBe(0);
    expect(r.modules.find((m) => m.id === 'pdfium')?.core).toBe(4_600_000);
    expect(r.totals.projected).toBe(raw + RESERVED.reduce((s, x) => s + x.raw, 0));
    expect(r.problems).toEqual([]);
  });

  it('fails the install and core budgets, and a build without pdfium.wasm', () => {
    expect(aggregate(BUILD, { install: 1_000_000, core: CORE_BUDGET }).problems[0]).toMatch(
      /Install total .* exceeds the 1\.00 MB budget/,
    );
    expect(aggregate(BUILD, { install: INSTALL_BUDGET, core: 1_000_000 }).problems[0]).toMatch(
      /Core precache .* exceeds/,
    );
    expect(aggregate(BUILD.filter((x) => !x.path.endsWith('.wasm'))).problems).toContain(
      'pdfium.wasm not found in the build.',
    );
  });

  it('renders a markdown table with every module, the reserved lines and the verdict', () => {
    const md = renderMarkdown(aggregate(BUILD));
    for (const label of ['Render worker', 'Work worker', 'pdfium.wasm', 'CJK fonts', 'App JS'])
      expect(md).toContain(label);
    for (const x of RESERVED) expect(md).toContain(x.label);
    expect(md).toContain('✅ Within budget.');
    expect(renderMarkdown(aggregate(BUILD, { install: 1, core: 1 }))).toContain('❌');
  });
});
