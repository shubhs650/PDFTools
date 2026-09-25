// M0-S7 Node harness: correctness on the known-geometry sheet, then
// extraction / index / query performance on public drawings and synthetic
// dense sheets. Browser round-trip and tile impact: s7.spec.ts.
//
// Usage: node spikes/s7-snap/run-node.ts [owner-file.pdf …]
//   → spikes/s7-snap/out/s7-node.json. With file arguments (the owner's local
//   CAD drawings / P&ID), those are measured instead of corpus/.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { init } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { extractPage } from './extract.ts';
import { buildGrid, snap } from './snap-core.ts';
import { CIRCLE, EXPECTED, FILL_ONLY, INTERSECTION, denseSheet, testSheet } from './test-sheet.ts';

const here = import.meta.dirname;
const root = join(here, '..', '..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const mod = await init({
  wasmBinary: readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm')),
});
new PdfiumNative(mod, { fontFallback: null }); // initialises the library
type F = (...a: (number | string)[]) => number;
const call = (n: string, ...a: (number | string)[]): number =>
  (mod as unknown as Record<string, F>)[n]?.(...a) ?? 0;
const em = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
};

function openDoc(bytes: Uint8Array): { ptr: number; buf: number; pages: number; close(): void } {
  const buf = em.wasmExports.malloc(bytes.length);
  em.HEAPU8.set(bytes, buf);
  const ptr = call('FPDF_LoadMemDocument', buf, bytes.length, '');
  if (!ptr) throw new Error('load failed');
  return {
    ptr,
    buf,
    pages: call('FPDF_GetPageCount', ptr),
    close: () => {
      call('FPDF_CloseDocument', ptr);
      em.wasmExports.free(buf);
    },
  };
}

const r1 = (n: number): number => Math.round(n * 100) / 100;
function stats(xs: number[]): { p50: number; p95: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { p50: r1(q(0.5)), p95: r1(q(0.95)), max: r1(s[s.length - 1] ?? 0) };
}

const report: Record<string, unknown> = {};

// 1. Correctness on the known sheet (both call paths, stroke-only and with fills).
{
  const doc = openDoc(testSheet());
  const res: Record<string, unknown> = {};
  for (const raw of [false, true]) {
    for (const includeFillOnly of [false, true]) {
      const { segs, stats: st } = await extractPage(mod, doc.ptr, 0, { raw, includeFillOnly });
      const has = (e: number[]): boolean => {
        for (let i = 0; i < segs.length; i += 4) {
          const [a, b, c, d] = [segs[i] ?? 0, segs[i + 1] ?? 0, segs[i + 2] ?? 0, segs[i + 3] ?? 0];
          const fwd =
            Math.abs(a - (e[0] ?? 0)) +
            Math.abs(b - (e[1] ?? 0)) +
            Math.abs(c - (e[2] ?? 0)) +
            Math.abs(d - (e[3] ?? 0));
          const rev =
            Math.abs(c - (e[0] ?? 0)) +
            Math.abs(d - (e[1] ?? 0)) +
            Math.abs(a - (e[2] ?? 0)) +
            Math.abs(b - (e[3] ?? 0));
          if (Math.min(fwd, rev) < 0.02) return true;
        }
        return false;
      };
      const g = buildGrid(segs);
      const onCircle = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
        const a = (k / 8) * 2 * Math.PI + 0.1;
        const s = snap(
          g,
          CIRCLE.cx + Math.cos(a) * (CIRCLE.r + 2),
          CIRCLE.cy + Math.sin(a) * (CIRCLE.r + 2),
          4,
        );
        return s ? Math.abs(Math.hypot(s.x - CIRCLE.cx, s.y - CIRCLE.cy) - CIRCLE.r) : 99;
      });
      const endpoint = snap(g, 102, 98, 6);
      const inter = snap(g, INTERSECTION[0] + 2, INTERSECTION[1] - 1, 5);
      const mid = snap(g, 201, 103, 5);
      res[`${raw ? 'raw' : 'cwrap'}${includeFillOnly ? '+fill' : ''}`] = {
        segments: st.segments,
        forms: st.forms,
        missingExpected: EXPECTED.filter((e) => !has(e)),
        fillOnlyPresent: FILL_ONLY.every(has),
        endpoint,
        intersection: inter,
        midpoint: mid,
        circleMaxErr: r1(Math.max(...onCircle)),
      };
    }
  }
  doc.close();
  report.correctness = res;
}

// 2. Public drawings in corpus/ (all pages): extraction, index, queries.
async function measurePage(docPtr: number, p: number): Promise<Record<string, unknown>> {
  const cw = await extractPage(mod, docPtr, p, { raw: false, includeFillOnly: true });
  const rw = await extractPage(mod, docPtr, p, { raw: true, includeFillOnly: true });
  const tb = performance.now();
  const g = buildGrid(rw.segs);
  const buildMs = performance.now() - tb;
  const n = rw.segs.length / 4;
  const q: number[] = [];
  const seen = new Uint32Array(Math.max(1, n));
  let hits = 0;
  for (let k = 0; k < 2000 && n > 0; k++) {
    const i = Math.floor((k * 7919) % n);
    const x = ((rw.segs[i * 4] ?? 0) + (rw.segs[i * 4 + 2] ?? 0)) / 2 + ((k % 7) - 3);
    const y = ((rw.segs[i * 4 + 1] ?? 0) + (rw.segs[i * 4 + 3] ?? 0)) / 2 + ((k % 5) - 2);
    const t = performance.now();
    if (snap(g, x, y, 8, 2048, seen, k + 1)) hits++;
    q.push(performance.now() - t);
  }
  // Visible region at 400 % on a 1600×1000 viewport ≈ 400×250 pt, page centre.
  const pw = call('FPDF_GetPageWidthF', call('FPDF_LoadPage', docPtr, p));
  const cx = pw / 2;
  const reg = await extractPage(mod, docPtr, p, {
    raw: true,
    includeFillOnly: true,
    region: [cx - 200, 300, cx + 200, 550],
  });
  return {
    segments: n,
    regionExtract: {
      segments: reg.stats.segments,
      ms: r1(reg.stats.ms),
      skippedObjects: reg.stats.skippedByRegion,
    },
    paths: rw.stats.paths,
    forms: rw.stats.forms,
    extractMs: { cwrap: r1(cw.stats.ms), raw: r1(rw.stats.ms) },
    gridMs: r1(buildMs),
    memoryKB: Math.round((rw.segs.byteLength + g.items.byteLength + g.cellStart.byteLength) / 1024),
    queryMs: stats(q),
    hitRate: n ? r1(hits / 2000) : null,
  };
}

{
  const res: Record<string, unknown> = {};
  const argFiles = process.argv.slice(2);
  const files = argFiles.length
    ? argFiles
    : readdirSync(join(root, 'corpus'))
        .filter((x) => x.endsWith('.pdf') && !x.startsWith('bearing'))
        .map((x) => join(root, 'corpus', x));
  for (const path of files) {
    const f = path.split('/').pop() ?? path;
    const doc = openDoc(new Uint8Array(readFileSync(path)));
    const pages: Record<string, unknown>[] = [];
    for (let p = 0; p < Math.min(doc.pages, 25); p++)
      pages.push({ page: p + 1, ...(await measurePage(doc.ptr, p)) });
    doc.close();
    const densest = [...pages].sort((a, b) => (b.segments as number) - (a.segments as number))[0];
    res[f] = {
      pages: pages.length,
      totalSegments: pages.reduce((s, x) => s + (x.segments as number), 0),
      densest,
    };
  }
  report.corpus = res;
}

// 3. Synthetic dense sheets: scaling, region extraction and sliced extraction.
{
  const res: Record<string, unknown> = {};
  for (const n of [50_000, 250_000, 1_000_000]) {
    const doc = openDoc(denseSheet(n));
    const full = await measurePage(doc.ptr, 0);
    const sliced = await extractPage(mod, doc.ptr, 0, {
      raw: true,
      includeFillOnly: true,
      sliceMs: 8,
    });
    doc.close();
    res[`${String(n)} segments`] = {
      ...full,
      sliced: {
        ms: r1(sliced.stats.ms),
        slices: sliced.stats.slices,
        maxSliceMs: r1(sliced.stats.maxSliceMs),
      },
    };
  }
  report.dense = res;
}

writeFileSync(join(out, 's7-node.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
