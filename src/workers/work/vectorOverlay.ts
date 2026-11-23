// The vector overlay PDF (M12-16, D-59; ADR-032: spike S29 route 2). One
// builder, used for Export Overlay…, for the result's "Vector overlay (beta)"
// display mode and (M12-20) for the comparison file's pages. Runs in the Work
// worker (rule 1), as a cancellable job with progress per sheet (rule 2).
//
// Step 1 (PDFium, as Extract/Merge do, ADR-016): a new document with one page
//   per sheet the size of the sheet's frame (B's displayed page; A's for a
//   sheet removed in B). Each revision's page becomes a Form XObject
//   (FPDF_NewXObjectFromPage): its drawing, fonts and images are copied
//   untouched, also out of an encrypted file (opened with its password), and
//   without its comments (Q10). PDFium writes it in full.
// Step 2 (our object layer, ADR-007): one incremental section gives each page
//   its overlay: A's form recoloured to A's colour, drawn through the
//   alignment (D-60), then B's recoloured form multiplied over it (both
//   isolated groups, S29 findings 2–3). Each side is clipped to its own page.
//   Layers: each source's layers are kept, merged into one /OCProperties under
//   "Old — file" and "New — file", visible as the overlay shows them (each
//   file's defaults with the comparison's layer switches, Q24).
// Step 3: PDFium opens the result and writes it once more in full: one
//   compact revision (the recolouring replaced the imported forms).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import {
  IDENTITY,
  applyAffine,
  invertAffine,
  thenAffine,
  type Affine,
} from '../../model/compare/material';
import type { Rgb } from '../../model/compare/overlay';
import { fromLatin1, latin1 } from '../../model/compare/vector/content';
import {
  Recolourer,
  fmt,
  matrixText,
  type ObjectSink,
  type RecolourStats,
} from '../../model/compare/vector/recolour';
import {
  D,
  N,
  PdfRef,
  PdfStream,
  PdfString,
  isDict,
  nameOf,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../model/pdf/objects';
import { PdfReader } from '../../model/pdf/reader';
import type { LayerStates } from '../shared/layerCopy';
import { acquirePage, docPtrOf, rawCall } from '../render/pdfium';
import { concatBytes } from '../render/save/bytes';
import { narrowTail, type ExtraObject } from '../render/save/narrowTail';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../render/save/writer';
import { saveBaseOf } from '../render/save/xref';
import { frameOf } from './compareMaterial';
import type { JobSlice } from './scheduler';

/** One revision's page on a sheet. */
export interface VectorSide {
  docId: string;
  pageIndex: number;
}

/** One page of the overlay. */
export interface VectorSheet {
  /** Document A's page (null: the sheet was added in B). */
  a: VectorSide | null;
  /** Document B's page (null: the sheet was removed from A). */
  b: VectorSide | null;
  /** A's displayed page → B's displayed page (the alignment, D-60); ignored without B. */
  place: Affine;
  /** Sides left out of the drawing (the display mode's show/hide); the frame stays. */
  hide?: { a?: boolean; b?: boolean };
}

export interface VectorOverlayRequest {
  sheets: VectorSheet[];
  /** Old (A) and new (B) colours (D-59). */
  colA: Rgb;
  colB: Rgb;
  /** Layer switches per document (Q24): a layer's object number → shown. */
  layers?: Record<string, LayerStates>;
  /**
   * The group names of each document's layers in a reader's layer panel
   * ("Old — RevA.pdf"), per side and document; localized by the caller.
   */
  labels: { a: Record<string, string>; b: Record<string, string> };
}

export interface VectorOverlayStats extends RecolourStats {
  pages: number;
  layers: number;
  ms: { import: number; overlay: number; compact: number };
}

/** What the builder needs of a document the Work worker holds. */
export interface VectorSource {
  /** EmbedPDF's id of the open copy (for its pages and PDFium pointer). */
  engineId: string;
  /** The document's current bytes read by our object layer (its layers), or null. */
  reader: () => Promise<PdfReader | null>;
}

export interface VectorEnv {
  mod: WrappedPdfiumModule;
  native: PdfiumNative;
  /** The current copy of a document (asked once per sheet: a reload may replace it). */
  source(docId: string): Promise<VectorSource>;
  slice: JobSlice;
  progress(p: { done: number; total: number }): void;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
}

/** A sheet's frame (points) and each side's placement on the new page. */
interface Placed {
  w: number;
  h: number;
  /** Each present side: its user space → the new page's user space, and its page in its own user space. */
  sides: { side: 'a' | 'b'; docId: string; pageIndex: number; toOut: Affine; clip: number[] }[];
}

/** Displayed space (y down) of a sheet `h` points tall → the new page's user space (y up). */
const displayToOut = (h: number): Affine => [1, 0, 0, -1, 0, h];

/** The rectangle [x0 y0 x1 y1] a map takes `w` × `h` (displayed) back to. */
function userRect(toDisplay: Affine, w: number, h: number): number[] {
  const inv = invertAffine(toDisplay);
  const pts = [
    applyAffine(inv, 0, 0),
    applyAffine(inv, w, 0),
    applyAffine(inv, 0, h),
    applyAffine(inv, w, h),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `N 0 obj <<dict>> stream … endstream endobj`, Flate-compressed. */
async function streamObject(num: number, dict: PdfDict, data: Uint8Array): Promise<Uint8Array> {
  const z = await deflate(data);
  const d = new Map(dict);
  d.delete('DecodeParms');
  d.set('Filter', N('FlateDecode'));
  d.set('Length', z.length);
  return concatBytes([
    fromLatin1(`${String(num)} 0 obj\n${serialize(d)}\nstream\n`),
    z,
    fromLatin1('\nendstream\nendobj'),
  ]);
}

/** A page's resources, inherited from the page tree where the page has none. */
async function pageResources(r: PdfReader, page: PdfDict): Promise<PdfValue | undefined> {
  let node: PdfDict | undefined = page;
  for (let depth = 0; node && depth < 64; depth++) {
    const res = node.get('Resources');
    if (res !== undefined) return r.resolve(res);
    const parent = await r.resolve(node.get('Parent'));
    node = isDict(parent) ? parent : undefined;
  }
  return undefined;
}

/** Whether each optional content group of a file is shown by default (its /OCProperties /D). */
async function layerDefaults(r: PdfReader): Promise<(num: number) => boolean> {
  const cat = await r.resolve(r.trailer.get('Root'));
  const ocp = isDict(cat) ? await r.resolve(cat.get('OCProperties')) : undefined;
  const d = isDict(ocp) ? await r.resolve(ocp.get('D')) : undefined;
  if (!isDict(d)) return () => true;
  const nums = async (key: string): Promise<Set<number>> => {
    const v = await r.resolve(d.get(key));
    return new Set(
      (Array.isArray(v) ? v : []).filter((x): x is PdfRef => x instanceof PdfRef).map((x) => x.num),
    );
  };
  const on = await nums('ON');
  const off = await nums('OFF');
  return nameOf(d.get('BaseState')) === 'OFF' ? (n) => on.has(n) : (n) => !off.has(n);
}

/**
 * Walks a source page's resources beside the imported form's copy of them
 * (PDFium copies the resource dictionaries key for key) and reports each
 * optional content group or membership dictionary of the source with its copy.
 */
async function pairLayers(
  src: PdfReader,
  srcRes: PdfValue | undefined,
  out: PdfReader,
  outRes: PdfValue | undefined,
  onPair: (srcNum: number, outNum: number, kind: 'OCG' | 'OCMD') => void,
  seen = new Set<number>(),
  depth = 0,
): Promise<void> {
  if (depth > 16) return;
  const [s, o] = [await src.resolve(srcRes), await out.resolve(outRes)];
  if (!isDict(s) || !isDict(o)) return;
  const pairOc = async (sv: PdfValue | undefined, ov: PdfValue | undefined): Promise<void> => {
    if (!(sv instanceof PdfRef) || !(ov instanceof PdfRef)) return;
    const [sd, od] = [await src.get(sv), await out.get(ov)];
    if (!isDict(sd) || !isDict(od)) return;
    const type = nameOf(od.get('Type'));
    if (type === 'OCG') onPair(sv.num, ov.num, 'OCG');
    else if (type === 'OCMD') {
      onPair(sv.num, ov.num, 'OCMD');
      const [sg, og] = [await src.resolve(sd.get('OCGs')), await out.resolve(od.get('OCGs'))];
      const sl = Array.isArray(sg) ? sg : [sg];
      const ol = Array.isArray(og) ? og : [og];
      for (let i = 0; i < Math.min(sl.length, ol.length); i++) await pairOc(sl[i], ol[i]);
    }
  };
  const [sp, op] = [await src.resolve(s.get('Properties')), await out.resolve(o.get('Properties'))];
  if (isDict(sp) && isDict(op)) for (const [k, ov] of op) await pairOc(sp.get(k), ov);
  const [sx, ox] = [await src.resolve(s.get('XObject')), await out.resolve(o.get('XObject'))];
  if (!isDict(sx) || !isDict(ox)) return;
  for (const [k, ov] of ox) {
    const sv = sx.get(k);
    if (!(ov instanceof PdfRef) || !(sv instanceof PdfRef) || seen.has(ov.num)) continue;
    seen.add(ov.num);
    const [sxo, oxo] = [await src.get(sv), await out.get(ov)];
    if (!(sxo instanceof PdfStream) || !(oxo instanceof PdfStream)) continue;
    await pairOc(sxo.dict.get('OC'), oxo.dict.get('OC'));
    if (nameOf(oxo.dict.get('Subtype')) === 'Form')
      await pairLayers(
        src,
        sxo.dict.get('Resources'),
        out,
        oxo.dict.get('Resources'),
        onPair,
        seen,
        depth + 1,
      );
  }
}

/** Every optional content group the imported form uses (when its source can't be read). */
async function formLayers(
  out: PdfReader,
  res: PdfValue | undefined,
  into: Set<number>,
  seen = new Set<number>(),
  depth = 0,
): Promise<void> {
  const d = await out.resolve(res);
  if (!isDict(d) || depth > 16) return;
  const add = async (v: PdfValue | undefined): Promise<void> => {
    if (!(v instanceof PdfRef)) return;
    const o = await out.get(v);
    if (!isDict(o)) return;
    if (nameOf(o.get('Type')) === 'OCG') into.add(v.num);
    else if (nameOf(o.get('Type')) === 'OCMD') {
      const g = await out.resolve(o.get('OCGs'));
      for (const x of Array.isArray(g) ? g : [g]) await add(x);
    }
  };
  const props = await out.resolve(d.get('Properties'));
  if (isDict(props)) for (const v of props.values()) await add(v);
  const xo = await out.resolve(d.get('XObject'));
  if (!isDict(xo)) return;
  for (const v of xo.values()) {
    if (!(v instanceof PdfRef) || seen.has(v.num)) continue;
    seen.add(v.num);
    const x = await out.get(v);
    if (!(x instanceof PdfStream)) continue;
    await add(x.dict.get('OC'));
    if (nameOf(x.dict.get('Subtype')) === 'Form')
      await formLayers(out, x.dict.get('Resources'), into, seen, depth + 1);
  }
}

/** The page forms PDFium's generated content draws, in order (A, then B). */
async function drawnForms(r: PdfReader, page: PdfDict): Promise<PdfRef[]> {
  const res = await r.resolve(page.get('Resources'));
  const xo = isDict(res) ? await r.resolve(res.get('XObject')) : undefined;
  const cs = await r.resolve(page.get('Contents'));
  let text = '';
  for (const c of Array.isArray(cs) ? cs : [cs]) {
    const st = await r.resolve(c);
    if (st instanceof PdfStream) text += `${latin1(await r.decode(st))}\n`;
  }
  return [...text.matchAll(/\/([^\s/[\]<>()]+)\s+Do\b/g)]
    .map((m) => (isDict(xo) ? xo.get(m[1] ?? '') : undefined))
    .filter((v): v is PdfRef => v instanceof PdfRef);
}

/** Step 1: one page per sheet, each revision's page imported as a form. */
async function importSheets(
  env: VectorEnv,
  sheets: readonly VectorSheet[],
): Promise<{ base: Uint8Array; placed: Placed[] }> {
  const { mod, native, slice } = env;
  const out = rawCall(mod, 'FPDF_CreateNewDocument');
  if (!out) throw new RpcError('vector-overlay', 'The overlay document could not be created');
  const placed: Placed[] = [];
  try {
    for (let i = 0; i < sheets.length; i++) {
      await slice.checkpoint();
      const sh = sheets[i];
      if (!sh || (!sh.a && !sh.b)) throw new RpcError('vector-overlay', 'An empty sheet');
      const frames = new Map<'a' | 'b', { ptr: number; f: ReturnType<typeof frameOf> }>();
      for (const side of ['a', 'b'] as const) {
        const s = sh[side];
        if (!s) continue;
        const src = await env.source(s.docId);
        const ptr = docPtrOf(native, src.engineId);
        const ref = acquirePage(native, src.engineId, s.pageIndex);
        try {
          frames.set(side, { ptr, f: frameOf(mod, ptr, s.pageIndex, ref.pagePtr) });
        } finally {
          ref.release();
        }
      }
      const frame = (frames.get('b') ?? frames.get('a'))?.f;
      if (!frame) throw new RpcError('vector-overlay', 'An empty sheet');
      const page = rawCall(mod, 'FPDFPage_New', out, i, frame.width, frame.height);
      if (!page) throw new RpcError('vector-overlay', 'The overlay page could not be made');
      const entry: Placed = { w: frame.width, h: frame.height, sides: [] };
      try {
        for (const side of ['a', 'b'] as const) {
          const s = sh[side];
          const fr = frames.get(side);
          if (!s || !fr || sh.hide?.[side]) continue;
          const x = rawCall(mod, 'FPDF_NewXObjectFromPage', out, fr.ptr, s.pageIndex);
          if (!x) throw new RpcError('vector-overlay', 'The page could not be copied');
          try {
            const form = rawCall(mod, 'FPDF_NewFormObjectFromXObject', x);
            if (!form) throw new RpcError('vector-overlay', 'The page could not be copied');
            rawCall(mod, 'FPDFPage_InsertObject', page, form);
          } finally {
            rawCall(mod, 'FPDF_CloseXObject', x);
          }
          // Its user space → its displayed space → (A, with B present) B's displayed space → our page.
          let m = fr.f.toDisplay;
          if (side === 'a' && frames.has('b')) m = thenAffine(m, sh.place);
          entry.sides.push({
            side,
            docId: s.docId,
            pageIndex: s.pageIndex,
            toOut: thenAffine(m, displayToOut(frame.height)),
            clip: userRect(fr.f.toDisplay, fr.f.width, fr.f.height),
          });
        }
        rawCall(mod, 'FPDFPage_GenerateContent', page);
      } finally {
        rawCall(mod, 'FPDF_ClosePage', page);
      }
      placed.push(entry);
    }
    await slice.checkpoint();
    return { base: saveWithFlags(mod, out, FPDF_NO_INCREMENTAL), placed };
  } finally {
    rawCall(mod, 'FPDF_CloseDocument', out);
  }
}

/** Step 3: PDFium writes the file once more, in full. */
function compact(mod: WrappedPdfiumModule, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const heap = mod.pdfium as unknown as Heap;
  const p = heap.wasmExports.malloc(bytes.length);
  heap.HEAPU8.set(bytes, p);
  const doc = rawCall(mod, 'FPDF_LoadMemDocument', p, bytes.length, '');
  try {
    if (!doc) throw new RpcError('vector-overlay', 'The overlay could not be reopened');
    return saveWithFlags(mod, doc, FPDF_NO_INCREMENTAL);
  } finally {
    if (doc) rawCall(mod, 'FPDF_CloseDocument', doc);
    heap.wasmExports.free(p);
  }
}

/** The vector overlay PDF of `req.sheets`, one page per sheet. */
export async function buildVectorOverlay(
  env: VectorEnv,
  req: VectorOverlayRequest,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; stats: VectorOverlayStats }> {
  const total = req.sheets.length;
  if (total === 0) throw new RpcError('vector-overlay', 'No sheets given');
  const t0 = performance.now();
  env.progress({ done: 0, total });
  const { base, placed } = await importSheets(env, req.sheets);
  const t1 = performance.now();

  const reader = await PdfReader.open(base);
  const pages = await reader.pages();
  let next = reader.maxObjNum();
  const extra: ExtraObject[] = [];
  const sink: ObjectSink = {
    alloc: () => ++next,
    put: (num, value) => {
      extra.push({ num, gen: 0, bytes: serializeIndirect(num, 0, value) });
    },
    putStream: async (num, dict, data) => {
      extra.push({ num, gen: 0, bytes: await streamObject(num, dict, data) });
    },
  };
  // Layers: each source group is copied once per sheet by PDFium; the first
  // copy stands for it everywhere (the recoloured forms point to it), so a
  // reader's layer panel lists each group once and switches it on every page.
  interface Group {
    side: 'a' | 'b';
    docId: string;
    /** The first copy of each source group, in the order met. */
    listed: number[];
  }
  const groups = new Map<string, Group>();
  /** Source document and object → its first copy (groups and membership dictionaries). */
  const firstCopy = new Map<string, number>();
  /** A later copy → the first copy. */
  const remap = new Map<number, number>();
  /** Every copy of a group → shown (later copies too: an image may still name one). */
  const shown = new Map<number, boolean>();
  const sourceReaders = new Map<string, Promise<PdfReader | null>>();
  const defaults = new Map<string, Promise<(n: number) => boolean>>();
  const readerOf = (docId: string): Promise<PdfReader | null> => {
    let r = sourceReaders.get(docId);
    if (!r) {
      r = env
        .source(docId)
        .then((s) => s.reader())
        .catch(() => null);
      sourceReaders.set(docId, r);
    }
    return r;
  };
  const recolour = new Recolourer(
    reader,
    sink,
    () => env.slice.checkpoint(),
    (n) => remap.get(n),
  );

  for (let i = 0; i < pages.length; i++) {
    await env.slice.checkpoint();
    const pg = pages[i];
    const pl = placed[i];
    if (!pg || !pl) continue;
    const forms = await drawnForms(reader, pg.dict);
    const lines: string[] = [`q 1 g 0 0 ${fmt(pl.w)} ${fmt(pl.h)} re f Q`];
    const xobjects: PdfDict = new Map();
    const gs: PdfDict = new Map();
    for (let k = 0; k < pl.sides.length; k++) {
      const s = pl.sides[k];
      const form = forms[k];
      if (!s || !form) continue;
      // Layers first: the copies of this sheet's groups, and their state.
      const formObj = await reader.get(form);
      const formRes = formObj instanceof PdfStream ? formObj.dict.get('Resources') : undefined;
      const key = `${s.side}\n${s.docId}`;
      const group = groups.get(key) ?? { side: s.side, docId: s.docId, listed: [] };
      groups.set(key, group);
      const src = await readerOf(s.docId);
      const states = req.layers?.[s.docId] ?? {};
      const srcPage = src ? (await src.pages())[s.pageIndex] : undefined;
      if (src && srcPage) {
        let def = defaults.get(s.docId);
        if (!def) {
          def = layerDefaults(src).catch(() => () => true);
          defaults.set(s.docId, def);
        }
        const isOn = await def;
        const srcRes = await pageResources(src, srcPage.dict);
        await pairLayers(src, srcRes, reader, formRes, (sn, on, kind) => {
          const k = `${s.side}\n${s.docId}\n${String(sn)}`;
          const first = firstCopy.get(k);
          if (first === undefined) {
            firstCopy.set(k, on);
            if (kind === 'OCG') group.listed.push(on);
          } else if (first !== on) remap.set(on, first);
          if (kind === 'OCG') shown.set(on, states[sn] ?? isOn(sn));
        });
      } else {
        // The source can't be read (encrypted beyond our reader): its groups as they are, shown.
        const found = new Set<number>();
        await formLayers(reader, formRes, found);
        for (const n of found)
          if (!shown.has(n)) {
            shown.set(n, true);
            group.listed.push(n);
          }
      }
      const col = s.side === 'a' ? req.colA : req.colB;
      const copy = await recolour.form(form, col, s.side, true);
      const name = s.side === 'a' ? 'Old' : 'New';
      xobjects.set(name, copy);
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = s.clip;
      // Clipped to its own page in its user space; PDFium's form carries a
      // /Matrix for a turned page (/Rotate), undone so the form draws in user space.
      const fm =
        formObj instanceof PdfStream ? await reader.resolve(formObj.dict.get('Matrix')) : undefined;
      const own =
        Array.isArray(fm) && fm.length === 6 && fm.every((v) => typeof v === 'number')
          ? (fm as Affine)
          : null;
      const undo =
        own && own.join(' ') !== '1 0 0 1 0 0' ? `${matrixText(invertAffine(own))} cm ` : '';
      const clip = `${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re W n ${undo}`;
      // B is multiplied onto A: ink in both is black, ink in one keeps its colour (Q4).
      const mul = s.side === 'b' && pl.sides.length > 1;
      if (mul) gs.set('Mul', D({ Type: N('ExtGState'), BM: N('Multiply') }));
      lines.push(`q ${mul ? '/Mul gs ' : ''}${matrixText(s.toOut)} cm ${clip}/${name} Do Q`);
    }
    const contentNum = sink.alloc();
    await sink.putStream(contentNum, new Map(), fromLatin1(lines.join('\n')));
    const page = new Map(pg.dict);
    page.set('Contents', new PdfRef(contentNum));
    page.set('Resources', D({ ...(gs.size ? { ExtGState: gs } : {}), XObject: xobjects }));
    page.set('Group', D({ S: N('Transparency'), CS: N('DeviceRGB') }));
    sink.put(pg.num, page);
    env.progress({ done: i + 1, total });
  }

  let layers = 0;
  const all = [...shown.keys()];
  if (all.length) {
    const rootRef = reader.trailer.get('Root');
    const cat = await reader.resolve(rootRef);
    if (rootRef instanceof PdfRef && isDict(cat)) {
      const order: PdfValue[] = [];
      for (const g of groups.values()) {
        if (!g.listed.length) continue;
        const label = req.labels[g.side][g.docId] ?? '';
        order.push([PdfString.of(label), ...g.listed.map((n) => new PdfRef(n))]);
      }
      const ocp = D({
        OCGs: all.map((n) => new PdfRef(n)),
        D: D({
          Name: PdfString.of('Overlay'),
          BaseState: N('ON'),
          OFF: all.filter((n) => shown.get(n) === false).map((n) => new PdfRef(n)),
          Order: order,
        }),
      });
      const c2 = new Map(cat);
      c2.set('OCProperties', ocp);
      sink.put(rootRef.num, c2);
      layers = all.length;
    }
  }
  extra.sort((x, y) => x.num - y.num);
  const tail = narrowTail(saveBaseOf(base), base, base.length, [], { extra, onlyExtra: true }).tail;
  const t2 = performance.now();
  await env.slice.checkpoint();
  const bytes = compact(env.mod, concatBytes([base, tail]));
  const t3 = performance.now();
  return {
    bytes,
    stats: {
      ...recolour.stats,
      pages: placed.length,
      layers,
      ms: { import: t1 - t0, overlay: t2 - t1, compact: t3 - t2 },
    },
  };
}

export { IDENTITY };
