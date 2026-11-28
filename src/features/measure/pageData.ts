// The measurements' Triya data on each page (M14-03, D-74, ADR-035 Amendment
// 1 decision 3): after any create, change or removal of a measurement, the
// page's /PieceInfo is staged again through the object layer, so it rides the
// single Ctrl+S revision (rule 7). It is worked out from the annotations as
// they are now (undo and redo included): a measurement edited in this session
// writes its `measure` field; one read from the file and not touched keeps the
// entry it had; a removed one loses its entry. Other applications' /PieceInfo
// entries are kept (model/measureData.ts). Never undoable on its own: it
// follows the annotations, which are.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import {
  curvePointsNow,
  entryFromPdf,
  entryToPdf,
  geometryFingerprint,
  metaFromEntry,
  pageData,
  readItems,
  type CurveEntry,
  type MeasureEntry,
} from '../../model/measureData';
import type { Box } from '../../model/measureGeometry';
import { isAreaTool, isStampTool, metaOf, type MeasureMeta } from '../../model/measureMarkup';
import { summaryOf, summaryToPdf } from '../../model/measureSummary';
import { fromUserSpace, measurePoints, toUserSpace } from '../../model/measurement';
import type { PdfJson } from '../../model/pdf/wire';
import type { Scale } from '../../model/scale';
import { renderEngine } from '../view/host';
import { scaleStore } from './scaleStore';
import { boxFromPoints, frameOf } from './viewports';

/** The file's /PieceInfo of a page, as read when the document opened (null: none, or unknown yet). */
function filePieceInfo(docId: string, page: number): PdfJson {
  const d = scaleStore.getState().docs[docId];
  if (!d || typeof d === 'string') return null;
  return d.pages[page]?.pieceInfo ?? null;
}

/** An annotation's /Rect in user space. */
function userRect(docId: string, a: PdfAnnotationObject): Box {
  const { origin: o, size } = a.rect;
  return boxFromPoints(docId, a.pageIndex, o, {
    x: o.x + size.width,
    y: o.y + size.height,
  });
}

const isStamp = (a: PdfAnnotationObject): boolean => a.type === PdfAnnotationSubtype.STAMP;

/**
 * The fingerprint of an annotation's geometry in user space (what its entry is
 * saved against); a Stamp's (Angle, Radius, Diameter) is of its /Rect.
 */
export function fingerprintOf(docId: string, a: PdfAnnotationObject): string {
  if (isStamp(a)) {
    const [x0, y0, x1, y1] = userRect(docId, a);
    return geometryFingerprint([
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ]);
  }
  return geometryFingerprint(toUserSpace(measurePoints(a), frameOf(docId, a.pageIndex)));
}

function fileEntry(docId: string, a: PdfAnnotationObject): MeasureEntry | null {
  const raw = readItems(filePieceInfo(docId, a.pageIndex)).get(a.id);
  return raw === undefined ? null : entryFromPdf(raw);
}

/**
 * The meta the file holds for a measurement read from it: its Triya entry
 * (without the shape-bound part when another editor moved or reshaped it), or
 * null when the file has none. An Angle's, Radius's or Diameter's points come
 * back in page points, moved with its Stamp when another editor moved it, and
 * not at all when it was resized there (M14-05).
 */
export function fileMeta(docId: string, a: PdfAnnotationObject): MeasureMeta | null {
  const e = fileEntry(docId, a);
  if (!e) return null;
  const fp = fingerprintOf(docId, a);
  const meta = metaFromEntry(e, fp);
  // An Area's or Volume's cutouts (M14-06): kept while its outline is the one saved.
  if (isAreaTool(meta.tool)) {
    if (e.holes?.length && e.fp === fp)
      meta.holes = e.holes.map((h) => fromUserSpace(h, frameOf(docId, a.pageIndex)));
    return meta;
  }
  // An Angle, Radius, Diameter (M14-05) or Count (M14-07): its points from its entry.
  if (!isStampTool(meta.tool)) return meta;
  if (!isStamp(a)) return null;
  const now = curvePointsNow(e.curve, userRect(docId, a));
  if (now) {
    meta.pts = fromUserSpace(now, frameOf(docId, a.pageIndex));
    // Its caption's offset is in its own frame: it moved with it.
    if (e.meta.capOffset) meta.capOffset = e.meta.capOffset;
  } else delete meta.shape;
  return meta;
}

/** A curve's colour and line width from the file's Triya data (a Stamp keeps neither). */
export function fileStyle(
  docId: string,
  a: PdfAnnotationObject,
): { strokeColor?: string; strokeWidth?: number } {
  const c = fileEntry(docId, a)?.curve;
  return {
    ...(c?.color ? { strokeColor: c.color } : {}),
    ...(typeof c?.width === 'number' ? { strokeWidth: c.width } : {}),
  };
}

/** The scale a measurement is valued in (measurements.ts), for a curve's /Sc. */
let scaleOf: (docId: string, a: PdfAnnotationObject) => Scale | null = () => null;

export function setCurveScaleSource(fn: typeof scaleOf): void {
  scaleOf = fn;
}

/** An Angle's, Radius's or Diameter's own data for its entry (user space). */
function curveEntry(docId: string, a: PdfAnnotationObject, meta: MeasureMeta): CurveEntry {
  const o = a as unknown as { strokeColor?: unknown; strokeWidth?: unknown };
  // An Angle and a Count need no scale (Q9, Q11); a Count has no line width of its own.
  const s = meta.tool === 'angle' || meta.tool === 'count' ? null : scaleOf(docId, a);
  return {
    pts: toUserSpace(meta.pts ?? [], frameOf(docId, a.pageIndex)),
    rect: userRect(docId, a),
    ...(typeof o.strokeColor === 'string' ? { color: o.strokeColor } : {}),
    ...(typeof o.strokeWidth === 'number' && meta.tool !== 'count' ? { width: o.strokeWidth } : {}),
    ...(s ? { scale: { paper: s.paper, real: s.real, unit: s.unit } } : {}),
  };
}

/** A date as PDF writes it (ISO 32000-1 §7.9.4), in UTC. */
export function pdfDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `D:${String(d.getUTCFullYear())}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** The page's items now: ours from `measure`, the file's for untouched annotations still there. */
/** A count's entry by its annotation object (objects are replaced, never changed). */
const countEntries = new WeakMap<PdfAnnotationObject, { sig: string; json: PdfJson }>();

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
    // A measurement summary made or changed here (M14-10): its scope.
    const summary = meta ? null : summaryOf(a);
    if (meta?.tool === 'count' && isStamp(a)) {
      // A Count (M14-07): kept from the last time while the object and its page are the same
      // (a sheet holds hundreds, and this runs on every change; a count needs no scale).
      const f = frameOf(docId, a.pageIndex);
      const sig = `${docId}|${String(f.width)},${String(f.height)},${String(f.originX)},${String(f.originY)}`;
      const hit = countEntries.get(a);
      if (hit?.sig === sig) {
        out.set(a.id, hit.json);
        continue;
      }
      const rest = { ...meta };
      delete rest.pts;
      const json = entryToPdf({
        meta: rest,
        fp: fingerprintOf(docId, a),
        curve: curveEntry(docId, a, meta),
      });
      countEntries.set(a, { sig, json });
      out.set(a.id, json);
    } else if (meta && isStampTool(meta.tool) && isStamp(a)) {
      // The points go in the entry's own keys, in user space.
      const rest = { ...meta };
      delete rest.pts;
      out.set(
        a.id,
        entryToPdf({ meta: rest, fp: fingerprintOf(docId, a), curve: curveEntry(docId, a, meta) }),
      );
    } else if (meta && isAreaTool(meta.tool) && meta.holes?.length) {
      // An area's cutouts go in the entry's own key, in user space (M14-06).
      const rest = { ...meta };
      delete rest.holes;
      const frame = frameOf(docId, a.pageIndex);
      out.set(
        a.id,
        entryToPdf({
          meta: rest,
          fp: fingerprintOf(docId, a),
          holes: meta.holes.map((h) => toUserSpace(h, frame)),
        }),
      );
    } else if (meta) out.set(a.id, entryToPdf({ meta, fp: fingerprintOf(docId, a) }));
    else if (summary) out.set(a.id, summaryToPdf(summary));
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
  const sig = JSON.stringify([...items].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const before =
    staged.get(key) ??
    JSON.stringify([...fileItems].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
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
