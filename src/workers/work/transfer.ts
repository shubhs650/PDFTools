// Comment transfer engine (M4-20, M4-21, ADR-018 decisions 2–5), from the
// M4-19 spike (spikes/s16-comment-transfer/copy.ts): the selected markup
// annotations of a source PDF are deep-copied into a target with everything
// they reference (/AP streams and resources, /Popup, the reply chain via
// /IRT, /Measure), renumbered from the target's /Size, placed on the target
// page (same position relative to the visible top-left of the crop box,
// following /Rotate), strings and streams re-encrypted for the target. The
// result is a list of objects (the Render worker reopens the document with
// them, the M4-09 route) and, for building a clipboard PDF, an incremental
// section. Runs in the Work worker (rule 1); cancellable between comments.
import {
  isDict,
  nameOf,
  numOf,
  PdfRef,
  PdfStream,
  PdfString,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../model/pdf/objects';
import type { PdfReader } from '../../model/pdf/reader';
import { concatBytes, encodeLatin1 } from '../render/save/bytes';
import { narrowTail, type ExtraObject } from '../render/save/narrowTail';
import { saveBaseOf } from '../render/save/xref';

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
  /** Only these subtypes, lower-case (thread roots). */
  types?: readonly string[];
  /** Text replies (review states and grouped parts always come along). */
  withReplies?: boolean;
  /** Paste: new /NM for every copy, and no duplicate check (ADR-018 d5). */
  newNames?: boolean;
  /** Skip the placement transform. */
  noTransform?: boolean;
  /** Target page per source page, overriding `offset` (paste; null: no target). */
  pageMap?: (srcPage: number) => number | null;
  /** Only these thread roots (source object numbers): a copied selection. */
  only?: ReadonlySet<number>;
  /** Moved right/down by this much as the target page is displayed (paste onto its own page). */
  shift?: { dx: number; dy: number };
  /** Count only (the dialog's preview): nothing is copied. */
  dryRun?: boolean;
  /** Between comments: may throw to cancel (rule 2) and report progress. */
  checkpoint?: (done: number, total: number) => Promise<void>;
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
  /** Of `selected`, the comments themselves (thread roots). */
  roots: number;
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
  /** The first object number allocated here: every object from it on is new. */
  firstNew: number;
}

export interface ImportResult {
  /** The copied objects and the rewritten page objects / /Annots arrays. */
  objects: ExtraObject[];
  /** The same as an incremental section on the target's bytes (empty for a dry run). */
  tail: Uint8Array;
  report: ImportReport;
}

const genIn = (r: PdfReader, num: number): number => {
  const e = r.xref.get(num);
  return e?.type === 1 ? e.gen : 0;
};

const textOf = (v: PdfValue | undefined): string => (v instanceof PdfString ? v.text() : '');

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
  const targetOf = (sp: number): number | null => {
    const tp = opts.pageMap ? opts.pageMap(sp) : sp + offset;
    return tp !== null && tp >= 0 && tp < tgtPages.length ? tp : null;
  };
  const pageList = opts.pages ?? srcPages.map((_, i) => i);
  const report: ImportReport = {
    selected: 0,
    roots: 0,
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
    firstNew: 0,
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
    if (opts.only && !opts.only.has(root.num)) {
      report.skipped.filtered++;
      continue;
    }
    if (opts.authors && !opts.authors.includes(root.author)) {
      report.skipped.filtered++;
      continue;
    }
    if (opts.types && !opts.types.includes(root.subtype.toLowerCase())) {
      report.skipped.filtered++;
      continue;
    }
    if (c !== root && !c.bound && opts.withReplies === false) {
      report.skipped.filtered++;
      continue;
    }
    if (targetOf(c.srcPage) === null) {
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
  report.roots = chosen.filter((c) => c.irt === null).length;
  report.ms.read = performance.now() - t0;
  if (opts.dryRun) return { objects: [], tail: new Uint8Array(0), report };

  // ---- copy -------------------------------------------------------------------
  const t1 = performance.now();
  const tgtCrypt = tgt.crypt;
  let next = Math.max(tgt.maxObjNum(), ...[...tgt.xref.keys()].map((k) => k + 1));
  report.firstNew = next;
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
    const tpi = targetOf(sp);
    const t = tpi === null ? undefined : tgtPages[tpi];
    if (!s || !t) throw new Error('page');
    const tb = await pageBox(tgt, t.dict);
    m = opts.noTransform ? IDENTITY : placement(await pageBox(src, s.dict), tb);
    if (opts.shift) {
      // Right and down as the page is displayed (visual space), whatever its /Rotate.
      const v = visual(tb);
      m = mul(m, mul(v, mul([1, 0, 0, 1, opts.shift.dx, opts.shift.dy], invert(v))));
    }
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
        const tpi = targetOf(sp);
        const tp = tpi === null ? undefined : tgtPages[tpi];
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
    const tpi = targetOf(sp);
    const tp = tpi === null ? undefined : tgtPages[tpi];
    if (!tp || tpi === null) throw new Error('page');
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
    const list = newAnnots.get(tpi) ?? [];
    list.push(new PdfRef(num));
    newAnnots.set(tpi, list);
    if (!isPopup) {
      report.map.set(srcNum, num);
      report.placed.set(num, { page: tpi, m });
    }
    report.copiedSrc.add(srcNum);
    report.added++;
  };
  for (const [i, c] of chosen.entries()) {
    if (opts.checkpoint && i % 25 === 0) await opts.checkpoint(i, chosen.length);
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
      const data = tgtCrypt ? tgtCrypt.encryptStream(num, gen, v.raw) : v.raw;
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
      : narrowTail(saveBaseOf(tgtBytes), tgtBytes, tgtBytes.length, [], {
          extra,
          onlyExtra: true,
        });
  report.ms.write = performance.now() - t2;
  return { objects: extra, tail: r.tail, report };
}

// ---- the Import dialog's summary (M4-20) --------------------------------------------

export interface CommentSummary {
  /** Source object number (a thread root). */
  num: number;
  /** 0-based source page. */
  page: number;
  author: string;
  /** PDF subtype, lower-case, e.g. "square" (as our JSON export names it). */
  type: string;
  /** Latest review state (/State of a state reply), or null. */
  state: string | null;
  replies: number;
  nm: string | null;
}

/** Every comment (thread root) of the source, with its replies counted and latest state. */
export async function summarize(
  src: PdfReader,
): Promise<{ pages: number; comments: CommentSummary[] }> {
  const pages = await src.pages();
  const roots: CommentSummary[] = [];
  const byNum = new Map<number, CommentSummary>();
  const pending: { irt: number; state: string | null; date: string }[] = [];
  for (const [i, p] of pages.entries()) {
    const annots = await src.resolve(p.dict.get('Annots'));
    for (const a of Array.isArray(annots) ? annots : []) {
      if (!(a instanceof PdfRef)) continue;
      const d = await src.get(a);
      if (!isDict(d)) continue;
      const type = nameOf(d.get('Subtype')) ?? '';
      if (!MARKUP.has(type)) continue;
      const irt = d.get('IRT');
      if (irt instanceof PdfRef) {
        pending.push({
          irt: irt.num,
          state: d.has('StateModel') ? (nameOf(d.get('State')) ?? textOf(d.get('State'))) : null,
          date: textOf(d.get('M')) || textOf(d.get('CreationDate')),
        });
        continue;
      }
      const c: CommentSummary = {
        num: a.num,
        page: i,
        author: textOf(d.get('T')),
        type: type.toLowerCase(),
        state: null,
        replies: 0,
        nm: textOf(d.get('NM')) || null,
      };
      roots.push(c);
      byNum.set(a.num, c);
    }
  }
  pending.sort((x, y) => x.date.localeCompare(y.date));
  for (const r of pending) {
    const root = byNum.get(r.irt);
    if (!root) continue;
    if (r.state) root.state = r.state;
    else root.replies++;
  }
  return { pages: pages.length, comments: roots };
}

// ---- the in-app clipboard (M4-21) ------------------------------------------------------

/** A tiny unencrypted PDF with empty pages of the given boxes (the clipboard's skeleton). */
export function skeletonPdf(boxes: readonly PageBox[]): Uint8Array {
  const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids: string[] = [];
  for (const b of boxes) {
    kids.push(`${String(objs.length + 1)} 0 R`);
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${b.crop.map((v) => clean(v)).join(' ')}]${b.rotate ? ` /Rotate ${String(b.rotate)}` : ''} >>`,
    );
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(boxes.length)} >>`;
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return encodeLatin1(out);
}

/** Thread roots by /NM or stable id (`obj-<n>`), with their pages. */
export async function findRoots(
  src: PdfReader,
  ids: readonly string[],
): Promise<Map<number, number>> {
  const want = new Set(ids);
  const out = new Map<number, number>(); // object number → page
  const pages = await src.pages();
  for (const [i, p] of pages.entries()) {
    const annots = await src.resolve(p.dict.get('Annots'));
    for (const a of Array.isArray(annots) ? annots : []) {
      if (!(a instanceof PdfRef)) continue;
      const d = await src.get(a);
      if (!isDict(d)) continue;
      const nm = textOf(d.get('NM'));
      if (want.has(`obj-${String(a.num)}`) || (nm && want.has(nm))) out.set(a.num, i);
    }
  }
  return out;
}
