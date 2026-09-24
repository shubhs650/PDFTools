// M0-S4 Node harness: PDF Oxide WASM — API surface, size, init, quality
// scores on self-made fixtures, throughput vs PDFium, public corpus runs.
//
// Usage: node spikes/s4-oxide/run-node.ts [owner-file.pdf …]
// Output: spikes/s4-oxide/out/s4-node.json and out/review/*.md (manual review).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { initSync, WasmPdfDocument } from 'pdf-oxide-wasm/web';
import { LATTICE, MERGED, STREAM, STRUCTURE, s4Fixture } from './fixtures.ts';

const here = import.meta.dirname;
const root = join(here, '..', '..');
const out = join(here, 'out');
const review = join(out, 'review');
mkdirSync(review, { recursive: true });
const r1 = (n: number): number => Math.round(n * 10) / 10;
const report: Record<string, unknown> = {};

// ---- size + init ---------------------------------------------------------------------
const wasmPath = join(root, 'node_modules/pdf-oxide-wasm/web/pdf_oxide_bg.wasm');
const wasm = readFileSync(wasmPath);
const t0 = performance.now();
const oxide = initSync({ module: wasm });
const initMs = performance.now() - t0;
report.size = {
  wasmMB: r1(wasm.length / 1e5) / 10,
  gzipMB: r1(gzipSync(wasm, { level: 9 }).length / 1e5) / 10,
  brotliMB:
    r1(
      brotliCompressSync(wasm, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length / 1e5,
    ) / 10,
  initMs: r1(initMs),
};
const memMB = (): number => r1((oxide.memory.buffer.byteLength / 1e6) * 10) / 10;

// ---- helpers ---------------------------------------------------------------------------
const plain = (v: unknown): unknown =>
  v instanceof Map
    ? Object.fromEntries([...v].map(([k, x]) => [k, plain(x)]))
    : Array.isArray(v)
      ? v.map(plain)
      : v;
interface OxTable {
  rows: { cells: { text: string }[] }[];
}
const norm = (s: string): string =>
  s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Cells of the expected grid that appear at the same (row, col) in some table's grid. */
function cellAccuracy(
  expected: string[][],
  grids: string[][][],
): { matched: number; total: number; pct: number } {
  const total = expected.flat().filter((c) => c !== '').length;
  let best = 0;
  for (const g of grids) {
    // Align by the first expected row found in the grid (tables may have extra title rows).
    for (let off = 0; off < Math.max(1, g.length); off++) {
      let m = 0;
      expected.forEach((row, r) => {
        row.forEach((cell, c) => {
          if (cell !== '' && norm(g[r + off]?.[c] ?? '') === norm(cell)) m++;
        });
      });
      best = Math.max(best, m);
    }
  }
  return { matched: best, total, pct: total ? r1((best / total) * 1000) / 10 : 0 };
}

function markdownGrids(md: string): string[][][] {
  const grids: string[][][] = [];
  let cur: string[][] | null = null;
  for (const line of md.split('\n')) {
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|\s*-{3}/.test(line)) continue;
      cur ??= [];
      cur.push(
        line
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim()),
      );
    } else if (cur) {
      grids.push(cur);
      cur = null;
    }
  }
  if (cur) grids.push(cur);
  return grids;
}

const tableGrids = (t: unknown): string[][][] =>
  ((plain(t) as OxTable[] | undefined) ?? []).map((tb) =>
    tb.rows.map((r) => r.cells.map((c) => c.text)),
  );

// ---- quality on self-made fixtures -------------------------------------------------------
{
  const bytes = s4Fixture();
  writeFileSync(join(out, 's4-fixture.pdf'), bytes);
  const doc = new WasmPdfDocument(bytes);
  const md = [0, 1, 2, 3].map((p) => doc.toMarkdown(p, true, false, false));
  md.forEach((m, i) => {
    writeFileSync(join(review, `fixture-p${String(i + 1)}.md`), m);
  });
  const q: Record<string, unknown> = {};
  const lattice = [LATTICE.header, ...LATTICE.rows];
  const merged = [MERGED.header2, ...MERGED.rows];
  const stream = [STREAM.header, ...STREAM.rows];
  q.latticeTable = {
    extractTables: cellAccuracy(lattice, tableGrids(doc.extractTables(0))),
    markdown: cellAccuracy(lattice, markdownGrids(md[0] ?? '')),
  };
  q.streamTable = {
    extractTables: cellAccuracy(stream, tableGrids(doc.extractTables(1))),
    markdown: cellAccuracy(stream, markdownGrids(md[1] ?? '')),
    tablesFound: (plain(doc.extractTables(1)) as unknown[]).length,
  };
  const mergedGrids = tableGrids(doc.extractTables(2));
  q.mergedHeaderTable = {
    extractTables: cellAccuracy(merged, mergedGrids),
    markdown: cellAccuracy(merged, markdownGrids(md[2] ?? '')),
    mergedHeaderInsideTable: mergedGrids.some((g) =>
      g.flat().some((c) => norm(c) === 'dimensions mm'),
    ),
  };
  const m4 = md[3] ?? '';
  const S = STRUCTURE;
  const leftEnd = m4.indexOf('Left column paragraph ends here');
  const rightStart = m4.indexOf('Right column starts');
  q.structure = {
    h1: new RegExp(`^#\\s+${S.h1}`, 'm').test(m4),
    h2: new RegExp(`^#{2,3}\\s+${S.h2.replace('.', '\\.')}`, 'm').test(m4),
    h2AsBold: m4.includes(`**${S.h2}**`),
    readingOrderColumns: leftEnd >= 0 && rightStart > leftEnd,
    bullets: S.bullets.every((b) => m4.includes(`- ${b}`)),
    numbered: S.numbered.every((b, i) => m4.includes(`${String(i + 1)}. ${b}`)),
    plainTextKeepsLayout: /design, +Right column/.test(doc.toPlainText(3)),
  };
  q.html = {
    hasTableElement: /<table/i.test(doc.toHtml(0, false, true, false)),
    headingTag: /<h1/i.test(doc.toHtml(3, false, true, false)),
  };
  q.pathsApi = {
    segmentsOnLatticePage: (plain(doc.extractPaths(0, null)) as unknown[]).length,
  };
  doc.free();
  report.quality = q;
}

// ---- throughput: 2,000-page contract stand-in, per page (cancellable between pages) ------
const contract = join(root, 'spikes/s5-search/out/contract-2000.pdf');
if (existsSync(contract)) {
  const bytes = new Uint8Array(readFileSync(contract));
  const to = performance.now();
  const doc = new WasmPdfDocument(bytes);
  const openMs = performance.now() - to;
  const pages = doc.pageCount();
  const time = (
    fn: (p: number) => string,
  ): { ms: number; pagesPerSec: number; maxPageMs: number; chars: number } => {
    const t = performance.now();
    let max = 0;
    let chars = 0;
    for (let p = 0; p < pages; p++) {
      const tp = performance.now();
      chars += fn(p).length;
      max = Math.max(max, performance.now() - tp);
    }
    const ms = performance.now() - t;
    return {
      ms: Math.round(ms),
      pagesPerSec: Math.round(pages / (ms / 1000)),
      maxPageMs: r1(max),
      chars,
    };
  };
  const text = time((p) => doc.toPlainText(p));
  const markdown = time((p) => doc.toMarkdown(p, true, false, false));
  const memAfter = memMB();
  doc.free();

  // PDFium baseline (FPDFText, same file).
  const mod = await init({
    wasmBinary: readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm')),
  });
  new PdfiumNative(mod, { fontFallback: null });
  type F = (...a: (number | string)[]) => number;
  const m = mod as unknown as Record<string, F>;
  const call = (n: string, ...a: (number | string)[]): number => m[n]?.(...a) ?? 0;
  const em = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    HEAPU8: Uint8Array;
  };
  const buf = em.wasmExports.malloc(bytes.length);
  em.HEAPU8.set(bytes, buf);
  const dp = call('FPDF_LoadMemDocument', buf, bytes.length, '');
  const tp0 = performance.now();
  let pchars = 0;
  for (let p = 0; p < pages; p++) {
    const pg = call('FPDF_LoadPage', dp, p);
    const tpg = call('FPDFText_LoadPage', pg);
    const n = call('FPDFText_CountChars', tpg);
    const b = em.wasmExports.malloc((n + 1) * 2);
    const w = call('FPDFText_GetText', tpg, 0, n, b);
    pchars += Math.max(0, w - 1);
    em.wasmExports.free(b);
    call('FPDFText_ClosePage', tpg);
    call('FPDF_ClosePage', pg);
  }
  const pdfiumMs = performance.now() - tp0;
  report.throughput = {
    pages,
    openMs: r1(openMs),
    oxideText: text,
    oxideMarkdown: markdown,
    oxideWasmMemoryMB: memAfter,
    pdfiumText: {
      ms: Math.round(pdfiumMs),
      pagesPerSec: Math.round(pages / (pdfiumMs / 1000)),
      chars: pchars,
    },
  };
}

// ---- public corpus (and owner files): open, markdown, tables, timing ------------------
{
  const argFiles = process.argv.slice(2);
  const files = argFiles.length
    ? argFiles
    : readdirSync(join(root, 'corpus'))
        .filter((f) => f.endsWith('.pdf'))
        .map((f) => join(root, 'corpus', f));
  const res: Record<string, unknown> = {};
  for (const path of files) {
    const name = path.split('/').pop() ?? path;
    try {
      const bytes = new Uint8Array(readFileSync(path));
      const t = performance.now();
      const doc = new WasmPdfDocument(bytes);
      const pages = doc.pageCount();
      const sample = [...new Set([0, 1, Math.floor(pages / 2), pages - 1])]
        .filter((p) => p >= 0 && p < pages)
        .slice(0, 4);
      let tables = 0;
      let mdTables = 0;
      const perPage: number[] = [];
      let dump = '';
      for (const p of sample) {
        const tp = performance.now();
        const md = doc.toMarkdown(p, true, false, false);
        const tb = (plain(doc.extractTables(p)) as unknown[]).length;
        perPage.push(performance.now() - tp);
        tables += tb;
        mdTables += markdownGrids(md).length;
        dump += `\n\n<!-- ===== page ${String(p + 1)} (extractTables: ${String(tb)}) ===== -->\n\n${md}`;
      }
      writeFileSync(join(review, `${name}.md`), dump);
      res[name] = {
        pages,
        openMs: r1(performance.now() - t - perPage.reduce((a, b) => a + b, 0)),
        sampledPages: sample.map((p) => p + 1),
        msPerPage: r1(perPage.reduce((a, b) => a + b, 0) / perPage.length),
        tablesFound: tables,
        markdownTables: mdTables,
      };
      doc.free();
    } catch (e) {
      res[name] = `ERROR ${String(e)}`;
    }
  }
  report.corpus = res;
}

writeFileSync(join(out, 's4-node.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
