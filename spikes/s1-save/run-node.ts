// M0-S1 Node harness: correctness matrix, rewrite GC, tail growth, interop pack.
// Browser timings (worker + OPFS/FSA writes) are in the Playwright spec.
//
// Usage: node spikes/s1-save/make-fixtures.ts && node spikes/s1-save/run-node.ts
// Output: spikes/s1-save/out/results/s1-node.json and out/interop-pack/.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtypeName,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { everyToolAnnotation, manyMarkups } from './annotations.ts';
import {
  count,
  docPtrOf,
  isPrefix,
  narrowTail,
  objectNumbers,
  FPDF_INCREMENTAL,
  save,
  saveWithFlags,
  startxrefs,
  type SaveMode,
} from './save-core.ts';
import { checkSignature } from './sig-verify.ts';

const here = import.meta.dirname;
const root = join(here, '..', '..');
const fixtures = join(here, 'out', 'fixtures');
const results = join(here, 'out', 'results');
const pack = join(here, 'out', 'interop-pack');
mkdirSync(results, { recursive: true });
mkdirSync(pack, { recursive: true });

const mod: WrappedPdfiumModule = await init({
  wasmBinary: readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const stampPng = readFileSync(join(fixtures, 'stamp.png'));
const call = (name: string, ...a: (number | string)[]): number =>
  (mod as unknown as Record<string, (...x: (number | string)[]) => number>)[name]?.(...a) ?? NaN;

// new Uint8Array(x) copies; Buffer#slice would return a view of the shared pool.
const ab = (b: Uint8Array): ArrayBuffer => new Uint8Array(b).buffer;
let seq = 0;
async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return native.openDocumentBuffer({ id: `doc-${String(++seq)}`, content: ab(bytes) }).toPromise();
}

function qpdfCheck(file: string): string {
  try {
    const out = execFileSync('qpdf', ['--check', file], { stdio: 'pipe' }).toString();
    return out.includes('No syntax or stream encoding errors')
      ? 'ok'
      : (out.trim().split('\n').pop() ?? '');
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    // qpdf exit 3 = warnings only
    const text = `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`.trim();
    return `${err.status === 3 ? 'warnings' : 'FAIL'}: ${text.split('\n').slice(-3).join(' | ')}`;
  }
}

/** Run qpdf; exit status 3 means "succeeded with warnings". */
function qpdf(args: string[]): string {
  const r = spawnSync('qpdf', args, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 30 });
  if (r.status !== 0 && r.status !== 3) throw new Error(`qpdf ${args.join(' ')} failed`);
  return r.stdout.toString();
}

function encryption(file: string): { R: string; P: string; method: string } | 'none' {
  const out = qpdf(['--show-encryption', file]);
  if (out.includes('File is not encrypted')) return 'none';
  const get = (k: string): string => new RegExp(`^${k}(?: =|:) (.*)$`, 'm').exec(out)?.[1] ?? '?';
  return { R: get('R'), P: get('P'), method: get('stream encryption method') };
}

const subtypeNames: Record<number, string | undefined> = PdfAnnotationSubtypeName;

/** Annotation subtypes on page 0 and whether each has an /AP, via raw PDFium. */
function rawAnnots(doc: PdfDocumentObject): { subtype: string; hasAP: boolean; objnum: number }[] {
  const page = call('FPDF_LoadPage', docPtrOf(native, doc.id), 0);
  const n = call('FPDFPage_GetAnnotCount', page);
  const out: { subtype: string; hasAP: boolean; objnum: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = call('FPDFPage_GetAnnot', page, i);
    const st = call('FPDFAnnot_GetSubtype', a);
    out.push({
      subtype: subtypeNames[st] ?? String(st),
      // FPDFAnnot_HasKey is wrapped as returning a boolean.
      hasAP: Boolean(call('FPDFAnnot_HasKey', a, 'AP')),
      objnum: call('EPDFAnnot_GetObjectNumber', a),
    });
    call('FPDFPage_CloseAnnot', a);
  }
  call('FPDF_ClosePage', page);
  return out;
}

async function formValues(doc: PdfDocumentObject): Promise<Record<string, string>> {
  const page = doc.pages[0];
  if (!page) return {};
  const widgets = await native.getPageAnnoWidgets(doc, page).toPromise();
  return Object.fromEntries(widgets.map((w) => [w.field.name, w.field.value]));
}

/** Object number of the catalog's /AcroForm, from a throwaway incremental save. */
function acroFormObjnum(doc: PdfDocumentObject): number {
  const full = saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_INCREMENTAL).bytes;
  const text = new TextDecoder('latin1').decode(
    full.subarray(full.length - 200000 > 0 ? full.length - 200000 : 0),
  );
  const m = /\/AcroForm\s+(\d+)\s+\d+\s+R/.exec(text);
  return m ? Number(m[1]) : -1;
}

/** Semantic state for verification: every page's annotations, form values, page-0 pixels. */
async function state(bytes: Uint8Array): Promise<string> {
  const doc = await open(bytes);
  const pages: unknown[] = [];
  for (const page of doc.pages) {
    const annots = (await native
      .getPageAnnotations(doc, page)
      .toPromise()) as PdfAnnotationObject[];
    const rows = annots
      .map((a) => {
        const r = a.rect;
        return [
          a.type,
          Math.round(r.origin.x),
          Math.round(r.origin.y),
          Math.round(r.size.width),
          Math.round(r.size.height),
          a.contents ?? '',
          a.author ?? '',
          a.intent ?? '',
        ].join('|');
      })
      .sort();
    const widgets = await native.getPageAnnoWidgets(doc, page).toPromise();
    pages.push({ rows, form: widgets.map((w) => `${w.field.name}=${w.field.value}`).sort() });
  }
  const first = doc.pages[0];
  let pixels = 0;
  if (first) {
    const img = await native
      .renderPageRaw(doc, first, { scaleFactor: 0.5, withAnnotations: true, withForms: true })
      .toPromise();
    let h = 0;
    for (let i = 0; i < img.data.length; i += 7) h = (h * 31 + (img.data[i] ?? 0)) >>> 0;
    pixels = h;
  }
  await native.closeDocument(doc).toPromise();
  return JSON.stringify({ pages, pixels });
}

interface EditLog {
  permissions: number;
  annotateAllowed: boolean;
  created: Record<string, string>;
  formEdits?: string;
  /** Existing objects the edit layer knows it changed (for the narrow tail). */
  dirty: number[];
}

/** Add one annotation per tool (honouring permission flags) and edit form fields. */
async function edit(doc: PdfDocumentObject): Promise<EditLog> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const permissions = (await native.getDocPermissions(doc).toPromise()) as number;
  // Bit 6 (value 32): modify annotations / fill forms (ISO 32000-1 Table 22).
  const annotateAllowed = (permissions & 32) !== 0;
  const created: Record<string, string> = {};
  if (!annotateAllowed) return { permissions, annotateAllowed, created, dirty: [] };
  for (const t of everyToolAnnotation(0)) {
    try {
      const ctx = t.stampPng ? { data: ab(stampPng), mimeType: 'image/png' as const } : undefined;
      await native.createPageAnnotation(doc, page, t.annotation, ctx as never).toPromise();
      created[t.tool] = 'ok';
    } catch (e) {
      created[t.tool] = `FAIL ${JSON.stringify(e)}`;
    }
  }
  let formEdits: string | undefined;
  const widgets = await native.getPageAnnoWidgets(doc, page).toPromise();
  if (widgets.length > 0) {
    const log: string[] = [];
    for (const w of widgets) {
      if (w.field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD) {
        await native
          .setFormFieldValue(doc, page, w, { kind: 'text', text: 'Edited by S1' })
          .toPromise();
        log.push(`${w.field.name}=text`);
      } else if (w.field.type === PDF_FORM_FIELD_TYPE.CHECKBOX) {
        await native
          .setFormFieldValue(doc, page, w, { kind: 'checked', checked: false })
          .toPromise();
        log.push(`${w.field.name}=unchecked`);
      }
    }
    formEdits = log.join(', ');
  }
  // Form edits change existing widget/field dicts and possibly /AcroForm.
  const dirty = formEdits
    ? [
        ...rawAnnots(doc)
          .filter((a) => a.subtype === 'widget')
          .map((a) => a.objnum),
        acroFormObjnum(doc),
      ]
    : [];
  return { permissions, annotateAllowed, created, dirty, ...(formEdits ? { formEdits } : {}) };
}

const MODES: SaveMode[] = ['embedpdf', 'incremental', 'rewrite'];
const INPUTS = [
  'plain.pdf',
  'annotated.pdf',
  'form.pdf',
  'objstm.pdf',
  'encrypted-aes256.pdf',
  'encrypted-rc4-128.pdf',
  'encrypted-noannotate.pdf',
  'signed.pdf',
];

/**
 * Rigorous check that every object dropped from PDFium's tail is unchanged:
 * qpdf's JSON (decrypted, streams decoded) of the object in the original vs
 * in PDFium's full incremental output. /Length is ignored for streams.
 */
function droppedUnchanged(
  origFile: string,
  fullFile: string,
  dropped: number[],
  streamData: 'inline' | 'none',
): { checked: number; mismatches: unknown[] } {
  const objs = (f: string): Record<string, unknown> => {
    const out = qpdf([
      '--json=2',
      '--json-key=qpdf',
      `--json-stream-data=${streamData}`,
      '--decode-level=generalized',
      f,
    ]);
    const j = JSON.parse(out) as { qpdf: [unknown, Record<string, unknown>] };
    return j.qpdf[1];
  };
  const norm = (v: unknown): string =>
    JSON.stringify(v, (k, x: unknown) => (k === '/Length' ? undefined : x));
  // Differences PDFium introduces when re-serializing an object it did not edit:
  // float32 rounding of reals, /P written signed, /NM added to annotations it read.
  const same = (x: unknown, y: unknown, key = ''): boolean => {
    if (typeof x === 'number' && typeof y === 'number') {
      if (key === '/P') return (x | 0) === (y | 0);
      return Math.abs(x - y) <= 1e-5 * Math.max(1, Math.abs(x));
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      return x.length === y.length && x.every((v, i) => same(v, y[i]));
    }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const ox = x as Record<string, unknown>;
      const oy = y as Record<string, unknown>;
      const keys = new Set([...Object.keys(ox), ...Object.keys(oy)]);
      keys.delete('/Length');
      keys.delete('/NM');
      return [...keys].every((k) => same(ox[k], oy[k], k));
    }
    return x === y;
  };
  const [a, b] = [objs(origFile), objs(fullFile)];
  const raw: number[] = [];
  const real: unknown[] = [];
  for (const n of dropped) {
    const key = `obj:${String(n)} 0 R`;
    if (norm(a[key]) === norm(b[key])) continue;
    raw.push(n);
    if (!same(a[key], b[key])) {
      real.push({
        obj: n,
        original: norm(a[key]).slice(0, 300),
        pdfium: norm(b[key]).slice(0, 300),
      });
    }
  }
  return {
    checked: dropped.length,
    reserializationOnly: raw.length - real.length,
    semanticMismatches: real.length,
    examples: real.slice(0, 3),
  } as unknown as { checked: number; mismatches: unknown[] };
}

const report: Record<string, unknown> = {};

// 1. Correctness matrix -------------------------------------------------------
const matrix: Record<string, unknown> = {};
for (const input of INPUTS) {
  const orig = new Uint8Array(readFileSync(join(fixtures, input)));
  const encIn = encryption(join(fixtures, input));
  const sigIn = await checkSignature(orig);
  for (const mode of MODES) {
    const doc = await open(orig);
    const editLog = await edit(doc);
    const saved = await save(mod, native, doc.id, mode);
    await native.closeDocument(doc).toPromise();
    const file = join(results, `${input.replace('.pdf', '')}__${mode}.pdf`);
    writeFileSync(file, saved.bytes);
    let narrow: Record<string, unknown> | undefined;
    if (mode === 'incremental') {
      const t0 = performance.now();
      const n = narrowTail(orig, saved.bytes, editLog.dirty);
      const narrowMs = performance.now() - t0;
      const nf = join(results, `${input.replace('.pdf', '')}__narrow.pdf`);
      writeFileSync(nf, n.bytes);
      copyFileSync(nf, join(pack, `${input.replace('.pdf', '')}__narrow.pdf`));
      const [sFull, sNarrow] = [await state(saved.bytes), await state(n.bytes)];
      narrow = {
        xrefKind: n.xrefKind,
        droppedUnchanged: droppedUnchanged(join(fixtures, input), file, n.droppedNums, 'inline'),
        bytes: n.bytes.length,
        tail: n.bytes.length - orig.length,
        narrowMs: Math.round(narrowMs * 10) / 10,
        kept: n.kept.length,
        dropped: n.dropped,
        originalIsPrefix: isPrefix(orig, n.bytes),
        qpdfCheck: qpdfCheck(nf),
        encryption: encryption(nf),
        signature: sigIn.present ? await checkSignature(n.bytes) : 'n/a',
        sameStateAsFullIncremental: sFull === sNarrow,
        keepAllFallback: (() => {
          const k = narrowTail(orig, saved.bytes, [], { keepAll: true });
          const kf = join(results, `${input.replace('.pdf', '')}__keepall.pdf`);
          writeFileSync(kf, k.bytes);
          return { tail: k.bytes.length - orig.length, qpdfCheck: qpdfCheck(kf) };
        })(),
      };
    }
    const name = `${input.replace('.pdf', '')}__${mode}.pdf`;

    const prefix = isPrefix(orig, saved.bytes);
    const tail = prefix ? saved.bytes.subarray(orig.length) : undefined;
    const back = await open(saved.bytes);
    const annots = rawAnnots(back);
    const form = await formValues(back);
    await native.closeDocument(back).toPromise();
    const sig = await checkSignature(saved.bytes);

    matrix[`${input} · ${mode}`] = {
      bytes: { original: orig.length, saved: saved.bytes.length, tail: tail?.length ?? null },
      saveMs: Math.round(saved.ms * 10) / 10,
      originalIsPrefix: prefix,
      revisions: startxrefs(saved.bytes).length,
      hasPrev: count(saved.bytes, '/Prev') > 0,
      tailObjects: tail ? objectNumbers(tail) : null,
      qpdfCheck: qpdfCheck(file),
      encryption: { input: encIn, output: encryption(file) },
      signature: sigIn.present ? { input: sigIn, output: sig } : 'n/a',
      edit: editLog,
      page0Annots: {
        count: annots.length,
        withoutAP: annots.filter((a) => !a.hasAP).map((a) => a.subtype),
        subtypes: annots.map((a) => a.subtype).join(','),
      },
      formValues: form,
      ...(narrow ? { narrow } : {}),
    };
    if (mode !== 'embedpdf') copyFileSync(file, join(pack, name));
  }
}
report.matrix = matrix;

// 2. Does the full rewrite drop unreferenced objects? ------------------------
{
  const orig = new Uint8Array(readFileSync(join(fixtures, 'orphan.pdf')));
  const out: Record<string, unknown> = {};
  for (const mode of MODES) {
    const doc = await open(orig);
    const saved = await save(mod, native, doc.id, mode);
    await native.closeDocument(doc).toPromise();
    out[mode] = {
      bytes: saved.bytes.length,
      orphanMarkerPresent: count(saved.bytes, 'ORPHAN-MARKER') > 0,
      flateStreams: count(saved.bytes, '/FlateDecode'),
      objectStreams: count(saved.bytes, '/ObjStm'),
      xrefStream: count(saved.bytes, '/Type/XRef') + count(saved.bytes, '/Type /XRef') > 0,
    };
  }
  report.rewriteGc = {
    input: { bytes: orig.length, orphanMarkerPresent: true, flateStreams: 0 },
    ...out,
  };
}

// 3. Timing: 100 markups on the small file ----------------------------------
{
  const orig = new Uint8Array(readFileSync(join(fixtures, 'plain.pdf')));
  const runs: {
    createMs: number;
    incrementalMs: number;
    rewriteMs: number;
    embedpdfMs: number;
    tail: number;
  }[] = [];
  for (let run = 0; run < 5; run++) {
    const doc = await open(orig);
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const t0 = performance.now();
    for (const a of manyMarkups(0, 100))
      await native.createPageAnnotation(doc, page, a).toPromise();
    const createMs = performance.now() - t0;
    const inc = await save(mod, native, doc.id, 'incremental');
    const rew = await save(mod, native, doc.id, 'rewrite');
    const emb = await save(mod, native, doc.id, 'embedpdf');
    await native.closeDocument(doc).toPromise();
    runs.push({
      createMs: Math.round(createMs),
      incrementalMs: Math.round(inc.ms * 10) / 10,
      rewriteMs: Math.round(rew.ms * 10) / 10,
      embedpdfMs: Math.round(emb.ms * 10) / 10,
      tail: inc.bytes.length - orig.length,
    });
  }
  report.hundredMarkupsNode = runs;
}

// 4. Incremental tail growth on a large public file -------------------------
const LARGE = join(root, 'corpus', 'bearing catalogue.pdf');
if (existsSync(LARGE)) {
  const orig = new Uint8Array(readFileSync(LARGE));
  const growth: Record<string, unknown> = {};
  for (const visit of [0, 50, 1152]) {
    const doc = await open(orig);
    // "Visiting" a page = what the viewer does: render a thumbnail of it.
    const tv = performance.now();
    for (const p of doc.pages.slice(0, visit)) {
      await native.renderThumbnailRaw(doc, p, { scaleFactor: 0.1 }).toPromise();
    }
    const visitMs = performance.now() - tv;
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    for (const a of manyMarkups(0, 1)) await native.createPageAnnotation(doc, page, a).toPromise();
    const inc = await save(mod, native, doc.id, 'incremental');
    const tail = inc.bytes.subarray(orig.length);
    const tn = performance.now();
    const nar = narrowTail(orig, inc.bytes);
    const narrowMs = performance.now() - tn;
    const fullFile = join(results, `large-visit${String(visit)}__incremental.pdf`);
    writeFileSync(fullFile, inc.bytes);
    const dropCheck = droppedUnchanged(
      LARGE,
      fullFile,
      nar.droppedNums,
      visit === 1152 ? 'inline' : 'none',
    );
    const t = { visitedPages: visit, visitMs: Math.round(visitMs) };
    let rew: { ms: number; bytes: number } | undefined;
    let emb: { ms: number } | undefined;
    if (visit === 0) {
      const r = await save(mod, native, doc.id, 'rewrite');
      rew = { ms: Math.round(r.ms), bytes: r.bytes.length };
      const e = await save(mod, native, doc.id, 'embedpdf');
      emb = { ms: Math.round(e.ms) };
    }
    await native.closeDocument(doc).toPromise();
    growth[`visited ${String(visit)}`] = {
      ...t,
      originalBytes: orig.length,
      prefix: isPrefix(orig, inc.bytes),
      incrementalMs: Math.round(inc.ms),
      tailBytes: tail.length,
      tailObjects: objectNumbers(tail).length,
      narrow: {
        tailBytes: nar.bytes.length - orig.length,
        kept: nar.kept,
        droppedUnchanged: dropCheck,
        ms: Math.round(narrowMs),
        qpdfCheck: (() => {
          const f = join(results, `large-visit${String(visit)}__narrow.pdf`);
          writeFileSync(f, nar.bytes);
          return qpdfCheck(f);
        })(),
        sameStateAsFullIncremental: (await state(inc.bytes)) === (await state(nar.bytes)),
      },
      ...(rew ? { rewrite: rew } : {}),
      ...(emb ? { embedpdfSaveAsCopyMs: emb.ms } : {}),
    };
  }
  report.largeFileTail = growth;
}

writeFileSync(join(results, 's1-node.json'), JSON.stringify(report, null, 2));
copyFileSync(join(fixtures, 'signer-cert.pem'), join(pack, 'signer-cert.pem'));
for (const f of INPUTS) copyFileSync(join(fixtures, f), join(pack, `original__${f}`));
console.log(JSON.stringify(report, null, 1));
