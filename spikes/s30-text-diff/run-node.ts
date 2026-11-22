// Spike S30 (M12-05): the Node harness. Sections (all by default):
//   order     reading-order routes (XY-cut, content order, PDF Oxide) on pairs
//             04, 09 and the self-made scrambled two-column pair
//   corpus    every text pair against its manifest (OCR on for 08 and 12)
//   diff      own Myers (with unique anchors) against jsdiff `diffArrays`
//   perf      time and memory on pairs 10 and 17
//   switches  the experimental parts switched off (renumbering, headers and
//             footers, moves) to show what each one does
// Usage:
//   npm install --no-save diff@8.0.4        # the "diff" section only
//   node --expose-gc --import ./spikes/shared/ts-ext.ts spikes/s30-text-diff/run-node.ts [section …]
// Results: spikes/s30-text-diff/out/s30-<section>.json and a summary on stdout.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  corpusBytes,
  corpusPair,
  corpusPairs,
} from '../../e2e/fixtures/comparison-corpus/index.ts';
import { heapBytes, openDoc, pdfium } from '../s28-alignment/pdfium.ts';
import { compare, type Change, type CompareOptions, type DiffFn } from './compare.ts';
import { extractDoc, type DocText, type Route } from './doc.ts';
import { account, EXPECTED } from './expected.ts';
import { scrambledPair } from './fixtures.ts';
import { diff, hunks, Interner, matches, type Hunk } from './myers.ts';
import { ocrPage, ocrStats } from './ocr.ts';
import { openOxide } from './tables.ts';

const here = import.meta.dirname;
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const want = new Set(process.argv.slice(2));
const run = (s: string): boolean => want.size === 0 || want.has(s);
const save = (name: string, data: unknown) => {
  writeFileSync(join(outDir, `s30-${name}.json`), JSON.stringify(data, null, 2));
};
const gc = (globalThis as { gc?: () => void }).gc;
const MB = (n: number) => Math.round(n / 1048576);

const mod = await pdfium();

interface LoadOptions {
  route?: Route;
  ocr?: boolean;
  headersFooters?: boolean;
}

async function load(bytes: Uint8Array, o: LoadOptions = {}): Promise<DocText> {
  const doc = openDoc(mod, bytes);
  const ox = openOxide(bytes);
  return extractDoc(doc, {
    route: o.route ?? 'xy',
    tables: true,
    oxide: ox,
    ocr: o.ocr ? ocrPage() : null,
    ...(o.headersFooters === false ? { headersFooters: false } : {}),
  });
}

function pairBytes(id: string): { old: Uint8Array; new: Uint8Array } {
  if (id === 'scrambled') return scrambledPair();
  const cp = corpusPair('text', id);
  return { old: corpusBytes(cp, 'old'), new: corpusBytes(cp, 'new') };
}

function line(c: Change): string {
  const t = c.table ? ` [${c.table.row}${c.table.col ? ` / ${c.table.col}` : ''}]` : '';
  const pg = `p${String((c.a?.page ?? -1) + 1)}→p${String((c.b?.page ?? -1) + 1)}`;
  return `${c.kind} ${pg}${t}${c.ocr ? ` {${c.ocr}}` : ''}${c.note ? ` (${c.note})` : ''} «${(c.a?.text ?? '').slice(0, 70)}» → «${(c.b?.text ?? '').slice(0, 70)}»`;
}

interface PairResult {
  pair: string;
  reported: number;
  found: string[];
  missed: string[];
  unexplained: string[];
  changes: string[];
  extractMs: number;
  compareMs: number;
}

async function runPair(
  id: string,
  lo: LoadOptions = {},
  co: CompareOptions = {},
): Promise<PairResult> {
  const bytes = pairBytes(id);
  const t0 = performance.now();
  const A = await load(bytes.old, lo);
  const B = await load(bytes.new, lo);
  const extractMs = performance.now() - t0;
  const r = compare(A, B, co);
  const acc = account(EXPECTED[id] ?? [], r.changes, !!lo.ocr);
  const flat = r.changes.flatMap((c) => [line(c), ...(c.inner ?? []).map((x) => `    ${line(x)}`)]);
  return {
    pair: id,
    reported: acc.reported,
    found: acc.found,
    missed: acc.missed,
    unexplained: acc.unexplained.map(line),
    changes: flat,
    extractMs: Math.round(extractMs),
    compareMs: Math.round(r.ms.total),
  };
}

const summary = (r: PairResult, tag = '') => {
  console.log(
    `  ${r.pair.padEnd(9)}${tag.padEnd(8)} reported ${String(r.reported).padStart(3)}  found ${String(r.found.length)}/${String(r.found.length + r.missed.length)}` +
      `${r.missed.length ? `  MISSED ${r.missed.join(',')}` : ''}${r.unexplained.length ? `  UNEXPLAINED ${String(r.unexplained.length)}` : ''}` +
      `  (extract ${String(r.extractMs)} ms, compare ${String(r.compareMs)} ms)`,
  );
};

// ---------------------------------------------------------------- order
if (run('order')) {
  console.log('== order: reading-order routes');
  const out: PairResult[] = [];
  for (const id of ['04', '09', 'scrambled'])
    for (const route of ['xy', 'stream', 'oxide'] as Route[]) {
      const r = await runPair(id, { route });
      summary(r, route);
      for (const u of r.unexplained.slice(0, 3)) console.log(`      ? ${u}`);
      out.push({ ...r, pair: `${id}/${route}` });
    }
  save('order', out);
}

// ---------------------------------------------------------------- corpus
if (run('corpus')) {
  console.log('== corpus: every text pair against its manifest');
  const out: PairResult[] = [];
  const ids = [...corpusPairs('text').map((p) => p.id), 'scrambled'];
  for (const id of ids) {
    const ocr = id === '08' || id === '12';
    if (id === '08') {
      const r = await runPair(id, { ocr: false });
      summary(r, 'no OCR');
      out.push({ ...r, pair: '08/no-ocr' });
    }
    const r = await runPair(id, { ocr });
    summary(r, ocr ? 'OCR' : '');
    for (const u of r.unexplained) console.log(`      ? ${u}`);
    out.push(r);
  }
  console.log(
    `  OCR: ${String(ocrStats.pages)} pages, ${String(Math.round(ocrStats.ms / Math.max(1, ocrStats.pages)))} ms a page`,
  );
  save('corpus', { pairs: out, ocr: ocrStats });
}

// ---------------------------------------------------------------- diff
if (run('diff')) {
  console.log('== diff: own Myers against jsdiff diffArrays');
  const require = createRequire(import.meta.url);
  interface JsDiff {
    diffArrays: (
      a: number[],
      b: number[],
    ) => { count?: number; added?: boolean; removed?: boolean }[];
  }
  let js: JsDiff | null = null;
  try {
    js = require('diff') as JsDiff;
  } catch {
    console.log('  jsdiff not installed (npm install --no-save diff@8.0.4): own routes only');
  }
  const jsDiff: DiffFn = (a, b) => {
    const parts = js?.diffArrays(Array.from(a), Array.from(b)) ?? [];
    const out: Hunk[] = [];
    let i = 0;
    let j = 0;
    for (const p of parts) {
      const n = p.count ?? 0;
      if (p.added) {
        out.push({ op: '+', a0: i, a1: i, b0: j, b1: j + n });
        j += n;
      } else if (p.removed) {
        out.push({ op: '-', a0: i, a1: i + n, b0: j, b1: j });
        i += n;
      } else {
        out.push({ op: '=', a0: i, a1: i + n, b0: j, b1: j + n });
        i += n;
        j += n;
      }
    }
    return out;
  };
  const kept = (hs: Hunk[]) => hs.filter((h) => h.op === '=').reduce((s, h) => s + h.a1 - h.a0, 0);
  const rows: Record<string, unknown>[] = [];
  for (const id of ['03', '05', '09', '10', '17']) {
    const bytes = pairBytes(id);
    const A = await load(bytes.old);
    const B = await load(bytes.new);
    const intern = new Interner();
    const seq = (D: DocText) =>
      Int32Array.from(D.units.flatMap((u) => u.tokens.map((t) => intern.id(t.key))));
    const a = seq(A);
    const b = seq(B);
    const time = (f: () => Hunk[]) => {
      const t = performance.now();
      const h = f();
      return { ms: Math.round((performance.now() - t) * 10) / 10, kept: kept(h) };
    };
    const own = time(() => diff(a, b));
    const plain = time(() => hunks(matches(a, b, { anchors: false }), a.length, b.length));
    const jsr = js ? time(() => jsDiff(a, b)) : null;
    // The whole comparison with each routine, accounted against the manifest.
    const withOwn = account(EXPECTED[id] ?? [], compare(A, B).changes, false);
    const withJs = js
      ? account(EXPECTED[id] ?? [], compare(A, B, { diff: jsDiff }).changes, false)
      : null;
    const row = {
      pair: id,
      tokens: [a.length, b.length],
      own,
      ownPlain: plain,
      jsdiff: jsr,
      compareOwn: {
        reported: withOwn.reported,
        missed: withOwn.missed,
        unexplained: withOwn.unexplained.length,
      },
      compareJsdiff: withJs && {
        reported: withJs.reported,
        missed: withJs.missed,
        unexplained: withJs.unexplained.length,
      },
    };
    rows.push(row);
    console.log(
      `  ${id}  tokens ${String(a.length)}/${String(b.length)}  own ${String(own.ms)} ms kept ${String(own.kept)}  ` +
        `own-plain ${String(plain.ms)} ms kept ${String(plain.kept)}` +
        (jsr ? `  jsdiff ${String(jsr.ms)} ms kept ${String(jsr.kept)}` : '') +
        `  | compare own ${String(withOwn.reported)} (missed ${String(withOwn.missed.length)}, unexpl ${String(withOwn.unexplained.length)})` +
        (withJs
          ? `  jsdiff ${String(withJs.reported)} (missed ${String(withJs.missed.length)}, unexpl ${String(withJs.unexplained.length)})`
          : ''),
    );
  }
  save('diff', rows);
}

// ---------------------------------------------------------------- perf
if (run('perf')) {
  console.log('== perf: time and memory');
  const rows: Record<string, unknown>[] = [];
  for (const id of ['10', '17']) {
    gc?.();
    const before = process.memoryUsage();
    const bytes = pairBytes(id);
    const t0 = performance.now();
    const A = await load(bytes.old);
    const tA = performance.now() - t0;
    const B = await load(bytes.new);
    const tB = performance.now() - t0 - tA;
    const r = compare(A, B);
    gc?.();
    const after = process.memoryUsage();
    const acc = account(EXPECTED[id] ?? [], r.changes, false);
    const row = {
      pair: id,
      pages: [A.pages, B.pages],
      units: [A.units.length, B.units.length],
      tokens: [
        A.units.reduce((s, u) => s + u.tokens.length, 0),
        B.units.reduce((s, u) => s + u.tokens.length, 0),
      ],
      extractMs: [Math.round(tA), Math.round(tB)],
      extractSplit: [A.ms, B.ms],
      compareMs: r.ms,
      heapMB: MB(after.heapUsed),
      heapGrowthMB: MB(after.heapUsed - before.heapUsed),
      rssMB: MB(after.rss),
      pdfiumHeapMB: MB(heapBytes(mod)),
      found: acc.found,
      missed: acc.missed,
      unexplained: acc.unexplained.map(line),
    };
    rows.push(row);
    console.log(`  ${JSON.stringify(row)}`);
  }
  save('perf', rows);
}

// ---------------------------------------------------------------- switches
if (run('switches')) {
  console.log('== switches: experimental parts off');
  const out: PairResult[] = [];
  const cases: [string, string, LoadOptions, CompareOptions][] = [
    ['05', 'no-renumber', {}, { renumbering: false }],
    ['14', 'no-renumber', {}, { renumbering: false }],
    ['13', 'no-hf', { headersFooters: false }, { headersFooters: false }],
    ['15', 'no-hf', { headersFooters: false }, { headersFooters: false }],
    ['09', 'no-moves', {}, { moves: false }],
  ];
  for (const [id, tag, lo, co] of cases) {
    const r = await runPair(id, lo, co);
    summary(r, tag);
    out.push({ ...r, pair: `${id}/${tag}` });
  }
  save('switches', out);
}

// ---------------------------------------------------------------- prefix
// Results as they are ready (Q40): matching only the pages read so far gives,
// for the pages before the last few, the same changes as the whole document.
if (run('prefix')) {
  console.log('== prefix: matching the pages read so far');
  const rows: Record<string, unknown>[] = [];
  for (const id of ['10', '17']) {
    const bytes = pairBytes(id);
    const A = await load(bytes.old);
    const B = await load(bytes.new);
    const full = new Set(compare(A, B).changes.map(line));
    const cut = (D: DocText, n: number): DocText => ({
      ...D,
      units: D.units.filter((u) => u.page < n),
    });
    for (const n of id === '10' ? [4, 9, 14] : [10, 40, 215, 400]) {
      const t = performance.now();
      const r = compare(cut(A, n), cut(B, n));
      const ms = Math.round(performance.now() - t);
      // Settled: both sides at least 2 pages before the cut.
      const settled = r.changes.filter(
        (c) => c.kind !== 'renumbered' && (c.a?.page ?? 0) < n - 2 && (c.b?.page ?? 0) < n - 2,
      );
      const same = settled.filter((c) => full.has(line(c))).length;
      rows.push({ pair: id, pages: n, ms, settled: settled.length, sameAsFull: same });
      console.log(
        `  ${id} first ${String(n)} pages: ${String(ms)} ms, settled ${String(settled.length)}, same as full ${String(same)}`,
      );
      for (const c of settled.filter((x) => !full.has(line(x)))) console.log(`      ≠ ${line(c)}`);
    }
  }
  save('prefix', rows);
}
