// Flatten Comments in the Render worker (M6-09, ADR-021 D-38 c): the planned
// comments are drawn into their page's content with EPDFAnnot_Flatten (which
// removes the annotation), their pop-ups and dropped replies are removed, kept
// replies lose their /IRT. Runs as a page operation (pages.ts), so the caller's
// undo snapshot restores everything and saves turn semantic (ADR-016).
//
// Annotations are flattened in /Annots order: each flatten appends a form
// XObject to the page's objects, so the drawing order stays as it was. An
// annotation without an appearance gets PDFium's generated one first (a note
// from another tool, say); if it still can't be drawn it is left as it is.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { parseStableId } from '../shared/annotId';
import { readAnnotString } from './annotTiles';
import { rawCall } from './pdfium';

/** One page of a flatten (ids as the viewer knows them: /NM or a stable id). */
export interface FlattenPage {
  page: number;
  /** Drawn into the page, then removed. */
  flatten: string[];
  /** Removed (replies, review states). */
  remove: string[];
  /** Kept as separate notes: /IRT dropped. */
  unlink: string[];
}

export interface FlattenCounts {
  flattened: number;
  removed: number;
  /** Planned for flattening but left as they are (no appearance PDFium can draw). */
  failed: number;
}

// FPDF_ANNOTATION_SUBTYPE values never flattened, whatever the plan says (rule 8: a
// flattened redaction mark looks redacted and isn't).
const FPDF_ANNOT_LINK = 2;
const FPDF_ANNOT_POPUP = 16;
const FPDF_ANNOT_WIDGET = 20;
const FPDF_ANNOT_XFAWIDGET = 27;
const FPDF_ANNOT_REDACT = 28;
const NEVER = new Set([
  FPDF_ANNOT_LINK,
  FPDF_ANNOT_POPUP,
  FPDF_ANNOT_WIDGET,
  FPDF_ANNOT_XFAWIDGET,
  FPDF_ANNOT_REDACT,
]);
/** /F Hidden and NoView: nothing to draw. */
const HIDDEN_FLAGS = 2 | 32;

interface Entry {
  index: number;
  obj: number;
  name: string;
  subtype: number;
  flags: number;
  /** Object number of the annotation's /Popup (0: none). */
  popup: number;
  /** A pop-up's /Parent object number (0: none). */
  parent: number;
}

function linkedObject(mod: WrappedPdfiumModule, annot: number, key: string): number {
  const linked = rawCall(mod, 'FPDFAnnot_GetLinkedAnnot', annot, key);
  if (!linked) return 0;
  try {
    return rawCall(mod, 'EPDFAnnot_GetObjectNumber', linked);
  } finally {
    rawCall(mod, 'FPDFPage_CloseAnnot', linked);
  }
}

function entries(mod: WrappedPdfiumModule, pagePtr: number): Entry[] {
  const n = rawCall(mod, 'FPDFPage_GetAnnotCount', pagePtr);
  const out: Entry[] = [];
  for (let index = 0; index < n; index++) {
    const a = rawCall(mod, 'FPDFPage_GetAnnot', pagePtr, index);
    if (!a) continue;
    try {
      const subtype = rawCall(mod, 'FPDFAnnot_GetSubtype', a);
      out.push({
        index,
        obj: rawCall(mod, 'EPDFAnnot_GetObjectNumber', a),
        name: readAnnotString(mod, a, 'NM'),
        subtype,
        flags: rawCall(mod, 'FPDFAnnot_GetFlags', a),
        popup: subtype === FPDF_ANNOT_POPUP ? 0 : linkedObject(mod, a, 'Popup'),
        parent: subtype === FPDF_ANNOT_POPUP ? linkedObject(mod, a, 'Parent') : 0,
      });
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  }
  return out;
}

/** The entry an id names: its /NM, else the stable id's object number or position. */
function find(list: readonly Entry[], id: string, page: number): Entry | undefined {
  const byName = list.find((e) => e.name === id);
  if (byName) return byName;
  const t = parseStableId(id);
  if (!t) return undefined;
  return 'objectNumber' in t
    ? list.find((e) => e.obj === t.objectNumber)
    : t.pageIndex === page
      ? list.find((e) => e.index === t.index)
      : undefined;
}

/** Applies one page of a flatten to the loaded page `pagePtr`. */
export function flattenOnPage(
  mod: WrappedPdfiumModule,
  pagePtr: number,
  plan: FlattenPage,
): FlattenCounts {
  const list = entries(mod, pagePtr);
  const pick = (ids: readonly string[]): Entry[] =>
    ids.map((id) => find(list, id, plan.page)).filter((e): e is Entry => e !== undefined);
  const flatten = new Set(pick(plan.flatten).filter((e) => !NEVER.has(e.subtype)));
  const remove = new Set(pick(plan.remove).filter((e) => !flatten.has(e)));
  // Pop-ups of everything that goes: by the annotation's /Popup and the pop-up's /Parent.
  const gone = new Set([...flatten, ...remove].map((e) => e.obj).filter((o) => o > 0));
  const popups = new Set([...flatten, ...remove].map((e) => e.popup).filter((o) => o > 0));
  for (const e of list) {
    if (flatten.has(e)) continue;
    if (e.subtype === FPDF_ANNOT_POPUP && (gone.has(e.parent) || popups.has(e.obj))) remove.add(e);
  }

  // Kept replies first: dropping /IRT moves nothing.
  for (const e of pick(plan.unlink)) {
    if (flatten.has(e) || remove.has(e)) continue;
    const a = rawCall(mod, 'FPDFPage_GetAnnot', pagePtr, e.index);
    if (!a) continue;
    try {
      rawCall(mod, 'EPDFAnnot_SetLinkedAnnot', a, 'IRT', 0);
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  }

  const counts: FlattenCounts = { flattened: 0, removed: 0, failed: 0 };
  // In /Annots order; `shift`: annotations before the current one already taken out.
  let shift = 0;
  const work = [...flatten, ...remove].sort((a, b) => a.index - b.index);
  for (const e of work) {
    const index = e.index - shift;
    if (remove.has(e)) {
      if (rawCall(mod, 'FPDFPage_RemoveAnnot', pagePtr, index)) {
        shift++;
        counts.removed++;
      }
      continue;
    }
    if (e.flags & HIDDEN_FLAGS) {
      counts.failed++;
      continue;
    }
    const before = rawCall(mod, 'FPDFPage_GetAnnotCount', pagePtr);
    const a = rawCall(mod, 'FPDFPage_GetAnnot', pagePtr, index);
    if (!a) {
      counts.failed++;
      continue;
    }
    try {
      if (!rawCall(mod, 'EPDFAnnot_HasAppearanceStream', a))
        rawCall(mod, 'EPDFAnnot_GenerateAppearance', a);
      rawCall(mod, 'EPDFAnnot_Flatten', pagePtr, a);
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
    if (rawCall(mod, 'FPDFPage_GetAnnotCount', pagePtr) < before) {
      shift++;
      counts.flattened++;
    } else counts.failed++;
  }
  if (counts.flattened > 0 && !rawCall(mod, 'FPDFPage_GenerateContent', pagePtr))
    throw new RpcError('flatten-failed', 'The page content could not be written');
  return counts;
}

/** Sorted, unique, in-range pages of a flatten; throws on a bad plan. */
export function checkFlattenPlan(pages: readonly FlattenPage[], count: number): FlattenPage[] {
  if (pages.length === 0) throw new RpcError('pages-empty', 'Nothing to flatten');
  const seen = new Set<number>();
  for (const p of pages) {
    if (!Number.isInteger(p.page) || p.page < 0 || p.page >= count)
      throw new RpcError('pages-range', 'A page is out of range');
    if (seen.has(p.page)) throw new RpcError('pages-range', 'A page is listed twice');
    seen.add(p.page);
  }
  return [...pages].sort((a, b) => a.page - b.page);
}
