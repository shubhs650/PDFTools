// Save verification (M1-21, ADR-005 decision 2): does original + tail, as the
// Work worker reads it, show what the Render worker had? Compared per page on
// the digest (digest.ts). Pure, so it is unit-tested without PDFium.
import {
  NM_UNCHECKED,
  type AnnotDigest,
  type DocDigest,
  type FieldDigest,
} from '../render/save/digest';

export type MismatchReason = 'unparsable' | 'page-count' | 'missing-page' | 'annotations' | 'form';

export type VerifyResult = { ok: true } | { ok: false; reason: MismatchReason; page?: number };

const annotKey = (a: AnnotDigest): string =>
  `${String(a.subtype)}|${a.rect.join(',')}|${a.contents}`;
const fieldKey = (f: FieldDigest): string => `${f.name}|${f.value}|${String(f.checked)}`;

/** Order-insensitive equality of two lists by key. */
function sameMultiset<T>(a: readonly T[], b: readonly T[], key: (x: T) => string): boolean {
  if (a.length !== b.length) return false;
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.every((k, i) => k === y[i]);
}

/**
 * Same annotations: equal on subtype, rect and contents, and every checked
 * /NM of `want` present in `got` (an unchecked one, NM_UNCHECKED, matches any).
 */
function sameAnnots(want: readonly AnnotDigest[], got: readonly AnnotDigest[]): boolean {
  if (!sameMultiset(want, got, annotKey)) return false;
  const pool = new Map<string, number>();
  for (const g of got)
    pool.set(`${annotKey(g)}|${g.nm}`, (pool.get(`${annotKey(g)}|${g.nm}`) ?? 0) + 1);
  for (const w of want) {
    if (w.nm === NM_UNCHECKED) continue;
    const k = `${annotKey(w)}|${w.nm}`;
    const n = pool.get(k) ?? 0;
    if (n === 0) return false;
    pool.set(k, n - 1);
  }
  return true;
}

export function compareDigests(expected: DocDigest, actual: DocDigest): VerifyResult {
  if (expected.pageCount !== actual.pageCount) return { ok: false, reason: 'page-count' };
  const byPage = new Map(actual.pages.map((p) => [p.page, p]));
  for (const want of expected.pages) {
    const got = byPage.get(want.page);
    if (!got) return { ok: false, reason: 'missing-page', page: want.page };
    if (!sameAnnots(want.annots, got.annots)) {
      return { ok: false, reason: 'annotations', page: want.page };
    }
    if (!sameMultiset(want.fields, got.fields, fieldKey)) {
      return { ok: false, reason: 'form', page: want.page };
    }
  }
  return { ok: true };
}
