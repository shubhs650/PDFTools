// One font object per face for a document's measurement captions (M14-07,
// ADR-035 Amendment 1 decision 2; spike S34: each caption embeds a 1.5–3 kB
// subset, so 1,000 counts would add about 1.7 MB).
//
// Each measurement's appearance is still drawn with its own subset (the
// Render worker sets it with EPDFAnnot_SetAppearanceFromPage, which copies the
// fonts into the document: PDFium's in-memory document keeps those copies and
// draws with them). Ctrl+S then shares them in the file:
//
//  - The first measurement font of a face that a save writes becomes the
//    document's shared one (its five object numbers are kept).
//  - Every other measurement font of that face in the tail is left out of it
//    (its Type0, CIDFont, FontDescriptor, FontFile2 and ToUnicode), and the
//    objects that point at its Type0 (the appearance forms' /Resources) point
//    at the shared one instead.
//  - When those fonts held glyphs the shared one has not, it is written again
//    in the same tail with the union subset (glyph ids are kept, so every
//    appearance that points at it still draws: HarfBuzz RETAIN_GIDS, /W from
//    hmtx, a ToUnicode of every glyph). The union only grows.
//
// What PDFium has in memory and the file then differ (its copies, our shared
// object). That is safe because nothing in memory is ever written over the
// shared numbers by a later narrow save (they are not dirty and not new), and
// the semantic save after a page operation writes our shared objects in place
// of PDFium's versions (`canonicalOverrides`); a dropped copy that comes back
// there is written with the form that points at it, which stays consistent.
// A full rewrite (Save Optimized, redaction) writes memory as it is and resets
// the sharing. Encrypted documents are not shared (our objects would need the
// file key): each caption keeps its own subset, as before.
//
// Which fonts are measurement fonts: the Render worker notes each caption's
// /BaseFont (its subset tag is a hash of the face and glyph ids) as it draws
// it (`noteMeasureFont`). Another font with the same name has the same glyphs
// of the same face, so sharing it is harmless too.
import { fontObjects, type FontNums } from '../commentFonts/appearance';
import type { Subsetter } from '../commentFonts/hbsubset';
import type { Face } from '../commentFonts/layout';
import { latin1 } from './bytes';
import type { ExtraObject, ObjectPatch, TailObject } from './narrowTail';

interface Noted {
  face: Face;
  used: ReadonlyMap<number, string>;
  sub: Subsetter;
}

interface Shared {
  face: Face;
  sub: Subsetter;
  nums: FontNums;
  used: Map<number, string>;
  /** Our objects, once written (null: PDFium's own copy is still the file's). */
  bytes: Uint8Array[] | null;
}

interface DocShare {
  /** Face key → the document's shared font. */
  shared: Map<string, Shared>;
  /** A left-out copy's Type0 → the shared Type0. */
  repoint: Map<number, number>;
  /** Every object number of a left-out copy. */
  dropped: Set<number>;
}

const noted = new Map<string, Map<string, Noted>>();
const committed = new Map<string, DocShare>();
const pending = new Map<string, DocShare>();

const faceKey = (f: Face): string => `${f.id}:${String(f.wght ?? '')}`;

/** The Render worker drew a measurement caption with this font (measureAppearance.ts). */
export function noteMeasureFont(
  docId: string,
  baseFont: string,
  face: Face,
  used: ReadonlyMap<number, string>,
  sub: Subsetter,
): void {
  let m = noted.get(docId);
  if (!m) noted.set(docId, (m = new Map<string, Noted>()));
  if (!m.has(baseFont)) m.set(baseFont, { face, used, sub });
}

/** A document opened again, closed, or fully rewritten: nothing is shared any more. */
export function forgetShare(docId: string, opts: { keepNotes?: boolean } = {}): void {
  committed.delete(docId);
  pending.delete(docId);
  if (!opts.keepNotes) noted.delete(docId);
}

/** The save that `shareFonts` worked for was written: its sharing is the file's now. */
export function commitShare(docId: string): void {
  const p = pending.get(docId);
  pending.delete(docId);
  if (p) committed.set(docId, p);
}

const clone = (d: DocShare | undefined): DocShare => ({
  shared: new Map(
    [...(d?.shared ?? new Map<string, Shared>())].map(([k, v]) => [
      k,
      { ...v, used: new Map(v.used) },
    ]),
  ),
  repoint: new Map(d?.repoint ?? []),
  dropped: new Set(d?.dropped ?? []),
});

const ref = (dict: string, key: string): number | null => {
  const m = new RegExp(`/${key}\\s*(?:\\[\\s*)?(\\d+)\\s+0\\s+R`, 'u').exec(dict);
  return m ? Number(m[1]) : null;
};

function encode(s: Shared): Uint8Array[] {
  return fontObjects(s.face, s.used, s.nums, s.sub, { italic: false }).objects;
}

/** An object's bytes with its references to left-out copies pointed at the shared fonts. */
export function repointBytes(bytes: Uint8Array, repoint: ReadonlyMap<number, number>): Uint8Array {
  const head = latin1(bytes.subarray(0, Math.min(bytes.length, 1 << 16)));
  const m = /(?:\r\n|\n|\r|\s)stream(?:\r\n|\n)/u.exec(head);
  const end = m ? m.index : bytes.length;
  const dict = m ? head.slice(0, end) : latin1(bytes);
  const next = dict.replace(/\b(\d+)(\s+)0(\s+)R\b/gu, (all, n: string, a: string, b: string) => {
    const to = repoint.get(Number(n));
    if (to === undefined) return all;
    return `${String(to)}${a}0${b}R`;
  });
  if (next === dict) return bytes;
  const out = new Uint8Array(next.length + bytes.length - end);
  for (let i = 0; i < next.length; i++) out[i] = next.charCodeAt(i);
  out.set(bytes.subarray(end), next.length);
  return out;
}

export interface ShareResult {
  extra: ExtraObject[];
  drop: Set<number>;
  /** Repointing patches, keyed by object number (applied only to objects the tail keeps). */
  repoint: Map<number, ObjectPatch>;
}

/**
 * The tail's measurement fonts shared (see the header): our objects for the
 * shared fonts whose glyphs grew, the copies to leave out, and the objects to
 * point at the shared fonts. Null when there is nothing to share. The result
 * becomes the document's sharing once `commitShare` is called.
 */
export function shareFonts(
  docId: string,
  objects: readonly TailObject[],
  opts: {
    encrypted: boolean;
    /** A save to commit later (not a recovery snapshot). */ record: boolean;
  },
): ShareResult | null {
  if (opts.record) pending.delete(docId);
  const notes = noted.get(docId);
  const before = committed.get(docId);
  if (opts.encrypted || (!notes && !before)) return null;
  const state = clone(before);
  const byNum = new Map(objects.map((o) => [o.num, o]));
  const sharedNums = new Set(
    [...state.shared.values()].flatMap((s) => Object.values(s.nums) as number[]),
  );
  const grown = new Set<string>();
  for (const o of objects) {
    if (sharedNums.has(o.num) || state.dropped.has(o.num)) continue;
    if (!/\/Subtype\s*\/Type0\b/u.test(o.dict)) continue;
    const name = /\/BaseFont\s*\/([^\s/<>[\]()]+)/u.exec(o.dict)?.[1];
    const note = name ? notes?.get(name) : undefined;
    if (!note) continue;
    const cid = ref(o.dict, 'DescendantFonts');
    const tounicode = ref(o.dict, 'ToUnicode');
    const cidObj = cid === null ? undefined : byNum.get(cid);
    const desc = cidObj ? ref(cidObj.dict, 'FontDescriptor') : null;
    const descObj = desc === null ? undefined : byNum.get(desc);
    const file = descObj ? ref(descObj.dict, 'FontFile2') : null;
    if (cid === null || tounicode === null || desc === null || file === null) continue;
    if (!byNum.has(file) || !byNum.has(tounicode)) continue;
    const nums: FontNums = { type0: o.num, cid, desc, file, tounicode };
    const key = faceKey(note.face);
    const shared = state.shared.get(key);
    if (!shared) {
      state.shared.set(key, {
        face: note.face,
        sub: note.sub,
        nums,
        used: new Map(note.used),
        bytes: null,
      });
      for (const n of Object.values(nums) as number[]) sharedNums.add(n);
      continue;
    }
    for (const [g, text] of note.used)
      if (!shared.used.has(g)) {
        shared.used.set(g, text);
        grown.add(key);
      }
    state.repoint.set(o.num, shared.nums.type0);
    for (const n of Object.values(nums) as number[]) state.dropped.add(n);
  }
  const extra: ExtraObject[] = [];
  for (const key of grown) {
    const s = state.shared.get(key);
    if (!s) continue;
    s.bytes = encode(s);
    const order = [s.nums.type0, s.nums.cid, s.nums.desc, s.nums.file, s.nums.tounicode];
    s.bytes.forEach((b, i) => extra.push({ num: order[i] ?? 0, gen: 0, bytes: b }));
  }
  const drop = new Set([...state.dropped].filter((n) => byNum.has(n)));
  const repoint = new Map<number, ObjectPatch>();
  if (state.repoint.size)
    for (const o of objects) {
      if (state.dropped.has(o.num) || sharedNums.has(o.num)) continue;
      const refs = [...o.dict.matchAll(/\b(\d+)\s+0\s+R\b/gu)].map((m) => Number(m[1]));
      if (!refs.some((r) => state.repoint.has(r))) continue;
      const map = state.repoint;
      repoint.set(o.num, { num: o.num, force: false, apply: (b) => repointBytes(b, map) });
    }
  if (opts.record) pending.set(docId, state);
  return { extra, drop, repoint };
}

/**
 * For the semantic save after a page operation: the shared fonts' objects as
 * the file must keep them (ours, with the union subset), by object number.
 */
export function canonicalOverrides(docId: string): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const d = committed.get(docId);
  if (!d) return out;
  for (const s of d.shared.values()) {
    if (!s.bytes) continue;
    const order = [s.nums.type0, s.nums.cid, s.nums.desc, s.nums.file, s.nums.tounicode];
    s.bytes.forEach((b, i) => out.set(order[i] ?? 0, b));
  }
  return out;
}

/** Diagnostics for tests: the document's shared fonts and left-out copies (never shown). */
export function shareState(docId: string): { shared: FontNums[]; dropped: number[] } {
  const d = committed.get(docId);
  return {
    shared: [...(d?.shared.values() ?? [])].map((s) => s.nums),
    dropped: [...(d?.dropped ?? [])].sort((a, b) => a - b),
  };
}
