// Staged object patches (M3-03, ADR-007 decisions 1 and 5): keys EmbedPDF and
// PDFium can't write (/Measure, /IT, /Cap on annotations; /VP on pages), set on
// objects PDFium serializes, merged into the single Ctrl+S revision.
//
// PDFium's in-memory object never learns our keys, so a patch is *sticky*:
// whenever a later save rewrites the object (a colour change, a moved vertex),
// the keys are applied again. A patch changed since the last committed save is
// *pending*: it forces its object into the next tail.
import {
  containsString,
  isDict,
  parseIndirect,
  serialize,
  serializeIndirect,
  type PdfValue,
} from '../../../model/pdf/objects';
import type { StandardCrypt } from '../../../model/pdf/security/standard';
import { ABSENT, hashText, type ObjectDigest } from '../save/digest';

/**
 * A page (its dictionary), one annotation on it by EmbedPDF id (/NM), or —
 * with `field` — the form field that widget belongs to (its /Parent, or the
 * widget itself when merged; M6-14).
 */
export interface PatchTarget {
  page: number;
  annot?: string;
  field?: true;
}

export interface Patch {
  target: PatchTarget;
  set: Map<string, PdfValue>;
  remove: Set<string>;
  /** Sequence number of the last change (the tracker's counter). */
  seq: number;
  /** Written by a committed save and not changed since. */
  clean: boolean;
}

export const targetKey = (t: PatchTarget): string =>
  t.annot === undefined
    ? `p${String(t.page)}`
    : `p${String(t.page)}/${t.annot}${t.field ? '/field' : ''}`;

/**
 * The only keys our layer writes (ADR-007): measurement keys on annotations,
 * a pop-up's /Open, and viewports on pages. Everything else belongs to PDFium/EmbedPDF — a sticky
 * copy of, say, /Contents would undo the user's later edits (the measured
 * value goes to /Contents through EmbedPDF instead).
 */
// /Open: a sticky note pop-up's open state, a boolean PDFium can't write (M7-06, S23).
const ANNOT_KEYS = new Set(['Measure', 'IT', 'Cap', 'CP', 'LL', 'LLE', 'LLO', 'CO', 'Open']);
/** /Tabs: the page's form tab order (M6-14). */
const PAGE_KEYS = new Set(['VP', 'Tabs']);
/** A form field's tooltip and default value, which EmbedPDF doesn't write (M6-14, ADR-022 d4). */
export const FIELD_KEYS = new Set(['TU', 'DV']);

const keysFor = (t: PatchTarget): ReadonlySet<string> =>
  t.annot === undefined ? PAGE_KEYS : t.field ? FIELD_KEYS : ANNOT_KEYS;

export class PatchSet {
  private readonly byTarget = new Map<string, Patch>();

  get size(): number {
    return this.byTarget.size;
  }

  get pending(): number {
    let n = 0;
    for (const p of this.byTarget.values()) if (!p.clean) n++;
    return n;
  }

  all(): Patch[] {
    return [...this.byTarget.values()];
  }

  /**
   * Merges keys into the target's patch. `encrypted`: the document is encrypted
   * and we have no file key for it (a handler other than Standard, M3-04), so
   * values holding a string are refused.
   */
  stage(
    target: PatchTarget,
    set: ReadonlyMap<string, PdfValue>,
    remove: readonly string[],
    seq: number,
    encrypted: boolean,
  ): void {
    for (const k of [...set.keys(), ...remove]) {
      if (!keysFor(target).has(k))
        throw new PatchError('patch-key', `The key /${k} can't be patched`);
    }
    if (encrypted && [...set.values()].some(containsString))
      throw new PatchError(
        'patch-encrypted',
        'Strings can not be written into this encrypted document',
      );
    const key = targetKey(target);
    const p = this.byTarget.get(key) ?? {
      target: { ...target },
      set: new Map<string, PdfValue>(),
      remove: new Set<string>(),
      seq,
      clean: false,
    };
    for (const [k, v] of set) {
      p.set.set(k, v);
      p.remove.delete(k);
    }
    for (const k of remove) {
      p.set.delete(k);
      p.remove.add(k);
    }
    p.seq = seq;
    p.clean = false;
    this.byTarget.set(key, p);
  }

  /**
   * Page targets follow a page operation (ADR-016 cache map): `map` gives each
   * old page index its new one, or null for a deleted page (its patches go).
   */
  remapPages(map: (page: number) => number | null, seq: number): void {
    const all = [...this.byTarget.values()];
    this.byTarget.clear();
    for (const p of all) {
      const page = map(p.target.page);
      if (page === null) continue;
      const moved = page !== p.target.page;
      const next: Patch = {
        ...p,
        target: { ...p.target, page },
        ...(moved ? { seq, clean: false } : {}),
      };
      this.byTarget.set(targetKey(next.target), next);
    }
  }

  /** A deep copy (an undo snapshot of the staged keys). */
  clone(): PatchSet {
    const out = new PatchSet();
    for (const [k, p] of this.byTarget)
      out.byTarget.set(k, {
        ...p,
        target: { ...p.target },
        set: new Map(p.set),
        remove: new Set(p.remove),
      });
    return out;
  }

  /** After a committed save that included changes up to `seq`. */
  committed(seq: number): void {
    for (const p of this.byTarget.values()) if (p.seq <= seq) p.clean = true;
  }
}

/** Two patches of one object (widgets of the same field): `b`'s keys win if it is newer. */
export function mergePatches(a: Patch, b: Patch): Patch {
  const [first, last] = a.seq <= b.seq ? [a, b] : [b, a];
  const set = new Map(first.set);
  const remove = new Set(first.remove);
  for (const k of last.remove) {
    set.delete(k);
    remove.add(k);
  }
  for (const [k, v] of last.set) {
    set.set(k, v);
    remove.delete(k);
  }
  return { target: last.target, set, remove, seq: last.seq, clean: a.clean && b.clean };
}

export class PatchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** PDFium's serialization of the object with the patch applied (same number and generation). */
/**
 * PDFium's serialization of the object with the patch applied (same number and
 * generation). In an encrypted file PDFium's own strings are already
 * ciphertext; only our values are encrypted, with this object's key (M3-04).
 */
export function applyPatch(
  objectBytes: Uint8Array,
  p: Patch,
  crypt?: StandardCrypt | null,
): Uint8Array {
  const { num, gen, value } = parseIndirect(objectBytes);
  if (!isDict(value))
    throw new PatchError('patch-target', 'The patched object is not a dictionary');
  for (const k of p.remove) value.delete(k);
  for (const [k, v] of p.set) value.set(k, crypt ? crypt.mapStrings(v, num, gen, true) : v);
  return serializeIndirect(num, gen, value);
}

/** What the saved file must show for this patch. */
export function patchDigest(obj: number, p: Patch): ObjectDigest {
  const keys: Record<string, string> = {};
  for (const [k, v] of p.set) keys[k] = hashText(serialize(v));
  for (const k of p.remove) keys[k] = ABSENT;
  return { obj, keys };
}
