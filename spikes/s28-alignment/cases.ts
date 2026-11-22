// Spike S28 (M12-03): the alignment cases. Corpus pages with their true
// alignment, plus moved copies made in memory (self-made, rule 13): a corpus
// page whose every object is moved by a known similarity through PDFium's
// edit API, and simulated scans (a page drawn through a known skew at 150
// dpi with paper tone and speckle noise, against the other revision at 200
// dpi).

import { readFileSync } from 'node:fs';
import {
  CORPUS_PASSWORDS,
  corpusFile,
  corpusPair,
} from '../../e2e/fixtures/comparison-corpus/index.ts';
import {
  invertSim,
  matToSim,
  rng,
  simFrom,
  simToMat,
  thenMat,
  type Mat,
  type Sim,
} from './geom.ts';
import type { Ink } from './image.ts';
import { call, openDoc, pageInfo, pdfium, renderInk, type Doc } from './pdfium.ts';
import { truthMat } from './truth.ts';

const docs = new Map<string, Doc>();

/** Opens a corpus file once (passwords from the loader). */
export async function corpusDoc(id: string, side: 'old' | 'new'): Promise<Doc> {
  const key = `${id}-${side}`;
  const hit = docs.get(key);
  if (hit) return hit;
  const mod = await pdfium();
  const file = corpusFile(corpusPair('overlay', id), side);
  const name = file.split(/[\\/]/).pop() ?? '';
  const doc = openDoc(mod, readFileSync(file), CORPUS_PASSWORDS[name]?.user ?? '');
  docs.set(key, doc);
  return doc;
}

/** A fresh copy of a corpus file (for in-memory edits). */
export async function freshCorpusDoc(id: string, side: 'old' | 'new'): Promise<Doc> {
  const mod = await pdfium();
  const file = corpusFile(corpusPair('overlay', id), side);
  const name = file.split(/[\\/]/).pop() ?? '';
  return openDoc(mod, readFileSync(file), CORPUS_PASSWORDS[name]?.user ?? '');
}

/** Moves every object of a page by a PDF matrix (user space) and regenerates its content. */
export function movePage(doc: Doc, index: number, m: Mat): void {
  const page = call(doc.mod, 'FPDF_LoadPage', doc.ptr, index);
  try {
    const n = call(doc.mod, 'FPDFPage_CountObjects', page);
    for (let i = 0; i < n; i++) {
      const o = call(doc.mod, 'FPDFPage_GetObject', page, i);
      call(doc.mod, 'FPDFPageObj_Transform', o, m[0], m[1], m[2], m[3], m[4], m[5]);
    }
    if (!call(doc.mod, 'FPDFPage_GenerateContent', page)) throw new Error('GenerateContent failed');
  } finally {
    call(doc.mod, 'FPDF_ClosePage', page);
  }
}

export interface VectorCase {
  name: string;
  kind: 'vector';
  docA: Doc;
  ia: number;
  docB: Doc;
  ib: number;
  truth: Mat;
  /** Moved in memory by the spike (not a corpus file as is). */
  synthetic: boolean;
}

export interface ScanCase {
  name: string;
  kind: 'scan';
  a: Ink;
  aScale: number;
  b: Ink;
  bScale: number;
  /** Null for the corpus scan pair 06 (truth not recorded in the file). */
  truth: Sim | null;
  wA: number;
  hA: number;
}

const userSim = (k: number, deg: number, tx: number, ty: number): Mat =>
  simToMat(simFrom(k, deg, tx, ty));

export async function vectorCases(): Promise<VectorCase[]> {
  const out: VectorCase[] = [];
  const corpus: [string, number, number, string][] = [
    ['03', 0, 0, 'P1 shift +14/−9 pt'],
    ['03', 1, 1, 'P2 98.2 % scale'],
    ['03', 2, 2, 'P3 aligned'],
    ['04', 0, 0, 'P1 1.2° skew'],
    ['04', 1, 1, 'P2 /Rotate 90'],
    ['09', 0, 0, 'P1 page boxes'],
    ['13', 0, 0, 'P1 ARCH D'],
    ['13', 1, 1, 'P2 ARCH E'],
    ['14', 0, 0, 'dense A1'],
    ['15', 0, 0, 'A1 vs A3'],
  ];
  for (const [id, ia, ib, label] of corpus) {
    const docA = await corpusDoc(id, 'old');
    const docB = await corpusDoc(id, 'new');
    out.push({
      name: `${id} ${label}`,
      kind: 'vector',
      docA,
      ia,
      docB,
      ib,
      truth: truthMat(docA, ia, docB, ib),
      synthetic: false,
    });
  }
  // Moved copies: B of a corpus pair moved by a known similarity in user space.
  const moved: [string, number, Mat, string][] = [
    ['14', 0, userSim(0.96, 0.6, 40, -25), 'dense A1 moved: 96 %, 0.6°, 40/−25 pt'],
    ['14', 0, userSim(1, -2.5, -60, 35), 'dense A1 moved: 2.5°, −60/35 pt'],
    ['08', 0, userSim(1.03, 0.8, -20, 15), 'hairlines moved: 103 %, 0.8°'],
    ['13', 1, userSim(0.985, -0.4, 30, 30), 'ARCH E moved: 98.5 %, −0.4°'],
    ['02', 0, userSim(1, 3, 25, -40), 'floor plan moved: 3°'],
  ];
  for (const [id, i, m, label] of moved) {
    const docA = await corpusDoc(id, 'old');
    const docB = await freshCorpusDoc(id, 'new');
    movePage(docB, i, m);
    out.push({
      name: `${id}* ${label}`,
      kind: 'vector',
      docA,
      ia: i,
      docB,
      ib: i,
      truth: truthMat(docA, i, docB, i),
      synthetic: true,
    });
  }
  return out;
}

/** Paper tone, blur-free speckle and dropouts, deterministic. */
function scanNoise(ink: Ink, seed: number, tone = 28, speckle = 0.004): Ink {
  const r = rng(seed);
  const data = new Uint8Array(ink.data.length);
  for (let i = 0; i < data.length; i++) {
    let v = (ink.data[i] ?? 0) * 0.9 + tone + (r() - 0.5) * 24;
    if (r() < speckle) v = 140 + r() * 115;
    if ((ink.data[i] ?? 0) > 0 && r() < 0.02) v = tone;
    data[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { w: ink.w, h: ink.h, data };
}

export async function scanCases(): Promise<ScanCase[]> {
  const out: ScanCase[] = [];
  // Corpus pair 06: two image-only pages (150 dpi, skewed, noisy / 200 dpi clean).
  {
    const docA = await corpusDoc('06', 'old');
    const docB = await corpusDoc('06', 'new');
    const ia = pageInfo(docA, 0);
    const ib = pageInfo(docB, 0);
    const sa = 150 / 72;
    const sb = 200 / 72;
    out.push({
      name: '06 scans 150/200 dpi, 0.5° skew',
      kind: 'scan',
      a: renderInk(docA, 0, {
        scale: sa,
        width: Math.ceil(ia.w * sa),
        height: Math.ceil(ia.h * sa),
      }),
      aScale: sa,
      b: renderInk(docB, 0, {
        scale: sb,
        width: Math.ceil(ib.w * sb),
        height: Math.ceil(ib.h * sb),
      }),
      bScale: sb,
      truth: null,
      wA: ia.w,
      hA: ia.h,
    });
  }
  // Simulated scans of vector pairs: A drawn through a skew S at 150 dpi with
  // noise; B clean at 200 dpi. Truth (A scan → B) = vector truth after S⁻¹.
  const sims: [string, number, Sim, string][] = [
    ['02', 0, simFrom(1, 0.5, 6, -4), 'floor plan, 0.5° skew'],
    ['08', 0, simFrom(1.012, -0.8, -9, 7), 'hairlines, 101.2 %, −0.8°'],
    ['14', 0, simFrom(1, 0.35, 12, 9), 'dense A1, 0.35° skew'],
    ['03', 1, simFrom(1, -1.1, 0, 0), 'P2 98.2 % + 1.1° skew'],
  ];
  let seed = 5;
  for (const [id, i, skew, label] of sims) {
    const docA = await corpusDoc(id, 'old');
    const docB = await corpusDoc(id, 'new');
    const ia = pageInfo(docA, i);
    const ib = pageInfo(docB, i);
    const sa = 150 / 72;
    const sb = 200 / 72;
    const a = scanNoise(
      renderInk(docA, i, {
        scale: sa,
        width: Math.ceil(ia.w * sa),
        height: Math.ceil(ia.h * sa),
        place: simToMat(skew),
      }),
      seed++,
    );
    const b = renderInk(docB, i, {
      scale: sb,
      width: Math.ceil(ib.w * sb),
      height: Math.ceil(ib.h * sb),
    });
    const vec = truthMat(docA, i, docB, i);
    // A scan pt → (S⁻¹) A page pt → (truth) B pt
    const inv = matToSim(thenMat(simToMat(invertSim(skew)), vec));
    out.push({
      name: `${id}~ simulated scan: ${label}`,
      kind: 'scan',
      a,
      aScale: sa,
      b,
      bScale: sb,
      truth: inv,
      wA: ia.w,
      hA: ia.h,
    });
  }
  return out;
}
