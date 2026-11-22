// A comparison's inputs (M12-08, D-58, ARCHITECTURE §7.16): its type, the files on each
// side with their page ranges, and whether it shows the input window or the result. Pure:
// the store transitions and the checks the input window shows, unit-tested without React.
import { parseRange, type RangeError } from '../print/options';

/** PDF Overlay (drawings) or Text Comparison (documents). */
export type CompareType = 'overlay' | 'text';

/** The comparison types, in the order the input window offers them. */
export const COMPARE_TYPES: readonly CompareType[] = ['overlay', 'text'];

/** Document A (old) or Document B (new). */
export type SideId = 'a' | 'b';

export const SIDES: readonly SideId[] = ['a', 'b'];

export interface SideFile {
  /** An open document (with or without a tab of its own). */
  docId: string;
  /** The pages to compare as typed ("1-3, 8"); empty: every page. */
  range: string;
}

export interface Comparison {
  id: string;
  type: CompareType;
  /** The input window, or the result (the inputs can be revisited, D-58). */
  stage: 'input' | 'result';
  /** Document A, the old revision: one file, or a set of files for an overlay (Q38). */
  a: SideFile[];
  /** Document B, the new revision. */
  b: SideFile[];
}

export const newComparisonId = (): string => `cmp-${crypto.randomUUID()}`;

export function newComparison(
  id: string,
  type: CompareType,
  a: readonly string[] = [],
  b: readonly string[] = [],
): Comparison {
  const files = (ids: readonly string[]): SideFile[] =>
    (type === 'text' ? ids.slice(0, 1) : ids).map((docId) => ({ docId, range: '' }));
  return { id, type, stage: 'input', a: files(a), b: files(b) };
}

/** Every document the comparison uses, A's then B's, each once. */
export function documentsOf(c: Comparison): string[] {
  return [...new Set([...c.a, ...c.b].map((f) => f.docId))];
}

/**
 * Files added to a side. A text comparison takes one file per side (Q39): the first
 * new one replaces what was there. An overlay side is a set (Q38): new files are added
 * at the end, a file already there stays where it is. A file on the other side moves
 * here (one document cannot be shown twice, S27 finding 2).
 */
export function addFiles(c: Comparison, side: SideId, docIds: readonly string[]): Comparison {
  const other: SideId = side === 'a' ? 'b' : 'a';
  const fresh = [...new Set(docIds)];
  const first = fresh[0];
  if (first === undefined) return c;
  let files: SideFile[];
  if (c.type === 'text') {
    files = [c[side].find((f) => f.docId === first) ?? { docId: first, range: '' }];
  } else {
    const have = new Set(c[side].map((f) => f.docId));
    files = [
      ...c[side],
      ...fresh.filter((id) => !have.has(id)).map((docId) => ({ docId, range: '' })),
    ];
  }
  const here = new Set(files.map((f) => f.docId));
  return { ...c, [side]: files, [other]: c[other].filter((f) => !here.has(f.docId)) };
}

export function removeFile(c: Comparison, side: SideId, docId: string): Comparison {
  return { ...c, [side]: c[side].filter((f) => f.docId !== docId) };
}

/** Moves a file of an overlay set one place up (-1) or down (+1); file order helps pairing. */
export function moveFile(c: Comparison, side: SideId, docId: string, step: -1 | 1): Comparison {
  const files = [...c[side]];
  const i = files.findIndex((f) => f.docId === docId);
  const j = i + step;
  if (i < 0 || j < 0 || j >= files.length) return c;
  const [f] = files.splice(i, 1);
  if (f) files.splice(j, 0, f);
  return { ...c, [side]: files };
}

export function setRange(c: Comparison, side: SideId, docId: string, range: string): Comparison {
  return {
    ...c,
    [side]: c[side].map((f) => (f.docId === docId ? { ...f, range } : f)),
  };
}

/** Swap: A becomes B and B becomes A, with their ranges. */
export function swapSides(c: Comparison): Comparison {
  return { ...c, a: c.b, b: c.a };
}

/**
 * The other type on the same files (D-58: "run the other comparison type"). A text
 * comparison keeps the first file of each side; the others stay open in their tabs, or
 * are closed by the caller.
 */
export function withType(c: Comparison, type: CompareType): Comparison {
  if (type === c.type) return c;
  return type === 'text' ? { ...c, type, a: c.a.slice(0, 1), b: c.b.slice(0, 1) } : { ...c, type };
}

/** The pages a range selects (0-based, in document order, each once). */
export function rangePages(
  range: string,
  pageCount: number,
): { ok: true; pages: number[] } | { ok: false; error: RangeError } {
  if (range.trim() === '')
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i) };
  const r = parseRange(range, pageCount);
  return r.ok ? { ok: true, pages: [...new Set(r.pages)].sort((x, y) => x - y) } : r;
}

/** Why Compare cannot run yet (the first reason), or null. */
export type CompareBlock =
  | { kind: 'empty'; side: SideId }
  | { kind: 'range'; side: SideId; docId: string; error: RangeError }
  | { kind: 'opening' };

export function compareBlock(
  c: Comparison,
  pageCount: (docId: string) => number | undefined,
): CompareBlock | null {
  for (const side of SIDES) {
    if (c[side].length === 0) return { kind: 'empty', side };
    for (const f of c[side]) {
      const count = pageCount(f.docId);
      if (count === undefined) return { kind: 'opening' };
      const r = rangePages(f.range, count);
      if (!r.ok) return { kind: 'range', side, docId: f.docId, error: r.error };
    }
  }
  return null;
}

/** The pages of a side in set order: each file's chosen pages (for the summary). */
export function sidePageCount(
  files: readonly SideFile[],
  pageCount: (docId: string) => number | undefined,
): number {
  let n = 0;
  for (const f of files) {
    const count = pageCount(f.docId);
    if (count === undefined) continue;
    const r = rangePages(f.range, count);
    if (r.ok) n += r.pages.length;
  }
  return n;
}

/** A file name without its ".pdf", for the tab's name. */
export const baseName = (name: string): string => name.replace(/\.pdf$/i, '');

/**
 * The tab's name parts: the first file of each side without ".pdf" and how many more
 * files the side holds ("RevA ↔ RevB", "Sheets-A +2 ↔ Sheets-B +2"); null when a side
 * is empty (the tab then shows the comparison type).
 */
export function nameParts(
  c: Comparison,
  nameOf: (docId: string) => string | undefined,
): { a: string; aMore: number; b: string; bMore: number } | null {
  const first = (files: readonly SideFile[]): string | undefined => {
    const f = files[0];
    return f ? nameOf(f.docId) : undefined;
  };
  const a = first(c.a);
  const b = first(c.b);
  if (a === undefined || b === undefined) return null;
  return { a: baseName(a), aMore: c.a.length - 1, b: baseName(b), bMore: c.b.length - 1 };
}
