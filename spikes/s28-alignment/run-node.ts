// Spike S28 (M12-03): the Node harness. Sections (all by default):
//   align    route 1 (own) against route 2 (OpenCV ORB): error, time
//   asis     the "as is" score on every corpus sheet pair, and its threshold
//   pairing  page signatures and automatic pairing
//   detect   analysis resolution and tolerance against the true differences
//   size     install size of both routes
// Usage:
//   npm install --no-save @techstark/opencv-js@4.12.0-release.1   # route 2 only
//   node --import ./spikes/shared/ts-ext.ts spikes/s28-alignment/run-node.ts [section …]
// Results: spikes/s28-alignment/out/s28-<section>.json and a summary on stdout.

import { mkdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { corpusPairs } from '../../e2e/fixtures/comparison-corpus/index.ts';
import { alignRaster, coarseAlign, features, place, refineVector, residual } from './align.ts';
import { corpusDoc, freshCorpusDoc, movePage, scanCases, vectorCases } from './cases.ts';
import {
  detect,
  matchScore,
  renderPair,
  textChanges,
  DEFAULT_DETECT,
  type DetectOptions,
  type Region,
  type TextChange,
} from './detect.ts';
import {
  degOf,
  matToSim,
  nonSimilarity,
  scaleOf,
  simError,
  simToMat,
  type Mat,
  type Sim,
} from './geom.ts';
import { dilate, mask, type Ink } from './image.ts';
import { PointGrid } from './grid.ts';
import {
  assignPairs,
  inkSignature,
  similarity,
  wordBag,
  words,
  type Signature,
} from './pairing.ts';
import { glyphs, heapBytes, pageInfo, pdfium, renderInk, segments, type Doc } from './pdfium.ts';
import { opencv, orbAlign, OPENCV_PACKAGE } from './orb.ts';
import { truthDiff, truthMat, type TruthItem } from './truth.ts';

const here = import.meta.dirname;
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
const want = new Set(process.argv.slice(2));
const run = (s: string): boolean => want.size === 0 || want.has(s);
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const r4 = (n: number): number => Math.round(n * 10000) / 10000;
const save = (name: string, data: unknown): void => {
  writeFileSync(join(outDir, `s28-${name}.json`), JSON.stringify(data, null, 1));
};

const mod = await pdfium();

// ----------------------------------------------------------------- route 1 ---

interface Route1Vector {
  sim: Sim;
  coarse: Sim;
  ms: { render: number; coarse: number; geometry: number; refine: number; total: number };
  features: [number, number];
  inlierShare: number;
  rms: number;
}

async function route1Vector(docA: Doc, ia: number, docB: Doc, ib: number): Promise<Route1Vector> {
  const t0 = performance.now();
  const A = pageInfo(docA, ia);
  const B = pageInfo(docB, ib);
  const n = 512;
  const s = (0.9 * n) / Math.max(A.w, A.h, B.w, B.h);
  const a = renderInk(docA, ia, {
    scale: s,
    width: Math.ceil(A.w * s),
    height: Math.ceil(A.h * s),
  });
  const b = renderInk(docB, ib, {
    scale: s,
    width: Math.ceil(B.w * s),
    height: Math.ceil(B.h * s),
  });
  const t1 = performance.now();
  const c = coarseAlign({ a, b, scale: s }, { n });
  const t2 = performance.now();
  const fA = features(await segments(docA, ia));
  const fB = features(await segments(docB, ib));
  const t3 = performance.now();
  const ref = refineVector(fA, fB, c.sim, Math.max(8, 3 * c.ptPerPx));
  const t4 = performance.now();
  return {
    sim: ref.sim,
    coarse: c.sim,
    ms: { render: t1 - t0, coarse: t2 - t1, geometry: t3 - t2, refine: t4 - t3, total: t4 - t0 },
    features: [fA.length / 2, fB.length / 2],
    inlierShare: ref.inlierShare,
    rms: ref.rms,
  };
}

const errRow = (est: Sim | null, truth: Sim, w: number, h: number) => {
  if (!est) return { ok: false, shiftPt: null, maxPt: null, scalePct: null, deg: null };
  const e = simError(est, truth, w, h);
  return {
    ok: e.maxPt <= 0.5 && Math.abs(e.scalePct) <= 0.05 && Math.abs(e.deg) <= 0.05,
    shiftPt: r3(e.shiftPt),
    maxPt: r3(e.maxPt),
    scalePct: r4(e.scalePct),
    deg: r4(e.deg),
  };
};

const describeSim = (s: Sim) => ({
  scale: r4(scaleOf(s)),
  deg: r3(degOf(s)),
  tx: r2(s.tx),
  ty: r2(s.ty),
});

if (run('align')) {
  const cv = await opencv();
  console.log(
    cv
      ? `OpenCV.js loaded in ${String(r2(cv.loadMs))} ms`
      : 'OpenCV.js not installed: route 2 skipped',
  );
  const rows: Record<string, unknown>[] = [];
  const vcs = await vectorCases();
  // Warm-up (JIT) so the first case's times are comparable.
  const first = vcs[0];
  if (first) await route1Vector(first.docA, first.ia, first.docB, first.ib);
  for (const c of vcs) {
    const truth = matToSim(c.truth);
    const A = pageInfo(c.docA, c.ia);
    const r1 = await route1Vector(c.docA, c.ia, c.docB, c.ib);
    const row: Record<string, unknown> = {
      case: c.name,
      truth: describeSim(truth),
      truthNonSim: r4(nonSimilarity(c.truth)),
      route1: {
        ...errRow(r1.sim, truth, A.w, A.h),
        coarse: errRow(r1.coarse, truth, A.w, A.h),
        ms: Object.fromEntries(Object.entries(r1.ms).map(([k, v]) => [k, Math.round(v)])),
        features: r1.features,
        inlierShare: r3(r1.inlierShare),
        rmsPt: r3(r1.rms),
      },
    };
    if (cv) {
      for (const dpi of [100, 150]) {
        const s = dpi / 72;
        const B = pageInfo(c.docB, c.ib);
        const t0 = performance.now();
        const a = renderInk(c.docA, c.ia, {
          scale: s,
          width: Math.ceil(A.w * s),
          height: Math.ceil(A.h * s),
        });
        const b = renderInk(c.docB, c.ib, {
          scale: s,
          width: Math.ceil(B.w * s),
          height: Math.ceil(B.h * s),
        });
        const renderMs = performance.now() - t0;
        const o = orbAlign(cv.cv, a, s, b, s);
        row[`route2_${String(dpi)}`] = {
          ...errRow(o.sim, truth, A.w, A.h),
          ms: {
            render: Math.round(renderMs),
            orb: Math.round(o.ms),
            total: Math.round(renderMs + o.ms),
          },
          keypoints: [o.keypointsA, o.keypointsB],
          matches: o.matches,
          inliers: o.inliers,
        };
      }
    }
    rows.push(row);
    const r2row = row.route2_150 as { maxPt: number | null; ok: boolean } | undefined;
    console.log(
      `${c.name.padEnd(44)} r1 ${String((row.route1 as { maxPt: number }).maxPt).padStart(7)} pt ${
        (row.route1 as { ok: boolean }).ok ? 'ok ' : 'BAD'
      } ${String(Math.round(r1.ms.total)).padStart(5)} ms` +
        (r2row
          ? ` | r2@150 ${String(r2row.maxPt).padStart(7)} pt ${r2row.ok ? 'ok ' : 'BAD'}`
          : ''),
    );
  }
  // Scans.
  const scans = await scanCases();
  for (const c of scans) {
    const r = alignRaster(c.a, c.aScale, c.b, c.bScale);
    const lvl = 150 / 72;
    const bl = renderLike(c.b, c.bScale, lvl);
    const res = residual(place(c.a, c.aScale, r.sim, lvl, bl.w, bl.h), bl);
    const row: Record<string, unknown> = {
      case: c.name,
      truth: c.truth ? describeSim(c.truth) : null,
      route1: {
        ...(c.truth ? errRow(r.sim, c.truth, c.wA, c.hA) : { ok: null }),
        found: describeSim(r.sim),
        residualPx150: { median: r2(res.median), mean: r2(res.mean), share: r3(res.share) },
        ms: { coarse: Math.round(r.ms.coarse), fine: Math.round(r.ms.fine) },
        tiles: r.steps.map((s) => (s ? `${String(s.used)}/${String(s.tiles)}` : 'none')),
      },
    };
    if (cv) {
      const o = orbAlign(cv.cv, c.a, c.aScale, c.b, c.bScale);
      const res2 = o.sim ? residual(place(c.a, c.aScale, o.sim, lvl, bl.w, bl.h), bl) : null;
      row.route2 = {
        ...(c.truth ? errRow(o.sim, c.truth, c.wA, c.hA) : { ok: null }),
        found: o.sim ? describeSim(o.sim) : null,
        residualPx150: res2
          ? { median: r2(res2.median), mean: r2(res2.mean), share: r3(res2.share) }
          : null,
        ms: Math.round(o.ms),
        keypoints: [o.keypointsA, o.keypointsB],
        matches: o.matches,
        inliers: o.inliers,
      };
    }
    rows.push(row);
    console.log(`${c.name.padEnd(44)} ${JSON.stringify(row.route1)}`);
    if (row.route2) console.log(`${''.padEnd(44)} r2 ${JSON.stringify(row.route2)}`);
  }
  save('align', rows);
}

function renderLike(ink: Ink, from: number, to: number): Ink {
  return place(
    ink,
    from,
    { a: 1, b: 0, tx: 0, ty: 0 },
    to,
    Math.round((ink.w / from) * to),
    Math.round((ink.h / from) * to),
  );
}

// ---------------------------------------------------------------- "as is" ---

/** Every sheet pair of the corpus with its expected pairing (manifest). */
async function sheetPairs(): Promise<
  { id: string; ia: number; ib: number; docA: Doc; docB: Doc }[]
> {
  const expected: Record<string, [number, number][]> = {
    '05': [
      [0, 0],
      [1, 2],
      [2, 3],
    ],
    '17': [
      [0, 0],
      [1, 1],
      [3, 2],
      [4, 4],
      [5, 3],
    ],
  };
  const out: { id: string; ia: number; ib: number; docA: Doc; docB: Doc }[] = [];
  for (const p of corpusPairs('overlay')) {
    const docA = await corpusDoc(p.id, 'old');
    const docB = await corpusDoc(p.id, 'new');
    const pairs =
      expected[p.id] ??
      Array.from(
        { length: Math.min(docA.pages, docB.pages) },
        (_, i) => [i, i] as [number, number],
      );
    for (const [ia, ib] of pairs) out.push({ id: p.id, ia, ib, docA, docB });
  }
  return out;
}

function lowRes(
  doc: Doc,
  index: number,
  frameOf: Doc,
  frameIndex: number,
  t: Mat,
  dpi: number,
): { a: Ink; b: Ink } {
  return renderPair(doc, index, frameOf, frameIndex, t, dpi, false);
}

/** Share of A's feature points with a B feature point within `r` pt, A moved by `t`. */
async function featureShare(
  docA: Doc,
  ia: number,
  docB: Doc,
  ib: number,
  t: Sim,
  r: number,
): Promise<{ share: number; n: number; ms: number }> {
  const t0 = performance.now();
  const fA = features(await segments(docA, ia));
  const fB = features(await segments(docB, ib));
  if (fA.length === 0 || fB.length === 0) return { share: 0, n: 0, ms: performance.now() - t0 };
  const g = new PointGrid(fB, 2);
  let hit = 0;
  for (let i = 0; i < fA.length; i += 2) {
    const [x, y] = [
      t.a * (fA[i] ?? 0) - t.b * (fA[i + 1] ?? 0) + t.tx,
      t.b * (fA[i] ?? 0) + t.a * (fA[i + 1] ?? 0) + t.ty,
    ];
    if (g.near(x, y, r, 1).length) hit++;
  }
  return { share: hit / (fA.length / 2), n: fA.length / 2, ms: performance.now() - t0 };
}

if (run('asis')) {
  const rows: Record<string, unknown>[] = [];
  const I: Mat = [1, 0, 0, 1, 0, 0];
  for (const sp of await sheetPairs()) {
    const truth = sp.id === '06' ? null : truthMat(sp.docA, sp.ia, sp.docB, sp.ib);
    const ts = truth ? matToSim(truth) : null;
    const moved = ts
      ? Math.abs(scaleOf(ts) - 1) > 1e-4 ||
        Math.abs(degOf(ts)) > 1e-3 ||
        Math.hypot(ts.tx, ts.ty) > 0.05
      : true;
    const row: Record<string, unknown> = {
      sheet: `${sp.id} A${String(sp.ia + 1)}-B${String(sp.ib + 1)}`,
      moved,
    };
    for (const dpi of [36, 50, 72, 150]) {
      const t0 = performance.now();
      const p = lowRes(sp.docA, sp.ia, sp.docB, sp.ib, I, dpi);
      const asIs = matchScore(p.a, p.b, 64, 1);
      const ms = performance.now() - t0;
      let aligned: number | null = null;
      if (truth) {
        const q = lowRes(sp.docA, sp.ia, sp.docB, sp.ib, truth, dpi);
        aligned = matchScore(q.a, q.b, 64, 1);
      }
      row[`dpi${String(dpi)}`] = {
        asIs: r3(asIs),
        aligned: aligned === null ? null : r3(aligned),
        ms: Math.round(ms),
      };
    }
    if (sp.id !== '06') {
      const I0: Sim = { a: 1, b: 0, tx: 0, ty: 0 };
      const f = await featureShare(sp.docA, sp.ia, sp.docB, sp.ib, I0, 0.1);
      const r1 = await route1Vector(sp.docA, sp.ia, sp.docB, sp.ib);
      const after = await featureShare(sp.docA, sp.ia, sp.docB, sp.ib, r1.sim, 0.1);
      row.features = {
        asIs: r3(f.share),
        n: f.n,
        ms: Math.round(f.ms),
        aligned: r3(after.share),
        found: describeSim(r1.sim),
        foundErr: truth
          ? errRow(r1.sim, matToSim(truth), pageInfo(sp.docA, sp.ia).w, pageInfo(sp.docA, sp.ia).h)
          : null,
      };
    }
    rows.push(row);
    console.log(
      `${String(row.sheet).padEnd(14)} moved=${String(moved).padEnd(5)} feat ${JSON.stringify(row.features)}`,
    );
    console.log(
      `${String(row.sheet).padEnd(14)} moved=${String(moved).padEnd(5)} ${JSON.stringify(row.dpi50)} ${JSON.stringify(row.dpi150)}`,
    );
  }
  // Small moves: B moved in memory by less than the low-resolution tolerance.
  const micro: [string, number, Mat, string][] = [
    ['01', 0, [1, 0, 0, 1, 0.5, 0], '0.5 pt'],
    ['01', 0, [1, 0, 0, 1, 1, 0], '1 pt'],
    ['01', 0, [1, 0, 0, 1, 2, 0], '2 pt'],
    ['14', 0, [1, 0, 0, 1, 0.5, 0.5], '0.7 pt'],
    ['14', 0, [1, 0, 0, 1, 1.5, 0], '1.5 pt'],
    [
      '10',
      1,
      simToMat({ a: Math.cos(0.002), b: Math.sin(0.002), tx: 0, ty: 0 }),
      '0.11° about the corner',
    ],
    ['10', 1, simToMat({ a: 1.001, b: 0, tx: 0, ty: 0 }), '100.1 %'],
  ];
  for (const [id, i, m, label] of micro) {
    const docA = await corpusDoc(id, 'old');
    const docB = await freshCorpusDoc(id, 'new');
    movePage(docB, i, m);
    const row: Record<string, unknown> = {
      sheet: `${id} P${String(i + 1)} moved ${label}`,
      moved: true,
    };
    row.features = {
      asIs: r3((await featureShare(docA, i, docB, i, { a: 1, b: 0, tx: 0, ty: 0 }, 0.1)).share),
    };
    for (const dpi of [50, 150]) {
      const p = lowRes(docA, i, docB, i, I, dpi);
      row[`dpi${String(dpi)}`] = { asIs: r3(matchScore(p.a, p.b, 64, 1)) };
    }
    rows.push(row);
    console.log(
      `${String(row.sheet).padEnd(30)} ${JSON.stringify(row.features)} ${JSON.stringify(row.dpi50)} ${JSON.stringify(row.dpi150)}`,
    );
    docB.close();
  }
  save('asis', rows);
}

// --------------------------------------------------------------- pairing ---

if (run('pairing')) {
  const expected: Record<
    string,
    { pairs: [number, number][]; removed: number[]; added: number[] }
  > = {
    '05': {
      pairs: [
        [0, 0],
        [1, 2],
        [2, 3],
      ],
      removed: [],
      added: [1],
    },
    '17': {
      pairs: [
        [0, 0],
        [1, 1],
        [3, 2],
        [5, 3],
        [4, 4],
      ],
      removed: [2],
      added: [],
    },
  };
  const rows: Record<string, unknown>[] = [];
  for (const p of corpusPairs('overlay')) {
    const docA = await corpusDoc(p.id, 'old');
    const docB = await corpusDoc(p.id, 'new');
    const t0 = performance.now();
    const sig = (doc: Doc, i: number): Signature => {
      const info = pageInfo(doc, i);
      const s = 72 / Math.max(info.w, info.h); // longest side 72 px
      const ink = renderInk(doc, i, {
        scale: s,
        width: Math.ceil(info.w * s),
        height: Math.ceil(info.h * s),
      });
      return {
        ink: inkSignature(ink),
        landscape: info.w >= info.h,
        words: wordBag(words(glyphs(doc, i))),
      };
    };
    const sa = Array.from({ length: docA.pages }, (_, i) => sig(docA, i));
    const sb = Array.from({ length: docB.pages }, (_, i) => sig(docB, i));
    const sigMs = (performance.now() - t0) / (docA.pages + docB.pages);
    const exp = expected[p.id] ?? {
      pairs: Array.from(
        { length: Math.min(docA.pages, docB.pages) },
        (_, i) => [i, i] as [number, number],
      ),
      removed: [],
      added: [],
    };
    const row: Record<string, unknown> = {
      pair: p.id,
      pages: [docA.pages, docB.pages],
      sigMsPerPage: r2(sigMs),
    };
    for (const mode of ['ink', 'text', 'both'] as const) {
      const { sim } = similarity(sa, sb, mode);
      const res = assignPairs(sim, 0.35);
      const correct = JSON.stringify(res) === JSON.stringify(exp);
      // Margin: each true pair's similarity minus the best wrong candidate in its row and column.
      let margin = Infinity;
      for (const [i, j] of exp.pairs) {
        const s0 = sim[i]?.[j] ?? 0;
        let other = -Infinity;
        (sim[i] ?? []).forEach((v, jj) => {
          if (jj !== j) other = Math.max(other, v);
        });
        sim.forEach((rowv, ii) => {
          if (ii !== i) other = Math.max(other, rowv[j] ?? -Infinity);
        });
        margin = Math.min(margin, s0 - (other === -Infinity ? 0.35 : other));
      }
      let lowestTrue = Infinity;
      for (const [i, j] of exp.pairs) lowestTrue = Math.min(lowestTrue, sim[i]?.[j] ?? 0);
      let highestUnpaired = -Infinity;
      for (const i of exp.removed)
        for (const v of sim[i] ?? []) highestUnpaired = Math.max(highestUnpaired, v);
      for (const j of exp.added)
        for (const rowv of sim) highestUnpaired = Math.max(highestUnpaired, rowv[j] ?? -Infinity);
      row[mode] = {
        correct,
        got: res,
        margin: r3(margin),
        lowestTrue: r3(lowestTrue),
        highestForUnpaired: highestUnpaired === -Infinity ? null : r3(highestUnpaired),
        matrix: sim.map((r) => r.map(r3)),
      };
    }
    rows.push(row);
    const b = row.both as {
      correct: boolean;
      margin: number;
      lowestTrue: number;
      highestForUnpaired: number | null;
    };
    const ik = row.ink as { correct: boolean; margin: number };
    console.log(
      `pair ${p.id} ${String(docA.pages)}→${String(docB.pages)}  both: ${b.correct ? 'ok ' : 'BAD'} margin ${String(b.margin)} lowest ${String(b.lowestTrue)} unpaired ${String(b.highestForUnpaired)} | ink only: ${ik.correct ? 'ok ' : 'BAD'} margin ${String(ik.margin)}`,
    );
  }
  save('pairing', rows);
}

// ---------------------------------------------------------------- detect ---

/** Route 1 on the scan pair (no recorded truth). */
function scanAlignment(docA: Doc, ia: number, docB: Doc, ib: number): Mat {
  const A = pageInfo(docA, ia);
  const B = pageInfo(docB, ib);
  const s = 150 / 72;
  const a = renderInk(docA, ia, {
    scale: s,
    width: Math.ceil(A.w * s),
    height: Math.ceil(A.h * s),
  });
  const b = renderInk(docB, ib, {
    scale: s,
    width: Math.ceil(B.w * s),
    height: Math.ceil(B.h * s),
  });
  return simToMat(alignRaster(a, s, b, s).sim);
}

/**
 * Visibility for the true differences: a point counts only where that side's
 * own rendering (A through the truth, B as is; 150 dpi, smooth) has ink within
 * 2 px. Removes white fills, clipped-away and hidden-layer geometry.
 */
function inkedBy(
  docA: Doc,
  ia: number,
  docB: Doc,
  ib: number,
  t: Mat,
): (side: 1 | 2, x: number, y: number, r: number) => boolean {
  const dpi = 150;
  const s = dpi / 72;
  const { a, b } = renderPair(docA, ia, docB, ib, t, dpi, false);
  const ma = dilate(mask(a, 40), a.w, a.h, 2);
  const mb = dilate(mask(b, 40), b.w, b.h, 2);
  return (side, x, y, r) => {
    const m = side === 1 ? ma : mb;
    const rp = Math.ceil(r * s);
    const cx = Math.floor(x * s);
    const cy = Math.floor(y * s);
    for (let py = Math.max(0, cy - rp); py <= Math.min(b.h - 1, cy + rp); py++)
      for (let px = Math.max(0, cx - rp); px <= Math.min(b.w - 1, cx + rp); px++)
        if (m[py * b.w + px] === 1) return true;
    return false;
  };
}

interface Score {
  truth: number;
  found: number;
  /** Found by the raster regions alone (no text layer). */
  foundRaster: number;
  missed: { box: number[]; textA: string; textB: string; px: number }[];
  regions: number;
  falseRegions: { box: number[]; removed: number; added: number }[];
}

function overlaps(
  r: { x0: number; y0: number; x1: number; y1: number },
  t: TruthItem,
  pad: number,
): boolean {
  return r.x0 <= t.x1 + pad && r.x1 >= t.x0 - pad && r.y0 <= t.y1 + pad && r.y1 >= t.y0 - pad;
}

function score(regions: Region[], textItems: TextChange[], truth: TruthItem[], pad: number): Score {
  const missed: Score['missed'] = [];
  let found = 0;
  let foundRaster = 0;
  for (const t of truth) {
    const byRaster = regions.some((r) => overlaps(r, t, pad));
    const hit = byRaster || textItems.some((w) => overlaps(w, t, pad));
    if (byRaster) foundRaster++;
    if (hit) found++;
    else
      missed.push({
        box: [t.x0, t.y0, t.x1, t.y1].map(r2),
        textA: t.textA,
        textB: t.textB,
        px: t.removed + t.added,
      });
  }
  const falseRegions = regions
    .filter((r) => !truth.some((t) => overlaps(r, t, pad + 4)))
    .map((r) => ({ box: [r.x0, r.y0, r.x1, r.y1].map(r2), removed: r.removed, added: r.added }));
  return { truth: truth.length, found, foundRaster, missed, regions: regions.length, falseRegions };
}

if (run('detect')) {
  const variants: { name: string; o: DetectOptions }[] = [];
  for (const dpi of [72, 100, 150, 200])
    variants.push({ name: `${String(dpi)}dpi tol1`, o: { ...DEFAULT_DETECT, dpi } });
  variants.push({ name: '150dpi tol2', o: { ...DEFAULT_DETECT, tol: 2 } });
  variants.push({ name: '150dpi tol1 min3', o: { ...DEFAULT_DETECT, minPx: 3 } });
  variants.push({ name: '100dpi tol1 min3', o: { ...DEFAULT_DETECT, dpi: 100, minPx: 3 } });
  variants.push({ name: '150dpi tol1 smooth', o: { ...DEFAULT_DETECT, aliased: false } });
  const rows: Record<string, unknown>[] = [];
  const sheets = await sheetPairs();
  const totals = new Map<
    string,
    {
      truth: number;
      found: number;
      foundRaster: number;
      falseRegions: number;
      controlFalse: number;
      ms: number[];
      peak: number[];
    }
  >();
  for (const sp of sheets) {
    const sheet = `${sp.id} A${String(sp.ia + 1)}-B${String(sp.ib + 1)}`;
    const isScan = sp.id === '06';
    // The scan pair has no recorded truth: it is aligned by route 1 first.
    const truthM: Mat = isScan
      ? scanAlignment(sp.docA, sp.ia, sp.docB, sp.ib)
      : truthMat(sp.docA, sp.ia, sp.docB, sp.ib);
    const segA = await segments(sp.docA, sp.ia);
    const segB = await segments(sp.docB, sp.ib);
    const ga = glyphs(sp.docA, sp.ia);
    const gb = glyphs(sp.docB, sp.ib);
    const truth = isScan
      ? []
      : truthDiff(
          segA,
          segB,
          ga,
          gb,
          truthM,
          [pageInfo(sp.docB, sp.ib).w, pageInfo(sp.docB, sp.ib).h],
          inkedBy(sp.docA, sp.ia, sp.docB, sp.ib, truthM),
        );
    const text = textChanges(ga, gb, truthM);
    const row: Record<string, unknown> = {
      sheet,
      truthItems: truth.map((t) => ({
        box: [t.x0, t.y0, t.x1, t.y1].map(r2),
        textA: t.textA,
        textB: t.textB,
        n: t.removed + t.added,
      })),
      textChanges: text.length,
    };
    for (const v of variants) {
      const heap0 = heapBytes(mod);
      const d = detect(sp.docA, sp.ia, sp.docB, sp.ib, truthM, v.o);
      const sc = score(d.regions, text, truth, 3);
      const tot = totals.get(v.name) ?? {
        truth: 0,
        found: 0,
        foundRaster: 0,
        falseRegions: 0,
        controlFalse: 0,
        ms: [],
        peak: [],
      };
      tot.truth += sc.truth;
      tot.found += sc.found;
      tot.foundRaster += sc.foundRaster;
      if (!isScan) tot.falseRegions += sc.falseRegions.length;
      if (truth.length === 0 && !isScan) tot.controlFalse += d.regions.length;
      tot.ms.push(d.renderMs + d.detectMs);
      tot.peak.push(d.peakBytes);
      totals.set(v.name, tot);
      row[v.name] = {
        found: `${String(sc.found)}/${String(sc.truth)}`,
        foundRaster: sc.foundRaster,
        regions: d.regions.length,
        falseRegions: sc.falseRegions,
        missed: sc.missed,
        changedPct: r3(d.changedPct),
        ms: { render: Math.round(d.renderMs), detect: Math.round(d.detectMs) },
        mpx: r2(d.pixels / 1e6),
        peakMB: r2(d.peakBytes / 1e6),
        heapGrowthMB: r2((heapBytes(mod) - heap0) / 1e6),
        ...(isScan
          ? {
              regionList: d.regions.map((r) => ({
                box: [r.x0, r.y0, r.x1, r.y1].map(r2),
                kind: r.kind,
                px: r.removed + r.added,
              })),
            }
          : {}),
      };
    }
    if (isScan) {
      // The setting proposed for scans: wider tolerance, darker ink, bigger regions.
      const d = detect(sp.docA, sp.ia, sp.docB, sp.ib, truthM, {
        ...DEFAULT_DETECT,
        tol: 3,
        minPx: 80,
        threshold: 128,
      });
      row['150dpi scan (tol3 min80 ink128)'] = {
        regions: d.regions.length,
        ms: { render: Math.round(d.renderMs), detect: Math.round(d.detectMs) },
        regionList: d.regions.map((r) => ({
          box: [r.x0, r.y0, r.x1, r.y1].map(r2),
          kind: r.kind,
          px: r.removed + r.added,
        })),
      };
      console.log(`06 scan setting: ${String(d.regions.length)} regions`);
    }
    rows.push(row);
    const v150 = row['150dpi tol1'] as
      | {
          found: string;
          regions: number;
          falseRegions: unknown[];
          ms: { render: number; detect: number };
        }
      | undefined;
    console.log(
      `${sheet.padEnd(12)} truth ${String(truth.length).padStart(3)} | 150/1: found ${v150?.found ?? '-'} regions ${String(v150?.regions ?? '-')} false ${String(v150?.falseRegions.length ?? '-')} ${String(v150 ? v150.ms.render + v150.ms.detect : '-')} ms`,
    );
  }
  const summary = [...totals].map(([name, t]) => ({
    variant: name,
    found: `${String(t.found)}/${String(t.truth)}`,
    foundByRasterAlone: t.foundRaster,
    falseRegions: t.falseRegions,
    controlFalse: t.controlFalse,
    msMedian: Math.round([...t.ms].sort((a, b) => a - b)[Math.floor(t.ms.length / 2)] ?? 0),
    msMax: Math.round(Math.max(...t.ms)),
    peakMBMax: r2(Math.max(...t.peak) / 1e6),
  }));
  console.table(summary);
  save('detect', { summary, rows });
}

// ------------------------------------------------------------------ size ---

if (run('size')) {
  const { build } = await import('esbuild');
  const res = await build({
    stdin: {
      contents: `export * from './align.ts'; export * from './geom.ts'; export * from './pairing.ts';`,
      resolveDir: here,
      loader: 'ts',
    },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    platform: 'browser',
  });
  const code = res.outputFiles[0]?.contents ?? new Uint8Array();
  const out: Record<string, unknown> = {
    route1: { minBytes: code.length, gzipBytes: gzipSync(code, { level: 9 }).length },
  };
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve(`${OPENCV_PACKAGE}/package.json`);
    const js = join(pkg, '..', 'dist', 'opencv.js');
    if (existsSync(js)) {
      const bytes = readFileSync(js);
      out.route2 = {
        package: `${OPENCV_PACKAGE}@${(JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version}`,
        file: 'dist/opencv.js (WASM inlined as base64)',
        bytes: statSync(js).size,
        gzipBytes: gzipSync(bytes, { level: 9 }).length,
      };
    }
  } catch {
    out.route2 = null;
  }
  console.log(JSON.stringify(out, null, 1));
  save('size', out);
}
