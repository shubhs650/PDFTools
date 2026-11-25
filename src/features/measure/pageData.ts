// The measurements' Triya data on each page (M14-03, D-74, ADR-035 Amendment
// 1 decision 3): after any create, change or removal of a measurement, the
// page's /PieceInfo is staged again through the object layer, so it rides the
// single Ctrl+S revision (rule 7). It is worked out from the annotations as
// they are now (undo and redo included): a measurement edited in this session
// writes its `measure` field; one read from the file and not touched keeps the
// entry it had; a removed one loses its entry. Other applications' /PieceInfo
// entries are kept (model/measureData.ts). Never undoable on its own: it
// follows the annotations, which are.
import type { PdfAnnotationObject } from '@embedpdf/models';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import {
  entryFromPdf,
  entryToPdf,
  geometryFingerprint,
  metaFromEntry,
  pageData,
  readItems,
} from '../../model/measureData';
import { metaOf, type MeasureMeta } from '../../model/measureMarkup';
import { measurePoints, toUserSpace } from '../../model/measurement';
import type { PdfJson } from '../../model/pdf/wire';
import { renderEngine } from '../view/host';
import { scaleStore } from './scaleStore';
import { frameOf } from './viewports';

/** The file's /PieceInfo of a page, as read when the document opened (null: none, or unknown yet). */
function filePieceInfo(docId: string, page: number): PdfJson {
  const d = scaleStore.getState().docs[docId];
  if (!d || typeof d === 'string') return null;
  return d.pages[page]?.pieceInfo ?? null;
}

/** The fingerprint of an annotation's geometry in user space (what its entry is saved against). */
export function fingerprintOf(docId: string, a: PdfAnnotationObject): string {
  return geometryFingerprint(toUserSpace(measurePoints(a), frameOf(docId, a.pageIndex)));
}

/**
 * The meta the file holds for a measurement read from it: its Triya entry
 * (without the shape-bound part when another editor moved or reshaped it), or
 * null when the file has none.
 */
export function fileMeta(docId: string, a: PdfAnnotationObject): MeasureMeta | null {
  const raw = readItems(filePieceInfo(docId, a.pageIndex)).get(a.id);
  const e = raw === undefined ? null : entryFromPdf(raw);
  return e ? metaFromEntry(e, fingerprintOf(docId, a)) : null;
}

/** A date as PDF writes it (ISO 32000-1 §7.9.4), in UTC. */
export function pdfDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `D:${String(d.getUTCFullYear())}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** The page's items now: ours from `measure`, the file's for untouched annotations still there. */
export function itemsFor(
  docId: string,
  page: number,
  annots: readonly PdfAnnotationObject[],
): Map<string, PdfJson> {
  const file = readItems(filePieceInfo(docId, page));
  const out = new Map<string, PdfJson>();
  for (const a of annots) {
    if (a.pageIndex !== page) continue;
    const meta = metaOf(a);
    if (meta) out.set(a.id, entryToPdf({ meta, fp: fingerprintOf(docId, a) }));
    else {
      const raw = file.get(a.id);
      if (raw !== undefined) out.set(a.id, raw);
    }
  }
  return out;
}

/** What was last staged per page (`doc/page` → items), so an unchanged page stages nothing. */
const staged = new Map<string, string>();
const queued = new Map<string, { docId: string; page: number }>();

/** The page's /PieceInfo staged again soon (once per page per burst of events). */
export function stagePageData(
  docId: string,
  page: number,
  annots: () => readonly PdfAnnotationObject[],
): void {
  const key = `${docId}/${String(page)}`;
  if (queued.has(key)) return;
  queued.set(key, { docId, page });
  queueMicrotask(() => {
    queued.delete(key);
    void stageNow(docId, page, annots());
  });
}

async function stageNow(
  docId: string,
  page: number,
  annots: readonly PdfAnnotationObject[],
): Promise<void> {
  const key = `${docId}/${String(page)}`;
  const items = itemsFor(docId, page, annots);
  const fileItems = readItems(filePieceInfo(docId, page));
  const sig = JSON.stringify([...items].sort(([a], [b]) => a.localeCompare(b)));
  const before =
    staged.get(key) ?? JSON.stringify([...fileItems].sort(([a], [b]) => a.localeCompare(b)));
  if (sig === before) return;
  staged.set(key, sig);
  const { set, remove } = pageData(filePieceInfo(docId, page), items, pdfDate(new Date()));
  try {
    await renderEngine().rpc.call('stageObjects', {
      docId,
      target: { page },
      set,
      ...(remove.length ? { remove } : {}),
    }).promise;
    documentStore.getState().markDirty(docId);
  } catch (err) {
    staged.delete(key);
    recordError('measure.pageData', err);
  }
}

/** Forget a closed document's pages. */
documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs))
    if (!(id in s.docs))
      for (const k of [...staged.keys()]) if (k.startsWith(`${id}/`)) staged.delete(k);
});
