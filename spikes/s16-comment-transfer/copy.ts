// M4-19 spike (ADR-018): object copy of comments from one PDF into another.
// Reads the source with our own reader (src/model/pdf, M3-03/M3-04), deep-copies
// each selected markup annotation with everything it references (/AP streams
// and their resources, /Popup, the reply chain via /IRT, /Measure), renumbered
// from the target's /Size, re-encrypted for the target, and writes the copies
// plus the target pages' new /Annots as one incremental section through the
// production narrowTail (as "extra" objects). Pure except for the reader; the
// Work worker is where this would run (ADR-018 decision 3). Spike code: never
// imported by /src.
import {
  isDict,
  nameOf,
  numOf,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import type { PdfReader } from '../../src/model/pdf/reader.ts';
import type { StandardCrypt } from '../../src/model/pdf/security/standard.ts';
import { concatBytes, encodeLatin1 } from '../../src/workers/render/save/bytes.ts';
import {
  narrowTail,
  parseTailObjects,
  type ExtraObject,
} from '../../src/workers/render/save/narrowTail.ts';
import { saveBaseOf } from '../../src/workers/render/save/xref.ts';

/** Markup annotations (ISO 32000-1 12.5.6.2 table 170), the ones a "comment" can be. */
export const MARKUP = new Set([
  'Text',
  'FreeText',
  'Line',
  'Square',
  'Circle',
  'Polygon',
  'PolyLine',
  'Highlight',
  'Underline',
  'Squiggly',
  'StrikeOut',
  'Stamp',
  'Caret',
  'Ink',
  'FileAttachment',
  'Sound',
  'Redact',
]);

// ---- geometry -------------------------------------------------------------------

/** PDF matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m` then `n`. */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('singular matrix');
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export const apply = (m: Mat, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

const clean = (v: number) => Math.round(v * 1e4) / 1e4;
export const isIdentity = (m: Mat) => m.every((v, i) => Math.abs(v - (IDENTITY[i] ?? 0)) < 1e-9);
export const linear = (m: Mat): Mat => [m[0], m[1], m[2], m[3], 0, 0];

export interface PageBox {
  /** Crop box [x0 y0 x1 y1] (default user space). */
  crop: [number, number, number, number];
  /** /Rotate, normalized to 0, 90, 180 or 270. */
  rotate: number;
}

/**
 * Default user space → "visual" space: the page as displayed, origin at the
 * visual TOP-left of the crop box, y down (a comment keeps its distance from
 * the top-left corner when the pages differ in size). /Rotate turns the page
 * clockwise.
 */
export function visual(p: PageBox): Mat {
  const [x0, y0, x1, y1] = p.crop;
  const hv = p.rotate === 90 || p.rotate === 270 ? x1 - x0 : y1 - y0;
  return mul(visualUp(p), [1, 0, 0, -1, 0, hv]);
}

/** As `visual`, origin at the visual bottom-left, y up. */
export function visualUp(p: PageBox): Mat {
  const [x0, y0, x1, y1] = p.crop;
  const w = x1 - x0;
  const h = y1 - y0;
  const t: Mat = [1, 0, 0, 1, -x0, -y0];
  const r: Mat =
    p.rotate === 90
      ? [0, -1, 1, 0, 0, w]
      : p.rotate === 180
        ? [-1, 0, 0, -1, w, h]
        : p.rotate === 270
          ? [0, 1, -1, 0, h, 0]
          : IDENTITY;
  return mul(t, r);
}

/** Source user space → target user space: same place relative to the visible crop box. */
export const placement = (src: PageBox, tgt: PageBox): Mat => mul(visual(src), invert(visual(tgt)));

function mapPairs(arr: PdfValue, m: Mat): PdfValue {
  if (!Array.isArray(arr)) return arr;
  const out: PdfValue[] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const x = arr[i];
    const y = arr[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number') return arr;
    const [a, b] = apply(m, x, y);
    out.push(clean(a), clean(b));
  }
  return out;
}

export function mapRect(r: PdfValue, m: Mat): PdfValue {
  if (!Array.isArray(r) || r.length !== 4 || !r.every((v) => typeof v === 'number')) return r;
  const [l, b, rr, t] = r;
  const pts = [
    apply(m, l ?? 0, b ?? 0),
    apply(m, rr ?? 0, b ?? 0),
    apply(m, l ?? 0, t ?? 0),
    apply(m, rr ?? 0, t ?? 0),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(clean);
}

/** /Rect for a NoRotate annotation: its upper-left corner moves, its size stays (12.5.3). */
export function mapNoRotateRect(r: PdfValue, m: Mat): PdfValue {
  if (!Array.isArray(r) || r.length !== 4 || !r.every((v) => typeof v === 'number')) return r;
  const [l, b, rr, t] = r;
  const [x, y] = apply(m, l ?? 0, t ?? 0);
  const w = (rr ?? 0) - (l ?? 0);
  const h = (t ?? 0) - (b ?? 0);
  return [x, y - h, x + w, y].map(clean);
}

// ---- page boxes (inheritable attributes, 7.7.3.4) ---------------------------------

async function inherited(r: PdfReader, dict: PdfDict, key: string): Promise<PdfValue | undefined> {
  let d: PdfDict | undefined = dict;
  for (let i = 0; d && i < 64; i++) {
    if (d.has(key)) return r.resolve(d.get(key));
    const p = await r.resolve(d.get('Parent'));
    d = isDict(p) ? p : undefined;
  }
  return undefined;
}

export async function pageBox(r: PdfReader, dict: PdfDict): Promise<PageBox> {
  const nums = async (k: string) => {
    const v = await inherited(r, dict, k);
    return Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number')
      ? v
      : undefined;
  };
  const media = (await nums('MediaBox')) ?? [0, 0, 612, 792];
  const crop = (await nums('CropBox')) ?? media;
  const norm = (b: number[]): [number, number, number, number] => [
    Math.min(b[0] ?? 0, b[2] ?? 0),
    Math.min(b[1] ?? 0, b[3] ?? 0),
    Math.max(b[0] ?? 0, b[2] ?? 0),
    Math.max(b[1] ?? 0, b[3] ?? 0),
  ];
  const rot = numOf(await inherited(r, dict, 'Rotate')) ?? 0;
  return { crop: norm(crop), rotate: (((Math.round(rot / 90) * 90) % 360) + 360) % 360 };
}

// ---- selection --------------------------------------------------------------------

export interface ImportOptions {
  /** 0-based source pages (default: all). */
  pages?: readonly number[];
  /** Target page = source page + offset. */
  offset?: number;
  /** Only comments (thread roots) by these authors. */
  authors?: readonly string[];
  /** Only these subtypes (thread roots). */
  types?: readonly string[];
  /** Text replies (review states and grouped parts always come along). */
  withReplies?: boolean;
  /** Paste: new /NM for every copy, and no duplicate check (ADR-018 d5). */
  newNames?: boolean;
  /** Skip the placement transform (measure what it costs). */
  noTransform?: boolean;
}

interface Candidate {
  num: number;
  gen: number;
  dict: PdfDict;
  subtype: string;
  nm: string | null;
  author: string;
  irt: number | null;
  /** /RT /Group (part of a grouped markup) or a review state: travels with its parent. */
  bound: boolean;
  srcPage: number;
}

export interface ImportReport {
  selected: number;
  /** Copied annotations incl. popups (added to target /Annots). */
  added: number;
  objects: number;
  skipped: {
    duplicate: number;
    missingPage: number;
    filtered: number;
    nonMarkup: number;
    orphanReply: number;
    offPage: number;
  };
  dropped: Record<string, number>;
  transformedPages: number;
  /** Source object number → target object number of every copied annotation (not popups). */
  map: Map<number, number>;
  /** Source object numbers of everything added to a target /Annots (popups included). */
  copiedSrc: Set<number>;
  /** Source object numbers of copied NoRotate annotations moved by their upper-left corner. */
  noRotate: Set<number>;
  /** Placement per copied annotation (target object number → target page, matrix). */
  placed: Map<number, { page: number; m: Mat }>;
  ms: { read: number; copy: number; write: number };
}

export interface ImportResult {
  tail: Uint8Array;
  report: ImportReport;
}

const genIn = (r: PdfReader, num: number): number => {
  const e = r.xref.get(num);
  return e?.type === 1 ? e.gen : 0;
};

const textOf = (v: PdfValue | undefined): string => (v instanceof PdfString ? v.text() : '');

/** Encrypts a stream's data for the target (the production StandardCrypt would gain this). */
function encryptStream(c: StandardCrypt, num: number, gen: number, data: Uint8Array): Uint8Array {
  const run = (
    c as unknown as {
      run(m: string, n: number, g: number, d: Uint8Array, e: boolean): Uint8Array;
    }
  ).run.bind(c);
  return run(c.info.streams, num, gen, data, true);
}

function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Copies the selected comments of `src` into `tgt` (both opened with a password
 * that decrypts them) and returns the incremental section to append to
 * `tgtBytes`.
 */
export async function importComments(
  src: PdfReader,
  tgt: PdfReader,
  tgtBytes: Uint8Array,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const t0 = performance.now();
  const srcPages = await src.pages();
  const tgtPages = await tgt.pages();
  const srcPageNums = new Map(srcPages.map((p, i) => [p.num, i]));
  const offset = opts.offset ?? 0;
  const pageList = opts.pages ?? srcPages.map((_, i) => i);
  const report: ImportReport = {
    selected: 0,
    added: 0,
    objects: 0,
    skipped: {
      duplicate: 0,
      missingPage: 0,
      filtered: 0,
      nonMarkup: 0,
      orphanReply: 0,
      offPage: 0,
    },
    dropped: {},
    transformedPages: 0,
    map: new Map(),
    copiedSrc: new Set(),
    noRotate: new Set(),
    placed: new Map(),
    ms: { read: 0, copy: 0, write: 0 },
  };
  const drop = (k: string) => {
    report.dropped[k] = (report.dropped[k] ?? 0) + 1;
  };

  // /NM already in the target (duplicates are skipped; their replies attach to them).
  const tgtNames = new Map<string, number>();
  if (!opts.newNames) {
    for (const p of tgtPages) {
      const annots = await tgt.resolve(p.dict.get('Annots'));
      for (const a of Array.isArray(annots) ? annots : []) {
        if (!(a instanceof PdfRef)) continue;
        const d = await tgt.get(a);
        const nm = isDict(d) ? textOf(d.get('NM')) : '';
        if (nm) tgtNames.set(nm, a.num);
      }
    }
  }

  // Every markup annotation of the chosen pages.
  const cands = new Map<number, Candidate>();
  for (const i of pageList) {
    const p = srcPages[i];
    if (!p) continue;
    const annots = await src.resolve(p.dict.get('Annots'));
    for (const a of Array.isArray(annots) ? annots : []) {
      if (!(a instanceof PdfRef)) continue;
      const d = await src.get(a);
      if (!isDict(d)) continue;
      const subtype = nameOf(d.get('Subtype')) ?? '';
      if (subtype === 'Popup') continue; // travels with its parent
      if (!MARKUP.has(subtype)) {
        report.skipped.nonMarkup++;
        continue;
      }
      const irt = d.get('IRT');
      cands.set(a.num, {
        num: a.num,
        gen: genIn(src, a.num),
        dict: d,
        subtype,
        nm: textOf(d.get('NM')) || null,
        author: textOf(d.get('T')),
        irt: irt instanceof PdfRef ? irt.num : null,
        bound: nameOf(d.get('RT')) === 'Group' || d.has('StateModel') || d.has('State'),
        srcPage: i,
      });
    }
  }
  const rootOf = (c: Candidate): Candidate | null => {
    let cur: Candidate | undefined = c;
    const seen = new Set<number>();
    while (cur && cur.irt !== null) {
      if (seen.has(cur.num)) return null;
      seen.add(cur.num);
      cur = cands.get(cur.irt);
    }
    return cur ?? null;
  };

  // Filters apply to thread roots; replies follow their root.
  const chosen: Candidate[] = [];
  for (const c of cands.values()) {
    const root = rootOf(c);
    if (!root) {
      report.skipped.orphanReply++;
      continue;
    }
    if (opts.authors && !opts.authors.includes(root.author)) {
      report.skipped.filtered++;
      continue;
    }
    if (opts.types && !opts.types.includes(root.subtype)) {
      report.skipped.filtered++;
      continue;
    }
    if (c !== root && !c.bound && opts.withReplies === false) {
      report.skipped.filtered++;
      continue;
    }
    const tp = c.srcPage + offset;
    if (tp < 0 || tp >= tgtPages.length) {
      report.skipped.missingPage++;
      continue;
    }
    if (c.nm && tgtNames.has(c.nm)) {
      report.skipped.duplicate++;
      continue;
    }
    chosen.push(c);
  }
  report.selected = chosen.length;
  report.ms.read = performance.now() - t0;

  // ---- copy -------------------------------------------------------------------
  const t1 = performance.now();
  const tgtCrypt = tgt.crypt;
  let next = Math.max(tgt.maxObjNum(), ...[...tgt.xref.keys()].map((k) => k + 1));
  const alloc = () => next++;
  const out = new Map<number, PdfValue>();
  /** Source object number (+ transform) → target object number. */
  const memo = new Map<string, number>();
  const refMap = new Map<number, number>(); // selected annotations and popups
  for (const c of chosen) {
    refMap.set(c.num, alloc());
    const popup = c.dict.get('Popup');
    if (popup instanceof PdfRef && !refMap.has(popup.num)) refMap.set(popup.num, alloc());
  }
  // Duplicates: replies to a skipped duplicate point at the target's existing one.
  const dupMap = new Map<number, number>();
  for (const c of cands.values()) {
    const existing = c.nm ? tgtNames.get(c.nm) : undefined;
    if (existing !== undefined && !refMap.has(c.num)) dupMap.set(c.num, existing);
  }

  // Placement per page pair.
  const boxes = new Map<number, Mat>();
  const matrixFor = async (sp: number): Promise<Mat> => {
    let m = boxes.get(sp);
    if (m) return m;
    const s = srcPages[sp];
    const t = tgtPages[sp + offset];
    if (!s || !t) throw new Error('page');
    m = opts.noTransform
      ? IDENTITY
      : placement(await pageBox(src, s.dict), await pageBox(tgt, t.dict));
    if (!isIdentity(m)) report.transformedPages++;
    boxes.set(sp, m);
    return m;
  };
  const tidOf = (m: Mat) => (isIdentity(m) ? 'I' : m.map((v) => v.toFixed(3)).join(','));

  const copyValue = async (v: PdfValue, tid: string, tgtPageRef: PdfRef): Promise<PdfValue> => {
    if (v instanceof PdfRef) {
      const mapped = refMap.get(v.num) ?? dupMap.get(v.num);
      if (mapped !== undefined) return new PdfRef(mapped);
      const sp = srcPageNums.get(v.num);
      if (sp !== undefined) {
        const tp = tgtPages[sp + offset];
        return tp ? new PdfRef(tp.num) : null;
      }
      const key = `${String(v.num)}@${tid}`;
      const hit = memo.get(key);
      if (hit !== undefined) return new PdfRef(hit);
      const obj = await src.get(v);
      if (isDict(obj) || obj instanceof PdfStream) {
        const d = obj instanceof PdfStream ? obj.dict : obj;
        const type = nameOf(d.get('Type'));
        if (type === 'Catalog' || type === 'Pages' || type === 'Page') {
          drop('ref:page-tree');
          return null;
        }
        if (
          type === 'Annot' ||
          (d.has('Subtype') && d.has('Rect') && !(obj instanceof PdfStream))
        ) {
          drop('ref:other-annotation');
          return null;
        }
      }
      const num = alloc();
      memo.set(key, num);
      let copied: PdfValue;
      if (obj instanceof PdfStream) {
        const e = src.xref.get(v.num);
        const gen = e?.type === 1 ? e.gen : 0;
        const plain = src.crypt ? src.crypt.decryptStream(v.num, gen, obj.raw) : obj.raw;
        copied = new PdfStream((await copyValue(obj.dict, tid, tgtPageRef)) as PdfDict, plain);
      } else copied = await copyValue(obj, tid, tgtPageRef);
      out.set(num, copied);
      return new PdfRef(num);
    }
    if (Array.isArray(v)) {
      const a: PdfValue[] = [];
      for (const x of v) a.push(await copyValue(x, tid, tgtPageRef));
      return a;
    }
    if (isDict(v)) {
      const d: PdfDict = new Map();
      for (const [k, x] of v) d.set(k, await copyValue(x, tid, tgtPageRef));
      return d;
    }
    return v;
  };

  const newAnnots = new Map<number, PdfRef[]>(); // target page index → refs
  const apRotations: { nums: number[]; lin: Mat }[] = [];
  const copyAnnot = async (srcNum: number, d: PdfDict, sp: number, isPopup: boolean) => {
    const m = await matrixFor(sp);
    const tid = tidOf(m);
    const tp = tgtPages[sp + offset];
    if (!tp) throw new Error('page');
    const pageRef = new PdfRef(tp.num);
    const nd: PdfDict = new Map();
    for (const [k, v] of d) {
      if (k === 'P') nd.set('P', pageRef);
      else if (k === 'StructParent' || k === 'OC') drop(k);
      else if (k === 'NM' && opts.newNames) nd.set('NM', PdfString.of(uuid()));
      else if (k === 'IRT' && v instanceof PdfRef && !refMap.has(v.num) && !dupMap.has(v.num))
        drop('IRT:unmapped');
      else nd.set(k, await copyValue(v, tid, pageRef));
    }
    if (!isIdentity(m)) {
      const flags = numOf(nd.get('F')) ?? 0;
      const noRotate = (flags & 16) !== 0;
      const hasRotation = !isIdentity(linear(m));
      if (noRotate && hasRotation) report.noRotate.add(srcNum);
      nd.set(
        'Rect',
        noRotate && hasRotation
          ? mapNoRotateRect(nd.get('Rect') ?? null, m)
          : mapRect(nd.get('Rect') ?? null, m),
      );
      for (const k of ['QuadPoints', 'Vertices', 'L', 'CL']) {
        const v = nd.get(k);
        if (v !== undefined) nd.set(k, mapPairs(v, m));
      }
      const ink = nd.get('InkList');
      if (Array.isArray(ink))
        nd.set(
          'InkList',
          ink.map((s) => mapPairs(s, m)),
        );
      if (hasRotation && !noRotate) {
        // The appearance turns with the page: prepend the rotation to each /AP form's /Matrix.
        const ap = nd.get('AP');
        const nums: number[] = [];
        if (isDict(ap)) {
          for (const k of ['N', 'R', 'D']) {
            const e = ap.get(k);
            if (e instanceof PdfRef) nums.push(e.num);
            else if (isDict(e))
              for (const s of e.values()) if (s instanceof PdfRef) nums.push(s.num);
          }
        }
        apRotations.push({ nums, lin: linear(m) });
      }
      if (!isPopup) {
        const r = nd.get('Rect');
        const box = await pageBox(tgt, tp.dict);
        if (Array.isArray(r)) {
          const [l, b, rr, t] = r as number[];
          if (
            (rr ?? 0) < box.crop[0] ||
            (l ?? 0) > box.crop[2] ||
            (t ?? 0) < box.crop[1] ||
            (b ?? 0) > box.crop[3]
          )
            report.skipped.offPage++;
        }
      }
    }
    const num = refMap.get(srcNum);
    if (num === undefined) throw new Error('unallocated');
    out.set(num, nd);
    const list = newAnnots.get(sp + offset) ?? [];
    list.push(new PdfRef(num));
    newAnnots.set(sp + offset, list);
    if (!isPopup) {
      report.map.set(srcNum, num);
      report.placed.set(num, { page: sp + offset, m });
    }
    report.copiedSrc.add(srcNum);
    report.added++;
  };
  for (const c of chosen) {
    await copyAnnot(c.num, c.dict, c.srcPage, false);
    const popup = c.dict.get('Popup');
    if (popup instanceof PdfRef) {
      const pd = await src.get(popup);
      if (isDict(pd)) await copyAnnot(popup.num, pd, c.srcPage, true);
    }
  }
  // Rotate copied appearance forms (each copied once per transform, so never shared).
  const rotated = new Set<number>();
  for (const { nums, lin } of apRotations) {
    for (const n of nums) {
      if (rotated.has(n)) continue;
      rotated.add(n);
      const s = out.get(n);
      if (!(s instanceof PdfStream)) continue;
      const old = s.dict.get('Matrix');
      const om: Mat =
        Array.isArray(old) && old.length === 6 && old.every((x) => typeof x === 'number')
          ? (old as Mat)
          : IDENTITY;
      s.dict.set('Matrix', mul(om, lin).map(clean));
    }
  }
  report.ms.copy = performance.now() - t1;

  // ---- write --------------------------------------------------------------------
  const t2 = performance.now();
  const extra: ExtraObject[] = [];
  const genOf = (num: number) => {
    const e = tgt.xref.get(num);
    return e?.type === 1 ? e.gen : 0;
  };
  const write = (num: number, gen: number, v: PdfValue) => {
    if (v instanceof PdfStream) {
      const dict = (tgtCrypt ? tgtCrypt.mapStrings(v.dict, num, gen, true) : v.dict) as PdfDict;
      const data = tgtCrypt ? encryptStream(tgtCrypt, num, gen, v.raw) : v.raw;
      const d = new Map(dict);
      d.set('Length', data.length);
      extra.push({
        num,
        gen,
        bytes: concatBytes([
          encodeLatin1(`${String(num)} ${String(gen)} obj\r\n${serialize(d)}\r\nstream\r\n`),
          data,
          encodeLatin1('\r\nendstream\r\nendobj'),
        ]),
      });
    } else {
      const value = tgtCrypt ? tgtCrypt.mapStrings(v, num, gen, true) : v;
      extra.push({ num, gen, bytes: serializeIndirect(num, gen, value) });
    }
  };
  for (const [num, v] of out) write(num, 0, v);
  report.objects = out.size;
  // Target pages: /Annots gains the copies (an indirect /Annots array is rewritten in place).
  for (const [tpi, refs] of newAnnots) {
    const tp = tgtPages[tpi];
    if (!tp) continue;
    const annots = tp.dict.get('Annots');
    if (annots instanceof PdfRef) {
      const arr = await tgt.get(annots);
      write(annots.num, genOf(annots.num), [...(Array.isArray(arr) ? arr : []), ...refs]);
    } else {
      const d = new Map(tp.dict);
      d.set('Annots', [...(Array.isArray(annots) ? annots : []), ...refs]);
      write(tp.num, genOf(tp.num), d);
    }
  }
  extra.sort((a, b) => a.num - b.num);
  const r =
    extra.length === 0
      ? { tail: new Uint8Array(0) }
      : narrowTail(saveBaseOf(tgtBytes), tgtBytes, tgtBytes.length, [], { extra });
  report.ms.write = performance.now() - t2;
  return { tail: r.tail, report };
}

/**
 * Folds the import section `t1` and a later save's section `t2` (made against
 * original + t1) into ONE incremental section on `original` (the file on
 * disk never saw t1): t2's version of an object wins; the xref-stream objects
 * of both are dropped and a new xref is written.
 */
export function mergeTails(original: Uint8Array, t1: Uint8Array, t2: Uint8Array): Uint8Array {
  const all = concatBytes([original, t1, t2]);
  const isXref = (dict: string) => /\/Type\s*\/XRef\b/.test(dict);
  const objs = new Map<number, ExtraObject>();
  const take = (from: number) => {
    for (const o of parseTailObjects(all, from)) {
      if (isXref(o.dict)) continue;
      objs.set(o.num, { num: o.num, gen: o.gen, bytes: all.slice(o.start, o.end) });
    }
  };
  take(original.length);
  if (t2.length > 0) take(original.length + t1.length);
  const extra = [...objs.values()].sort((a, b) => a.num - b.num);
  return narrowTail(saveBaseOf(original), original, original.length, [], { extra }).tail;
}

/** A value for reports: names and numbers as text. */
export const show = (v: PdfValue | undefined): string =>
  v === undefined ? '-' : v instanceof PdfName ? `/${v.name}` : serialize(v);
