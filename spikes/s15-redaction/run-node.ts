// M4-02 spike, Node part (ADR-017): redaction through EmbedPDF's PDFium build
// (EPDFPage_ApplyRedactions, B8) on a self-made adversarial file, then our
// sanitize (sanitize.ts) and the location-based verification (verify.ts).
// Real PDFium (the WASM the workers load), our writer, qpdf on every output.
// Writes spikes/s15-redaction/out/s15-node.json.
//
//   node --import ./spikes/shared/ts-ext.ts spikes/s15-redaction/run-node.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import { a0Sheet } from '../../e2e/fixtures/generate.ts';
import { OWNER_PW, qpdfEncrypt, USER_PW } from '../../e2e/fixtures/encrypted.ts';
import { appendRevision } from '../../e2e/fixtures/signed.ts';
import { isDict, PdfStream, PdfString, type PdfValue } from '../../src/model/pdf/objects.ts';
import { PdfReader } from '../../src/model/pdf/reader.ts';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium.ts';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';
import { adversarialPdf, HIDDEN, KEPT, markedBulkPdf, REPEATED, SECRETS } from './fixtures.ts';
import { splitCrossingPaths, type SplitReport } from './pathsplit.ts';
import { sanitize } from './sanitize.ts';
import { Verifier, type Leak, type Rect } from './verify.ts';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const verifier = new Verifier(mod);
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float'): number;
};
const REDACT = 28; // FPDF_ANNOT_REDACT
let seq = 0;
const ms = (t: number) => Math.round((performance.now() - t) * 100) / 100;
const out: Record<string, unknown> = {};

async function open(bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> {
  const id = `r${String(++seq)}`;
  return native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
}
const close = (d: PdfDocumentObject) => native.closeDocument(d).toPromise();
const dptr = (d: PdfDocumentObject) => docPtrOf(native, d.id);
const call = (name: string, ...a: (number | string)[]) => rawCall(mod, name, ...a);

function qpdfCheck(bytes: Uint8Array, password?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 's15-'));
  writeFileSync(join(dir, 'f.pdf'), bytes);
  const r = spawnSync('qpdf', [
    '--check',
    ...(password ? [`--password=${password}`] : []),
    join(dir, 'f.pdf'),
  ]);
  return r.status === 0
    ? 'ok'
    : `exit ${String(r.status)}: ${r.stderr.toString().split('\n')[0] ?? ''}`;
}

/** Redact annotation rectangles per page index, read with PDFium. */
function redactRects(docPtr: number): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>();
  const pages = call('FPDF_GetPageCount', docPtr);
  const p = heap.wasmExports.malloc(16);
  for (let i = 0; i < pages; i++) {
    const page = call('FPDF_LoadPage', docPtr, i);
    const n = call('FPDFPage_GetAnnotCount', page);
    for (let k = 0; k < n; k++) {
      const a = call('FPDFPage_GetAnnot', page, k);
      if (call('FPDFAnnot_GetSubtype', a) === REDACT && call('FPDFAnnot_GetRect', a, p)) {
        const [l, t, r, b] = [0, 1, 2, 3].map((j) => heap.getValue(p + j * 4, 'float'));
        const list = out.get(i) ?? [];
        list.push([l ?? 0, Math.min(t ?? 0, b ?? 0), r ?? 0, Math.max(t ?? 0, b ?? 0)]);
        out.set(i, list);
      }
      call('FPDFPage_CloseAnnot', a);
    }
    call('FPDF_ClosePage', page);
  }
  heap.wasmExports.free(p);
  return out;
}

/** The whole location check over every page with rectangles. */
function checkLocations(
  docPtr: number,
  rects: Map<number, Rect[]>,
): { leaks: Leak[]; words: string[] } {
  const leaks: Leak[] = [];
  const words: string[] = [];
  for (const [i, rs] of rects) {
    const page = call('FPDF_LoadPage', docPtr, i);
    words.push(...verifier.textInRects(i, page, rs, leaks));
    verifier.objectsInRects(i, page, rs, docPtr, leaks);
    verifier.annotsInRects(i, page, rs, leaks);
    call('FPDF_ClosePage', page);
  }
  return { leaks, words };
}

/** Redacted words that do not also occur outside the rectangles in the source (B3). */
function wordsToSearch(sourceText: string, inRect: string[]): string[] {
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;
  const inside = new Map<string, number>();
  for (const w of inRect) inside.set(w, (inside.get(w) ?? 0) + 1);
  return [...inside].filter(([w, n]) => w.length >= 3 && count(sourceText, w) <= n).map(([w]) => w);
}

/** Every decoded stream and string in the file (a canary scan, stronger than text search). */
async function rawCanaries(bytes: Uint8Array, canaries: readonly string[], password?: string) {
  const r = await PdfReader.open(bytes, undefined, password ? { password } : {});
  const found = new Set<string>();
  const dec = new TextDecoder('latin1');
  const scan = (s: string) => {
    for (const c of canaries) if (s.includes(c)) found.add(c);
  };
  const walk = async (v: PdfValue, depth: number): Promise<void> => {
    if (depth > 30) return;
    if (v instanceof PdfString) scan(dec.decode(v.bytes));
    else if (Array.isArray(v)) for (const x of v) await walk(x, depth + 1);
    else if (isDict(v)) for (const x of v.values()) await walk(x, depth + 1);
    else if (v instanceof PdfStream) {
      await walk(v.dict, depth + 1);
      try {
        scan(dec.decode(await r.decode(v)));
      } catch {
        scan(dec.decode(v.raw));
      }
    }
  };
  for (const num of r.xref.keys()) {
    try {
      await walk(await r.get(num), 0);
    } catch {
      /* unreadable object: not a leak by itself */
    }
  }
  const revisions = (dec.decode(bytes).match(/startxref/g) ?? []).length;
  return { found: [...found], revisions, encrypted: r.encrypted };
}

interface PipelineResult {
  bytes: Uint8Array;
  split?: SplitReport;
  timings: Record<string, number>;
  engineOnlyLeaks?: Leak[];
  removedAnnots: number;
  sanitize: unknown;
}

/** Apply → remove intersecting annotations → rewrite → sanitize → rewrite (§7.9 steps 2–3). */
async function redact(
  source: Uint8Array,
  password: string | undefined,
  opts: { skipSanitize?: boolean; engineOnlyCheck?: boolean; splitPaths?: boolean } = {},
): Promise<PipelineResult & { rects: Map<number, Rect[]> }> {
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const doc = await open(source, password);
  const d = dptr(doc);
  const rects = redactRects(d);
  timings.openAndRead = ms(t0);
  t0 = performance.now();
  for (const i of rects.keys()) {
    const page = call('FPDF_LoadPage', d, i);
    call('EPDFPage_ApplyRedactions', page);
    call('FPDFPage_GenerateContent', page);
    call('FPDF_ClosePage', page);
  }
  timings.apply = ms(t0);
  const split: SplitReport[] = [];
  if (opts.splitPaths) {
    t0 = performance.now();
    for (const [i, rs] of rects) {
      const page = call('FPDF_LoadPage', d, i);
      split.push(splitCrossingPaths(mod, page, rs));
      call('FPDFPage_GenerateContent', page);
      call('FPDF_ClosePage', page);
    }
    timings.splitPaths = ms(t0);
  }
  let engineOnlyLeaks: Leak[] | undefined;
  if (opts.engineOnlyCheck) engineOnlyLeaks = checkLocations(d, rects).leaks;
  // Remove the annotations over redacted areas (and remember widgets for /Fields).
  t0 = performance.now();
  const removedWidgets = new Set<number>();
  let removedAnnots = 0;
  const p = heap.wasmExports.malloc(16);
  const pageObjs = new Map<number, Rect[]>();
  for (const [i, rs] of rects) {
    const page = call('FPDF_LoadPage', d, i);
    pageObjs.set(call('EPDFPage_GetObjectNumber', page), rs);
    for (let k = call('FPDFPage_GetAnnotCount', page) - 1; k >= 0; k--) {
      const a = call('FPDFPage_GetAnnot', page, k);
      let drop = false;
      if (call('FPDFAnnot_GetRect', a, p)) {
        const [l, t, r, b] = [0, 1, 2, 3].map((j) => heap.getValue(p + j * 4, 'float'));
        const box: Rect = [l ?? 0, Math.min(t ?? 0, b ?? 0), r ?? 0, Math.max(t ?? 0, b ?? 0)];
        drop = rs.some(
          (rc) => box[0] < rc[2] && box[2] > rc[0] && box[1] < rc[3] && box[3] > rc[1],
        );
        if (drop && call('FPDFAnnot_GetSubtype', a) === 20)
          removedWidgets.add(call('EPDFAnnot_GetObjectNumber', a));
      }
      call('FPDFPage_CloseAnnot', a);
      if (drop && call('FPDFPage_RemoveAnnot', page, k)) removedAnnots++;
    }
    call('FPDF_ClosePage', page);
  }
  heap.wasmExports.free(p);
  timings.removeAnnots = ms(t0);
  t0 = performance.now();
  const pass1 = saveWithFlags(mod, d, FPDF_NO_INCREMENTAL);
  timings.rewrite1 = ms(t0);
  await close(doc);
  if (opts.skipSanitize)
    return {
      bytes: pass1,
      timings,
      rects,
      removedAnnots,
      sanitize: 'skipped',
      ...(engineOnlyLeaks ? { engineOnlyLeaks } : {}),
    };
  t0 = performance.now();
  const s = await sanitize(pass1, pageObjs, removedWidgets, password);
  timings.sanitize = ms(t0);
  t0 = performance.now();
  const doc2 = await open(s.bytes, password);
  const pass2 = saveWithFlags(mod, dptr(doc2), FPDF_NO_INCREMENTAL);
  await close(doc2);
  timings.rewrite2 = ms(t0);
  return {
    bytes: pass2,
    timings,
    rects,
    removedAnnots,
    split: split.reduce(
      (a, x) => ({
        examined: a.examined + x.examined,
        replaced: a.replaced + x.replaced,
        newObjects: a.newObjects + x.newObjects,
        clipPathsLost: a.clipPathsLost + x.clipPathsLost,
        insideForms: a.insideForms + x.insideForms,
      }),
      { examined: 0, replaced: 0, newObjects: 0, clipPathsLost: 0, insideForms: 0 },
    ),
    sanitize: s.report,
    ...(engineOnlyLeaks ? { engineOnlyLeaks } : {}),
  };
}

/** §7.9 step 5 on an output: location check + string rule; also the canary scan. */
async function verifyOutput(
  output: Uint8Array,
  rects: Map<number, Rect[]>,
  search: string[],
  password?: string,
) {
  const t0 = performance.now();
  const doc = await open(output, password);
  const d = dptr(doc);
  const { leaks } = checkLocations(d, rects);
  const text = verifier.documentText(d);
  for (const w of search) if (text.includes(w)) leaks.push({ page: -1, kind: 'string', detail: w });
  const page1 = text.split('\n')[0]?.slice(0, 200) ?? '';
  await close(doc);
  const verifyMs = ms(t0);
  const canary = await rawCanaries(output, [...SECRETS, ...HIDDEN, ...KEPT, REPEATED], password);
  const byKind: Record<string, number> = {};
  for (const l of leaks)
    byKind[`p${String(l.page + 1)}:${l.kind}`] =
      (byKind[`p${String(l.page + 1)}:${l.kind}`] ?? 0) + 1;
  return {
    passed: leaks.length === 0,
    verifyMs,
    leaks: byKind,
    qpdf: qpdfCheck(output, password),
    secretsFoundRaw: canary.found.filter((c) => (SECRETS as readonly string[]).includes(c)),
    hiddenFoundRaw: canary.found.filter((c) => (HIDDEN as readonly string[]).includes(c)),
    keptInText: [...KEPT, REPEATED].filter((k) => text.includes(k)),
    keptInRawStrings: KEPT.filter((k) => canary.found.includes(k)),
    page1Text: page1,
    leakDetails: leaks.slice(0, 12).map((l) => `p${String(l.page + 1)}:${l.kind}:${l.detail}`),
    revisions: canary.revisions,
    encrypted: canary.encrypted,
  };
}

/** Total length of path edges outside rect `r` on a page (page space, flattened). */
function pathLengthOutside(docPtr: number, index: number, r: Rect): number {
  const page = call('FPDF_LoadPage', docPtr, index);
  const buf = heap.wasmExports.malloc(32);
  let total = 0;
  const n = call('FPDFPage_CountObjects', page);
  for (let i = 0; i < n; i++) {
    const obj = call('FPDFPage_GetObject', page, i);
    if (call('FPDFPageObj_GetType', obj) !== 2) continue;
    call('FPDFPageObj_GetMatrix', obj, buf);
    const m = [0, 1, 2, 3, 4, 5].map((k) => heap.getValue(buf + k * 4, 'float'));
    let prev: [number, number] | null = null;
    const segs = call('FPDFPath_CountSegments', obj);
    for (let k = 0; k < segs; k++) {
      const seg = call('FPDFPath_GetPathSegment', obj, k);
      call('FPDFPathSegment_GetPoint', seg, buf, buf + 4);
      const x = heap.getValue(buf, 'float');
      const y = heap.getValue(buf + 4, 'float');
      const p: [number, number] = [
        (m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
        (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0),
      ];
      if (prev && call('FPDFPathSegment_GetType', seg) !== 2) {
        const mx = (prev[0] + p[0]) / 2;
        const my = (prev[1] + p[1]) / 2;
        if (!(mx > r[0] && mx < r[2] && my > r[1] && my < r[3]))
          total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      }
      prev = p;
    }
  }
  heap.wasmExports.free(buf);
  call('FPDF_ClosePage', page);
  return total;
}

// ---- 1. Negative controls: the verifier on the unredacted source ----------------
const source = adversarialPdf();
{
  const doc = await open(source);
  const d = dptr(doc);
  const rects = redactRects(d);
  const { leaks, words } = checkLocations(d, rects);
  const text = verifier.documentText(d);
  await close(doc);
  const byKind: Record<string, number> = {};
  for (const l of leaks)
    byKind[`p${String(l.page + 1)}:${l.kind}`] =
      (byKind[`p${String(l.page + 1)}:${l.kind}`] ?? 0) + 1;
  out.negativeControlSource = {
    rectsPerPage: [...rects].map(([i, r]) => `${String(i + 1)}:${String(r.length)}`),
    leaks: byKind,
    wordsInRects: words,
    wordsToSearch: wordsToSearch(text, words),
    qpdfSource: qpdfCheck(source),
  };
}

// ---- 2. Engine only (apply, rewrite; no annotation removal, no sanitize) ---------
{
  const doc = await open(source);
  const d = dptr(doc);
  const rects = redactRects(d);
  const words = checkLocations(d, rects).words;
  const text = verifier.documentText(d);
  await close(doc);
  const search = wordsToSearch(text, words);
  const engine = await redact(source, undefined, { skipSanitize: true, engineOnlyCheck: true });
  const full = await redact(source, undefined, { splitPaths: true });
  out.engineOnly = {
    leaksRightAfterApply: engine.engineOnlyLeaks?.map(
      (l) => `p${String(l.page + 1)}:${l.kind}:${l.detail}`,
    ),
    removedAnnotsBySanitize: engine.removedAnnots,
    verify: await verifyOutput(engine.bytes, engine.rects, search),
  };
  out.fullPipeline = {
    split: full.split,
    timings: full.timings,
    removedAnnots: full.removedAnnots,
    sanitize: full.sanitize,
    bytes: full.bytes.length,
    verify: await verifyOutput(full.bytes, full.rects, search),
  };
  writeFileSync(new URL('./out/redacted.pdf', import.meta.url), full.bytes);
}

// ---- 3. Encrypted source (M4-Q4: keep the encryption) --------------------------
{
  const enc = qpdfEncrypt(source, USER_PW, OWNER_PW, ['256']);
  const doc = await open(enc, OWNER_PW);
  const d = dptr(doc);
  const rects = redactRects(d);
  const words = checkLocations(d, rects).words;
  const search = wordsToSearch(verifier.documentText(d), words);
  await close(doc);
  const r = await redact(enc, OWNER_PW, { splitPaths: true });
  out.encrypted = {
    timings: r.timings,
    verify: await verifyOutput(r.bytes, r.rects, search, OWNER_PW),
    opensWithUserPassword: await (async () => {
      try {
        await close(await open(r.bytes, USER_PW));
        return true;
      } catch {
        return false;
      }
    })(),
  };
}

// ---- 4. Timings: 200 pages × 3 marks; A0 sheet ----------------------------------
{
  const bulk = markedBulkPdf(200, 3);
  const t0 = performance.now();
  const doc = await open(bulk);
  const d = dptr(doc);
  const rects = redactRects(d);
  const words = checkLocations(d, rects).words;
  const search = wordsToSearch(verifier.documentText(d), words);
  await close(doc);
  const pre = ms(t0);
  const r = await redact(bulk, undefined, { splitPaths: true });
  const v = await verifyOutput(r.bytes, r.rects, search);
  out.bulk = {
    marks: [...rects.values()].reduce((a, x) => a + x.length, 0),
    preCaptureMs: pre,
    timings: r.timings,
    verifyMs: v.verifyMs,
    passed: v.passed,
    leaks: v.leaks,
    qpdf: v.qpdf,
    searchedWords: search.length,
  };

  const a0 = a0Sheet(200_000);
  const size = Number(
    /\/Size (\d+)/.exec(new TextDecoder('latin1').decode(a0.subarray(-200)))?.[1] ?? 0,
  );
  const marked = appendRevision(a0, [
    [
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3370 2384] /Contents 4 0 R /Annots [${String(size)} 0 R] >>`,
    ],
    [size, '<< /Type /Annot /Subtype /Redact /Rect [1000 800 1600 1200] /IC [0 0 0] >>'],
  ]);
  const a0Engine = await redact(marked, undefined);
  const ve = await verifyOutput(a0Engine.bytes, a0Engine.rects, []);
  const ra = await redact(marked, undefined, { splitPaths: true });
  const va = await verifyOutput(ra.bytes, ra.rects, []);
  // Geometry kept outside the rectangle: total path-segment length before and after.
  const outsideLength = async (bytes: Uint8Array) => {
    const doc = await open(bytes);
    const len = pathLengthOutside(dptr(doc), 0, [1000, 800, 1600, 1200]);
    await close(doc);
    return len;
  };
  out.a0 = {
    engineOnly: { passed: ve.passed, leaks: ve.leaks, bytes: a0Engine.bytes.length },
    withSplit: {
      split: ra.split,
      timings: ra.timings,
      verifyMs: va.verifyMs,
      passed: va.passed,
      leaks: va.leaks,
      qpdf: va.qpdf,
      bytes: ra.bytes.length,
    },
    strokeLengthOutsideRect: {
      source: Math.round(await outsideLength(marked)),
      engineOnly: Math.round(await outsideLength(a0Engine.bytes)),
      withSplit: Math.round(await outsideLength(ra.bytes)),
    },
  };
}

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/s15-node.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
