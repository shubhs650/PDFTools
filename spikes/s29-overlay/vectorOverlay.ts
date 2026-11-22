// Spike S29 (M12-04, D-59): the vector overlay PDF builder, routes 1 and 2.
//
// Step 1 (PDFium, as the Work worker's Extract/Merge does, ADR-016): a new
// document, one page per sheet the size of B's sheet as displayed; each
// revision's page becomes a Form XObject (FPDF_NewXObjectFromPage), so its
// drawing instructions, fonts and images are copied untouched — also out of
// an encrypted source opened with its password. PDFium does a full save.
//
// Step 2 (our object layer, ADR-007): one incremental section that gives each
// page its overlay content.
//   Route 1 "wrap and tint": each revision is a solid fill of its colour
//     through a luminosity soft mask whose group draws that revision's page
//     form on white; the mask's transfer function inverts it, so ink lets the
//     tint through and paper does not. B is painted with /BM /Multiply.
//   Route 2 "recolour": a copy of each page form with every colour
//     instruction rewritten to the tint of the same lightness; images and
//     shadings, which have no colour instruction to rewrite, are painted as
//     route 1 does (a tint through a mask made of that one object). B is an
//     isolated transparency group painted with /BM /Multiply.
// Optional content (layers): each revision keeps its own default visibility;
// the overlay's /OCProperties lists the layers of both under "Old" and "New".
//
// Step 3: PDFium opens the result and writes it once more in full, so the
// file is one compact revision (route 2's superseded form streams drop out).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  D,
  N,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  isDict,
  nameOf,
  numOf,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { PdfReader, inflateStream } from '../../src/model/pdf/reader';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { narrowTail, type ExtraObject } from '../../src/workers/render/save/narrowTail';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer';
import { saveBaseOf } from '../../src/workers/render/save/xref';
import type { Rgb } from './composite';
import { ascii85, fromLatin1, latin1, tokenize, type Instr } from './content';
import { call, invert, mul, type Matrix } from './pdfiumKit';
import { displayToOutUser, userToDisplay } from './sheet';

export type Route = 'wrap' | 'recolour';

export interface Source {
  doc: number;
  /** The file's bytes and password, for its layer defaults (our reader). */
  bytes: Uint8Array;
  password?: string;
  /** Shown in the layer list ("Old — RevA.pdf"). */
  label: string;
}

export interface SheetSpec {
  a?: { source: Source; index: number };
  b?: { source: Source; index: number };
  /** A's display space → B's display space (the alignment, D-60). Identity if absent. */
  aToB?: Matrix | undefined;
}

export interface BuildOptions {
  route: Route;
  colA: Rgb;
  colB: Rgb;
  /** Skip step 3 (to measure the uncompacted file). */
  noCompact?: boolean;
}

export interface BuildStats {
  ms: { import: number; overlay: number; compact: number };
  /** Route 2: colour instructions rewritten, objects masked, things left as they were. */
  recolour?: {
    colours: number;
    images: number;
    shadings: number;
    patterns: number;
    inlineImages: number;
    forms: number;
    objectMasks: number;
  };
  layers: number;
}

const fmt = (n: number): string => {
  const s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};
const mStr = (m: Matrix): string => m.map(fmt).join(' ');
const rgbStr = (c: Rgb): string => c.map((v) => fmt(v / 255)).join(' ');

interface PageBoxInfo {
  rotate: number;
  box: [number, number, number, number];
  w: number;
  h: number;
}

function pageBoxInfo(mod: WrappedPdfiumModule, doc: number, index: number): PageBoxInfo {
  const heap = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    HEAPF32: Float32Array;
  };
  const page = call(mod, 'FPDF_LoadPage', doc, index);
  const p = heap.wasmExports.malloc(16);
  try {
    const rotate = call(mod, 'FPDFPage_GetRotation', page) & 3;
    const ok =
      call(mod, 'FPDFPage_GetCropBox', page, p, p + 4, p + 8, p + 12) ||
      call(mod, 'FPDFPage_GetMediaBox', page, p, p + 4, p + 8, p + 12);
    if (!ok) throw new Error('page has no box');
    const f = heap.HEAPF32;
    const l = f[p >> 2] ?? 0;
    const b = f[(p >> 2) + 1] ?? 0;
    const r = f[(p >> 2) + 2] ?? 0;
    const t = f[(p >> 2) + 3] ?? 0;
    const box: [number, number, number, number] = [
      Math.min(l, r),
      Math.min(b, t),
      Math.max(l, r),
      Math.max(b, t),
    ];
    const bw = box[2] - box[0];
    const bh = box[3] - box[1];
    return { rotate, box, w: rotate % 2 ? bh : bw, h: rotate % 2 ? bw : bh };
  } finally {
    heap.wasmExports.free(p);
    call(mod, 'FPDF_ClosePage', page);
  }
}

/** `N 0 obj <<dict /Length>> stream … endstream endobj`. */
function streamObject(num: number, dict: PdfDict, data: Uint8Array): Uint8Array {
  const d = new Map(dict);
  d.delete('DecodeParms');
  d.set('Length', data.length);
  return concatBytes([
    fromLatin1(`${String(num)} 0 obj\n${serialize(d)}\nstream\n`),
    data,
    fromLatin1('\nendstream\nendobj'),
  ]);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  void w.write(data as Uint8Array<ArrayBuffer>);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/** Decoded stream data: Flate and ASCII85 (any order), else null. */
async function decodeAny(reader: PdfReader, s: PdfStream): Promise<Uint8Array | null> {
  const f = s.dict.get('Filter');
  const filters = Array.isArray(f) ? f.map(nameOf) : f ? [nameOf(f)] : [];
  if (filters.every((x) => x === 'FlateDecode')) return reader.decode(s);
  if (s.dict.has('DecodeParms')) return null;
  let data = s.raw;
  for (const x of filters) {
    if (x === 'ASCII85Decode') data = ascii85(data);
    else if (x === 'FlateDecode') data = await inflateStream(data);
    else return null;
  }
  return data;
}

/** Layer names a file hides by default (/OCProperties /D /OFF). */
async function layersOff(src: Source): Promise<Set<string>> {
  const r = await PdfReader.open(
    src.bytes,
    undefined,
    src.password ? { password: src.password } : {},
  );
  const cat = await r.resolve(r.trailer.get('Root'));
  const off = new Set<string>();
  if (!isDict(cat)) return off;
  const ocp = await r.resolve(cat.get('OCProperties'));
  if (!isDict(ocp)) return off;
  const d = await r.resolve(ocp.get('D'));
  const list = isDict(d) ? await r.resolve(d.get('OFF')) : undefined;
  for (const ref of Array.isArray(list) ? list : []) {
    const g = await r.resolve(ref);
    const name = isDict(g) ? g.get('Name') : undefined;
    if (name instanceof PdfString) off.add(name.text());
  }
  if (isDict(d) && nameOf(d.get('BaseState')) === 'OFF') off.add('\u0000all');
  return off;
}

export async function buildVectorOverlay(
  mod: WrappedPdfiumModule,
  sheets: readonly SheetSpec[],
  opts: BuildOptions,
): Promise<{ bytes: Uint8Array; stats: BuildStats }> {
  const t0 = performance.now();
  // ---- Step 1: PDFium imports each revision's page as a form. ----
  const out = call(mod, 'FPDF_CreateNewDocument');
  const placed: { size: { w: number; h: number }; a?: Matrix; b?: Matrix }[] = [];
  let base: Uint8Array;
  try {
    sheets.forEach((sh, i) => {
      const ib = sh.b ? pageBoxInfo(mod, sh.b.source.doc, sh.b.index) : undefined;
      const ia = sh.a ? pageBoxInfo(mod, sh.a.source.doc, sh.a.index) : undefined;
      const frame = ib ?? ia;
      if (!frame) throw new Error('empty sheet');
      const page = call(mod, 'FPDFPage_New', out, i, frame.w, frame.h);
      const toOut = displayToOutUser(frame.h);
      const entry: (typeof placed)[number] = { size: { w: frame.w, h: frame.h } };
      for (const side of ['a', 'b'] as const) {
        const s = sh[side];
        const info = side === 'a' ? ia : ib;
        if (!s || !info) continue;
        const x = call(mod, 'FPDF_NewXObjectFromPage', out, s.source.doc, s.index);
        if (!x) throw new Error('the page could not be copied');
        const form = call(mod, 'FPDF_NewFormObjectFromXObject', x);
        call(mod, 'FPDFPage_InsertObject', page, form);
        call(mod, 'FPDF_CloseXObject', x);
        // Source user space → its display space → (A only) B's display space → our page.
        let m = userToDisplay(info.rotate, info.box);
        if (side === 'a' && sh.aToB) m = mul(m, sh.aToB);
        entry[side] = mul(m, toOut);
      }
      call(mod, 'FPDFPage_GenerateContent', page);
      call(mod, 'FPDF_ClosePage', page);
      placed.push(entry);
    });
    base = saveWithFlags(mod, out, FPDF_NO_INCREMENTAL);
  } finally {
    call(mod, 'FPDF_CloseDocument', out);
  }
  const t1 = performance.now();

  // ---- Step 2: our object layer writes the overlay content. ----
  const reader = await PdfReader.open(base);
  const pages = await reader.pages();
  let next = reader.maxObjNum();
  const extra: ExtraObject[] = [];
  const put = (num: number, value: PdfValue) => {
    extra.push({ num, gen: 0, bytes: serializeIndirect(num, 0, value) });
  };
  const putStream = async (num: number, dict: PdfDict, data: Uint8Array) => {
    const z = await deflate(data);
    const d = new Map(dict);
    d.set('Filter', N('FlateDecode'));
    extra.push({ num, gen: 0, bytes: streamObject(num, d, z) });
  };
  const stats: BuildStats = { ms: { import: t1 - t0, overlay: 0, compact: 0 }, layers: 0 };
  const rc = {
    colours: 0,
    images: 0,
    shadings: 0,
    patterns: 0,
    inlineImages: 0,
    forms: 0,
    objectMasks: 0,
  };
  if (opts.route === 'recolour') stats.recolour = rc;

  // Shared: the inverting transfer function (ink → opaque, paper → clear).
  const invertNum = ++next;
  put(invertNum, D({ FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 }));

  /** A luminosity soft mask whose group draws `draw` (with `res`) over white `bbox`. */
  const maskFor = async (bbox: number[], draw: string, res: PdfDict): Promise<number> => {
    const groupNum = ++next;
    const maskNum = ++next;
    const [x0, y0, x1, y1] = bbox as [number, number, number, number];
    await putStream(
      groupNum,
      D({
        Type: N('XObject'),
        Subtype: N('Form'),
        BBox: bbox,
        Group: D({ S: N('Transparency'), CS: N('DeviceGray') }),
        Resources: res,
      }),
      fromLatin1(`q 1 g ${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re f Q\n${draw}\n`),
    );
    put(
      maskNum,
      D({
        Type: N('Mask'),
        S: N('Luminosity'),
        G: new PdfRef(groupNum),
        BC: [1],
        TR: new PdfRef(invertNum),
      }),
    );
    return maskNum;
  };

  // Route 2: recoloured copies of forms, memoised per source form and side.
  const recoloured = new Map<string, number>();
  const recolourForm = async (
    ref: PdfRef,
    col: Rgb,
    side: 'a' | 'b',
    top = false,
  ): Promise<PdfRef> => {
    const key = `${side}:${String(ref.num)}:${String(top)}`;
    const hit = recoloured.get(key);
    if (hit) return new PdfRef(hit);
    const s = await reader.get(ref);
    if (!(s instanceof PdfStream)) return ref;
    const num = ++next;
    recoloured.set(key, num);
    rc.forms++;
    const data = await decodeAny(reader, s);
    const res = await reader.resolve(s.dict.get('Resources'));
    const resDict: PdfDict = isDict(res) ? new Map(res) : new Map<string, PdfValue>();
    const dict = new Map(s.dict);
    dict.delete('Filter');
    dict.delete('Length');
    // Each page form is an isolated group: B's own white fills cover only B,
    // then the whole group is multiplied onto A. A gets one too (Normal blend)
    // so both sides are drawn the same way: with only B in a group, Poppler
    // anti-aliased the two differently and unchanged lines got green fringes.
    if (top) dict.set('Group', D({ S: N('Transparency'), I: true, CS: N('DeviceRGB') }));
    let text: string;
    if (data === null) {
      // A filter we can't read: route 1 for the whole form.
      const bbox = (await reader.resolve(s.dict.get('BBox'))) as number[];
      const mask = await maskFor(bbox, '/F Do', D({ XObject: D({ F: ref }) }));
      resDict.set('ExtGState', D({ TintMask: D({ SMask: new PdfRef(mask) }) }));
      const [x0, y0, x1, y1] = bbox as [number, number, number, number];
      text = `q /TintMask gs ${rgbStr(col)} rg ${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re f Q`;
      dict.delete('Resources');
      dict.set('Resources', resDict);
      await putStream(num, dict, fromLatin1(text));
      return new PdfRef(num);
    }
    text = await recolourContent(latin1(data), resDict, col, side, top);
    dict.set('Resources', resDict);
    await putStream(num, dict, fromLatin1(text));
    return new PdfRef(num);
  };

  const recolourContent = async (
    src: string,
    res: PdfDict,
    col: Rgb,
    side: 'a' | 'b',
    top: boolean,
  ): Promise<string> => {
    const tint = (L: number) =>
      col.map((c) => fmt(Math.min(1, Math.max(0, L + (1 - L) * (c / 255))))).join(' ');
    const csRes = await reader.resolve(res.get('ColorSpace'));
    const xoRes = await reader.resolve(res.get('XObject'));
    const newXo: PdfDict = isDict(xoRes) ? new Map(xoRes) : new Map<string, PdfValue>();
    const newGs: PdfDict = new Map();
    const gsRes = await reader.resolve(res.get('ExtGState'));
    if (isDict(gsRes)) for (const [k, v] of gsRes) newGs.set(k, v);
    interface Space {
      kind: 'gray' | 'rgb' | 'cmyk' | 'lab' | 'sep' | 'devn' | 'indexed' | 'pattern';
    }
    const spaceOf = async (name: string): Promise<Space> => {
      const direct: Record<string, Space['kind']> = {
        DeviceGray: 'gray',
        G: 'gray',
        DeviceRGB: 'rgb',
        RGB: 'rgb',
        DeviceCMYK: 'cmyk',
        CMYK: 'cmyk',
        Pattern: 'pattern',
      };
      const d = direct[name];
      if (d) return { kind: d };
      const v = isDict(csRes) ? await reader.resolve(csRes.get(name)) : undefined;
      const arr = Array.isArray(v) ? v : [v];
      const fam = nameOf(arr[0]);
      if (fam === 'ICCBased') {
        const st = await reader.resolve(arr[1]);
        const n = st instanceof PdfStream ? numOf(st.dict.get('N')) : 3;
        return { kind: n === 1 ? 'gray' : n === 4 ? 'cmyk' : 'rgb' };
      }
      const map: Record<string, Space['kind']> = {
        CalGray: 'gray',
        CalRGB: 'rgb',
        Lab: 'lab',
        Separation: 'sep',
        DeviceN: 'devn',
        Indexed: 'indexed',
        Pattern: 'pattern',
        DeviceGray: 'gray',
        DeviceRGB: 'rgb',
        DeviceCMYK: 'cmyk',
      };
      return { kind: map[fam ?? ''] ?? 'rgb' };
    };
    const lum = (sp: Space, v: number[]): number => {
      const [a = 0, b = 0, c = 0, d = 0] = v;
      switch (sp.kind) {
        case 'gray':
          return a;
        case 'rgb':
          return 0.3 * a + 0.59 * b + 0.11 * c;
        case 'cmyk':
          return 0.3 * (1 - a) * (1 - d) + 0.59 * (1 - b) * (1 - d) + 0.11 * (1 - c) * (1 - d);
        case 'lab':
          return a / 100;
        case 'sep':
          return 1 - a;
        case 'devn':
          return 1 - Math.max(...v);
        default:
          return 0.5;
      }
    };
    // Graphics state the per-object masks need to replay: colour spaces (and
    // the raw colour instructions), stroke parameters, and the CTM relative
    // to the start of this stream (patterns are anchored there).
    interface St {
      fill: Space;
      stroke: Space;
      fillRaw: string[];
      strokeRaw: string[];
      lineRaw: Map<string, string>;
      ctm: Matrix;
    }
    const exact = (sp: Space) =>
      sp.kind === 'gray' || sp.kind === 'rgb' || sp.kind === 'cmyk' || sp.kind === 'lab';
    const stack: St[] = [];
    let cur: St = {
      fill: { kind: 'gray' },
      stroke: { kind: 'gray' },
      fillRaw: [],
      strokeRaw: [],
      lineRaw: new Map(),
      ctm: [1, 0, 0, 1, 0, 0],
    };
    // A page starts with black fill and stroke: the page form's start is set to
    // the full tint (a nested form inherits its caller's, already tinted).
    const outLines: string[] = top ? [`${tint(0)} rg ${tint(0)} RG`] : [];
    let maskSeq = 0;
    let path: string[] = [];
    let ins: Instr[];
    try {
      ins = tokenize(src);
    } catch {
      return src; // unreadable: left untinted here; M12-16 falls back to route 1's mask
    }
    const BIG = 20000;
    /** Paints the tint through a mask drawn by `draw` in the current space. */
    const masked = async (draw: string, rect: string, inv?: Matrix) => {
      const groupNum = ++next;
      const maskNum = ++next;
      await putStream(
        groupNum,
        D({
          Type: N('XObject'),
          Subtype: N('Form'),
          BBox: [-BIG, -BIG, BIG, BIG],
          ...(inv ? { Matrix: [...inv] } : {}),
          Group: D({ S: N('Transparency'), CS: N('DeviceGray') }),
          Resources: res,
        }),
        fromLatin1(
          `q 1 g ${String(-BIG)} ${String(-BIG)} ${String(2 * BIG)} ${String(2 * BIG)} re f Q\n${draw}\n`,
        ),
      );
      put(
        maskNum,
        D({
          Type: N('Mask'),
          S: N('Luminosity'),
          G: new PdfRef(groupNum),
          BC: [1],
          TR: new PdfRef(invertNum),
        }),
      );
      const gsName = `TintMask${String(++maskSeq)}`;
      newGs.set(gsName, D({ SMask: new PdfRef(maskNum) }));
      outLines.push(`q /${gsName} gs ${tint(0)} rg ${rect} re f Q`);
    };
    const FILLS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
    const STROKES = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);
    for (const it of ins) {
      const nums = it.operands
        .filter((o) => o.kind === 'num')
        .map((o) => (o as { value: number }).value);
      const nameOp = it.operands.find((o) => o.kind === 'name') as { value: string } | undefined;
      switch (it.op) {
        case 'q':
          stack.push({ ...cur, lineRaw: new Map(cur.lineRaw) });
          outLines.push('q');
          break;
        case 'Q':
          cur = stack.pop() ?? cur;
          outLines.push('Q');
          break;
        case 'cm': {
          const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = nums;
          cur = { ...cur, ctm: mul([a, b, c, d, e, f], cur.ctm) };
          outLines.push(it.raw);
          break;
        }
        case 'w':
        case 'J':
        case 'j':
        case 'M':
        case 'd':
          cur.lineRaw.set(it.op, it.raw);
          outLines.push(it.raw);
          break;
        case 'm':
        case 'l':
        case 'c':
        case 'v':
        case 'y':
        case 'h':
        case 're':
        case 'W':
        case 'W*':
          path.push(it.raw);
          break;
        case 'f':
        case 'F':
        case 'f*':
        case 'S':
        case 's':
        case 'B':
        case 'B*':
        case 'b':
        case 'b*':
        case 'n': {
          const needs =
            (FILLS.has(it.op) && !exact(cur.fill)) || (STROKES.has(it.op) && !exact(cur.stroke));
          if (!needs) {
            outLines.push(...path, it.raw);
          } else {
            // A spot, pattern, indexed or DeviceN paint: route 1 for this one
            // object. The clip (if any) is set first, then the tint is painted
            // through a mask that draws the original paint with its own colour.
            const clip = path.filter((x) => x === 'W' || x === 'W*');
            const shape = path.filter((x) => x !== 'W' && x !== 'W*');
            if (clip.length) outLines.push(...shape, clip[0] ?? 'W', 'n');
            const draw = [
              mStr(cur.ctm) + ' cm',
              ...cur.lineRaw.values(),
              ...cur.fillRaw,
              ...cur.strokeRaw,
              ...shape,
              it.raw,
            ].join('\n');
            await masked(
              draw,
              `${String(-BIG)} ${String(-BIG)} ${String(2 * BIG)} ${String(2 * BIG)}`,
              invert(cur.ctm),
            );
            rc.objectMasks++;
          }
          path = [];
          break;
        }
        case 'g':
        case 'rg':
        case 'k': {
          const sp: Space = { kind: it.op === 'g' ? 'gray' : it.op === 'rg' ? 'rgb' : 'cmyk' };
          cur = { ...cur, fill: sp, fillRaw: [it.raw] };
          outLines.push(`${tint(lum(sp, nums))} rg`);
          rc.colours++;
          break;
        }
        case 'G':
        case 'RG':
        case 'K': {
          const sp: Space = { kind: it.op === 'G' ? 'gray' : it.op === 'RG' ? 'rgb' : 'cmyk' };
          cur = { ...cur, stroke: sp, strokeRaw: [it.raw] };
          outLines.push(`${tint(lum(sp, nums))} RG`);
          rc.colours++;
          break;
        }
        case 'cs':
        case 'CS': {
          const sp = await spaceOf(nameOp?.value ?? 'DeviceGray');
          if (it.op === 'cs') cur = { ...cur, fill: sp, fillRaw: [it.raw] };
          else cur = { ...cur, stroke: sp, strokeRaw: [it.raw] };
          // The initial colour of a space is its darkest (black / full tint).
          outLines.push(`${tint(sp.kind === 'pattern' ? 0.5 : 0)} ${it.op === 'cs' ? 'rg' : 'RG'}`);
          rc.colours++;
          break;
        }
        case 'sc':
        case 'scn':
        case 'SC':
        case 'SCN': {
          const fill = it.op === 'sc' || it.op === 'scn';
          const sp = fill ? cur.fill : cur.stroke;
          if (sp.kind === 'pattern' || nameOp) rc.patterns++;
          if (fill) cur = { ...cur, fillRaw: [...cur.fillRaw.slice(0, 1), it.raw] };
          else cur = { ...cur, strokeRaw: [...cur.strokeRaw.slice(0, 1), it.raw] };
          // Approximate (text in a spot colour keeps this; paths are masked).
          outLines.push(`${tint(lum(sp, nums))} ${fill ? 'rg' : 'RG'}`);
          rc.colours++;
          break;
        }
        case 'Do': {
          const name = nameOp?.value ?? '';
          const ref = isDict(xoRes) ? xoRes.get(name) : undefined;
          const xo = await reader.resolve(ref);
          if (
            xo instanceof PdfStream &&
            nameOf(xo.dict.get('Subtype')) === 'Form' &&
            ref instanceof PdfRef
          ) {
            newXo.set(name, await recolourForm(ref, col, side));
            outLines.push(it.raw);
          } else if (
            xo instanceof PdfStream &&
            nameOf(xo.dict.get('Subtype')) === 'Image' &&
            xo.dict.get('ImageMask') !== true &&
            ref instanceof PdfRef
          ) {
            // An image: tint through a mask made of the image (unit square).
            await masked(`/${name} Do`, '0 0 1 1');
            rc.images++;
          } else outLines.push(it.raw);
          break;
        }
        case 'sh': {
          await masked(
            it.raw,
            `${String(-BIG)} ${String(-BIG)} ${String(2 * BIG)} ${String(2 * BIG)}`,
          );
          rc.shadings++;
          break;
        }
        case 'BI':
          if (/\/(IM|ImageMask)\s+true/.test(it.raw)) outLines.push(it.raw);
          else await masked(it.raw, '0 0 1 1');
          rc.inlineImages++;
          break;
        default:
          outLines.push(it.raw);
      }
    }
    if (path.length) outLines.push(...path);
    if (newXo.size) res.set('XObject', newXo);
    if (newGs.size) res.set('ExtGState', newGs);
    return outLines.join('\n');
  };

  const sideLayers: { side: 'a' | 'b'; label: string; refs: PdfRef[]; off: Set<string> }[] = [];
  const collectOcgs = async (
    formRef: PdfRef,
    into: Map<number, PdfDict>,
    seen = new Set<number>(),
  ) => {
    if (seen.has(formRef.num)) return;
    seen.add(formRef.num);
    const f = await reader.get(formRef);
    if (!(f instanceof PdfStream)) return;
    const res = await reader.resolve(f.dict.get('Resources'));
    if (!isDict(res)) return;
    const props = await reader.resolve(res.get('Properties'));
    if (isDict(props))
      for (const v of props.values()) {
        const o = await reader.resolve(v);
        if (!(v instanceof PdfRef) || !isDict(o)) continue;
        if (nameOf(o.get('Type')) === 'OCG') into.set(v.num, o);
        else if (nameOf(o.get('Type')) === 'OCMD') {
          const ocgs = await reader.resolve(o.get('OCGs'));
          for (const g of Array.isArray(ocgs) ? ocgs : [ocgs]) {
            const gd = await reader.resolve(g);
            if (g instanceof PdfRef && isDict(gd)) into.set(g.num, gd);
          }
        }
      }
    const xo = await reader.resolve(res.get('XObject'));
    if (isDict(xo))
      for (const v of xo.values()) if (v instanceof PdfRef) await collectOcgs(v, into, seen);
  };

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const sh = sheets[i];
    const pl = placed[i];
    if (!pg || !sh || !pl) continue;
    const res = await reader.resolve(pg.dict.get('Resources'));
    const xo = isDict(res) ? await reader.resolve(res.get('XObject')) : undefined;
    // PDFium's generated content draws the forms in insertion order (A, then B).
    const cs = await reader.resolve(pg.dict.get('Contents'));
    const csList = Array.isArray(cs) ? cs : [cs];
    let text = '';
    for (const c of csList) {
      const st = await reader.resolve(c);
      if (st instanceof PdfStream) text += latin1(await reader.decode(st)) + '\n';
    }
    const names = [...text.matchAll(/\/([^\s/[\]<>()]+)\s+Do/g)].map((m) => m[1] ?? '');
    const refs = names
      .map((n) => (isDict(xo) ? xo.get(n) : undefined))
      .filter((r): r is PdfRef => r instanceof PdfRef);
    const sides = (['a', 'b'] as const).filter((s) => sh[s]);
    const formOf: Partial<Record<'a' | 'b', PdfRef>> = {};
    sides.forEach((s, k) => {
      const r = refs[k];
      if (r) formOf[s] = r;
    });
    const { w, h } = pl.size;
    const gs = new Map<string, PdfValue>();
    const xobjects = new Map<string, PdfValue>();
    const lines: string[] = [`q 1 g 0 0 ${fmt(w)} ${fmt(h)} re f Q`];
    for (const s of sides) {
      const form = formOf[s];
      const m = pl[s];
      if (!form || !m) continue;
      const col = s === 'a' ? opts.colA : opts.colB;
      const blend = s === 'b' ? 'Multiply' : 'Normal';
      if (opts.route === 'wrap') {
        // The tinted fill sits in its own isolated group, and the group is what
        // gets /BM /Multiply: pdf.js drops a blend mode set in the same
        // ExtGState as a soft mask (it multiplied nothing in the first try).
        const mask = await maskFor(
          [0, 0, w, h],
          `q ${mStr(m)} cm /P Do Q`,
          D({ XObject: D({ P: form }) }),
        );
        const tintNum = ++next;
        await putStream(
          tintNum,
          D({
            Type: N('XObject'),
            Subtype: N('Form'),
            BBox: [0, 0, w, h],
            Group: D({ S: N('Transparency'), I: true, CS: N('DeviceRGB') }),
            Resources: D({
              ExtGState: D({ M: D({ Type: N('ExtGState'), SMask: new PdfRef(mask) }) }),
            }),
          }),
          fromLatin1(`/M gs ${rgbStr(col)} rg 0 0 ${fmt(w)} ${fmt(h)} re f`),
        );
        const xName = s === 'a' ? 'OldTint' : 'NewTint';
        xobjects.set(xName, new PdfRef(tintNum));
        if (s === 'b') gs.set('Mul', D({ Type: N('ExtGState'), BM: N(blend) }));
        lines.push(`q ${s === 'b' ? '/Mul gs ' : ''}/${xName} Do Q`);
      } else {
        const copy = await recolourForm(form, col, s, true);
        const xName = s === 'a' ? 'Old' : 'New';
        xobjects.set(xName, copy);
        if (s === 'b') gs.set('Mul', D({ Type: N('ExtGState'), BM: N('Multiply') }));
        lines.push(`q ${s === 'b' ? '/Mul gs ' : ''}${mStr(m)} cm /${xName} Do Q`);
      }
      const ocgs = new Map<number, PdfDict>();
      await collectOcgs(form, ocgs);
      if (ocgs.size) {
        const src = sh[s]?.source;
        if (src) {
          const off = await layersOff(src);
          const prior = sideLayers.find((x) => x.side === s && x.label === src.label);
          const refsHere = [...ocgs.keys()].map((n) => new PdfRef(n));
          if (prior)
            prior.refs.push(...refsHere.filter((r) => !prior.refs.some((p) => p.num === r.num)));
          else sideLayers.push({ side: s, label: src.label, refs: refsHere, off });
          // Each copy of a layer keeps its name; the side shows in the list's grouping.
          for (const [n, d] of ocgs) {
            const name = d.get('Name');
            const text = name instanceof PdfString ? name.text() : '';
            if (off.has(text) || off.has('\u0000all')) {
              const entry = sideLayers.find((x) => x.side === s && x.label === src.label);
              entry?.off.add(`#${String(n)}`);
            }
          }
        }
      }
    }
    const contentNum = ++next;
    await putStream(contentNum, new Map(), fromLatin1(lines.join('\n')));
    const newRes = D({
      ...(gs.size ? { ExtGState: gs } : {}),
      XObject: xobjects.size ? xobjects : (xo ?? new Map()),
    });
    const page = new Map(pg.dict);
    page.set('Contents', new PdfRef(contentNum));
    page.set('Resources', newRes);
    page.set('Group', D({ S: N('Transparency'), CS: N('DeviceRGB') }));
    put(pg.num, page);
  }

  if (sideLayers.length) {
    const rootRef = reader.trailer.get('Root');
    const cat = await reader.resolve(rootRef);
    if (rootRef instanceof PdfRef && isDict(cat)) {
      const all = sideLayers.flatMap((x) => x.refs);
      const offRefs = sideLayers.flatMap((x) =>
        x.refs.filter((r) => x.off.has(`#${String(r.num)}`)),
      );
      const order = sideLayers.map((x) => [
        PdfString.of(`${x.side === 'a' ? 'Old' : 'New'} — ${x.label}`),
        ...x.refs,
      ]);
      const ocp = D({
        OCGs: all,
        D: D({ Name: PdfString.of('Overlay'), BaseState: N('ON'), OFF: offRefs, Order: order }),
      });
      const c2 = new Map(cat);
      c2.set('OCProperties', ocp);
      put(rootRef.num, c2);
      stats.layers = all.length;
    }
  }
  extra.sort((x, y) => x.num - y.num);
  const tail = narrowTail(saveBaseOf(base), base, base.length, [], { extra, onlyExtra: true }).tail;
  let bytes: Uint8Array = concatBytes([base, tail]);
  const t2 = performance.now();
  stats.ms.overlay = t2 - t1;

  // ---- Step 3: one compact revision. ----
  if (!opts.noCompact) {
    const heap = mod.pdfium as unknown as {
      wasmExports: { malloc(n: number): number; free(p: number): void };
      HEAPU8: Uint8Array;
    };
    const p = heap.wasmExports.malloc(bytes.length);
    heap.HEAPU8.set(bytes, p);
    const doc = call(mod, 'FPDF_LoadMemDocument', p, bytes.length, '');
    try {
      if (!doc) throw new Error('PDFium could not reopen the overlay');
      bytes = saveWithFlags(mod, doc, FPDF_NO_INCREMENTAL);
    } finally {
      if (doc) call(mod, 'FPDF_CloseDocument', doc);
      heap.wasmExports.free(p);
    }
  }
  stats.ms.compact = performance.now() - t2;
  return { bytes, stats };
}

export { PdfName };
