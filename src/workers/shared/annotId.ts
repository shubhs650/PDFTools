// Stable ids for annotations that have no /NM (M3-05, ADR-014 decision 2):
// both workers derive the same id from the same file, so an id the Work worker
// listed can be found in the Render worker's document.

/** `obj-<n>` for an indirect annotation, `idx-<page>-<index>` for a direct one. */
export function stableAnnotId(objectNumber: number, pageIndex: number, index: number): string {
  return objectNumber > 0
    ? `obj-${String(objectNumber)}`
    : `idx-${String(pageIndex)}-${String(index)}`;
}

/** What a stable id points at, or null for any other id. */
export function parseStableId(
  id: string,
): { objectNumber: number } | { pageIndex: number; index: number } | null {
  let m = /^obj-(\d+)$/.exec(id);
  if (m) return { objectNumber: Number(m[1]) };
  m = /^idx-(\d+)-(\d+)$/.exec(id);
  if (m) return { pageIndex: Number(m[1]), index: Number(m[2]) };
  return null;
}
