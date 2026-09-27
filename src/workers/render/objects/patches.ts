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
import { ABSENT, hashText, type ObjectDigest } from '../save/digest';

/** A page (its dictionary) or one annotation on it, by EmbedPDF id (/NM). */
export interface PatchTarget {
  page: number;
  annot?: string;
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
  t.annot === undefined ? `p${String(t.page)}` : `p${String(t.page)}/${t.annot}`;

/**
 * The only keys our layer writes (ADR-007): measurement keys on annotations and
 * viewports on pages. Everything else belongs to PDFium/EmbedPDF — a sticky
 * copy of, say, /Contents would undo the user's later edits (the measured
 * value goes to /Contents through EmbedPDF instead).
 */
const ANNOT_KEYS = new Set(['Measure', 'IT', 'Cap', 'CP', 'LL', 'LLE', 'LLO', 'CO']);
const PAGE_KEYS = new Set(['VP']);

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
   * Merges keys into the target's patch. `encrypted`: strings can't be written
   * yet (their encryption comes with M3-04), so values holding one are refused.
   */
  stage(
    target: PatchTarget,
    set: ReadonlyMap<string, PdfValue>,
    remove: readonly string[],
    seq: number,
    encrypted: boolean,
  ): void {
    for (const k of [...set.keys(), ...remove]) {
      if (!(target.annot === undefined ? PAGE_KEYS : ANNOT_KEYS).has(k))
        throw new PatchError('patch-key', `The key /${k} can't be patched`);
    }
    if (encrypted && [...set.values()].some(containsString))
      throw new PatchError(
        'patch-encrypted',
        'Strings can not be written into encrypted documents yet',
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

  /** After a committed save that included changes up to `seq`. */
  committed(seq: number): void {
    for (const p of this.byTarget.values()) if (p.seq <= seq) p.clean = true;
  }
}

export class PatchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** PDFium's serialization of the object with the patch applied (same number and generation). */
export function applyPatch(objectBytes: Uint8Array, p: Patch): Uint8Array {
  const { num, gen, value } = parseIndirect(objectBytes);
  if (!isDict(value))
    throw new PatchError('patch-target', 'The patched object is not a dictionary');
  for (const k of p.remove) value.delete(k);
  for (const [k, v] of p.set) value.set(k, v);
  return serializeIndirect(num, gen, value);
}

/** What the saved file must show for this patch. */
export function patchDigest(obj: number, p: Patch): ObjectDigest {
  const keys: Record<string, string> = {};
  for (const [k, v] of p.set) keys[k] = hashText(serialize(v));
  for (const k of p.remove) keys[k] = ABSENT;
  return { obj, keys };
}
