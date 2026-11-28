// Measurements follow their geometry and scale (M3-16, §7.4, ADR-007, M3-Q2),
// each one standard markup since M14-03 (D-74, ADR-035 Amendment 1). On every
// create or edit of a measurement, its /Contents gets the value (with its
// label in front, Q27), its `measure` field what only Triya PDF keeps (tool,
// label, caption place and offset, an area's fill), its /Subj the tool's name,
// its /Rect room for the caption the Render worker draws into its appearance
// (workers/render/measureAppearance.ts); the object layer stages /IT,
// /Measure, /Cap, /CP and /CO, and the page's /PieceInfo (pageData.ts), for
// the single Ctrl+S revision. The value and caption join the edit's undo step
// (historyJoin.ts). A scale change re-values the page's measurements, in the
// scale change's own undo step, with a note (D-77, Q23).
//
// Which scale: a measurement from a file keeps its own /Measure (ADR-007 d3:
// what its author saw) unless that is the page's own scale, in which case it
// follows the page like ours do. A v1.1.0 measurement with a grouped FreeText
// label keeps it, as before, until "Update old measurements" (Q38).
import type { PluginRegistry } from '@embedpdf/core';
import {
  expandRect,
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  rectFromPoints,
  type LineEndings,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import {
  patching,
  type AnnotationCapability,
  type AnnotationScope,
} from '@embedpdf/plugin-annotation';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { format, msg, t, type MessageKey } from '../../i18n';
import { leaderOf, unionRect } from '../../model/dimension';
import {
  captionBoundsEP,
  captionText,
  metaOf,
  mirror,
  sameMeta,
  toolFromShape,
  type MeasureMeta,
  type MeasureTool,
} from '../../model/measureMarkup';
import {
  labelRect,
  measureKeys,
  measureKind,
  measurePoints,
  toUserSpace,
  valueText,
  type MeasureKind,
  type Rect,
} from '../../model/measurement';
import {
  measureFromPdf,
  ratioLabel,
  type Pt,
  type Scale,
  type ScaleChoice,
} from '../../model/scale';
import { touchedBy } from '../../model/measureEdit';
import { layoutOf, scaleChoice, scaleOfChoice } from '../../model/scaleViewport';
import { isReplaying, joinStep, outsideHistory } from '../annotate/historyJoin';
import { capability, hostStore, renderEngine } from '../view/host';
import { dimensionRect } from './dimensionTool';
import { fileMeta, stagePageData } from './pageData';
import { layoutFor, readEntries, scaleStore, takeScaleNote } from './scaleStore';
import { showScaleNote } from './scaleNote';
import { frameOf } from './viewports';

/** The tool's name as the markup's subject (/Subj), so other editors' lists say it (Q27). */
export const TOOL_SUBJECT: Record<MeasureTool, MessageKey> = {
  length: msg('measure.subject.length'),
  polylength: msg('measure.subject.polylength'),
  perimeter: msg('measure.subject.perimeter'),
  area: msg('measure.subject.area'),
};

const sameScale = (a: Scale | null, b: Scale | null): boolean =>
  !!a &&
  !!b &&
  a.unit === b.unit &&
  a.precision === b.precision &&
  Math.abs(a.real / a.paper - b.real / b.paper) <= 1e-6 * (b.real / b.paper);

/** The file's own data for a measurement (ADR-007 d3), if it came from the file. */
function fileMeasure(docId: string, page: number, id: string) {
  const d = scaleStore.getState().docs[docId];
  if (!d || typeof d === 'string') return null;
  const p = d.pages[page];
  const m = p?.measures.find((x) => x.id === id);
  return p && m ? { page: p, measure: m } : null;
}

/** The measurement kind: its intent, or (loaded from a file) the file's /IT. */
export function kindOf(docId: string, a: PdfAnnotationObject): MeasureKind | null {
  const k = measureKind(a);
  if (k) return k;
  const f = fileMeasure(docId, a.pageIndex, a.id);
  return f ? measureKind({ ...a, intent: f.measure.intent }) : null;
}

/** Where a measurement's scale comes from (§7.4), or its own from the file (ADR-007 d3). */
export type MeasureChoice = ScaleChoice | { kind: 'own'; scale: Scale };

/** The scale choice for a measurement: its viewport, the page, spanning, uncalibrated. */
export function choiceFor(docId: string, a: PdfAnnotationObject): MeasureChoice {
  const pts = toUserSpace(measurePoints(a), frameOf(docId, a.pageIndex));
  const now = scaleChoice(pts, layoutFor(scaleStore.getState(), docId, a.pageIndex));
  const f = fileMeasure(docId, a.pageIndex, a.id);
  if (!f) return now;
  const own = measureFromPdf(f.measure.measure);
  const vp = Array.isArray(f.page.vp) ? f.page.vp : [];
  const inFile = scaleChoice(pts, layoutOf(readEntries(vp), f.page.mediaBox));
  // A file's measurement valued at another scale than its place had: keep its own.
  return own && !sameScale(own, scaleOfChoice(inFile)) ? { kind: 'own', scale: own } : now;
}

/** The scale a measurement is valued in; null = uncalibrated. */
export function scaleForMeasurement(docId: string, a: PdfAnnotationObject): Scale | null {
  const c = choiceFor(docId, a);
  return c.kind === 'own' ? c.scale : scaleOfChoice(c);
}

/** "Scale: Detail A, 1 : 5", "Spans Detail A and (page)…" for the Properties pane. */
export function choiceText(c: MeasureChoice): string {
  const ratio = (s: Scale): string => ratioLabel(s, format);
  switch (c.kind) {
    case 'viewport':
      return t('measure.source.viewport', {
        name: c.viewport.name,
        ratio: ratio(c.viewport.scale),
      });
    case 'page':
      return t('measure.source.page', { ratio: ratio(c.scale) });
    case 'own':
      return t('measure.source.own', { ratio: ratio(c.scale) });
    case 'spanning':
      return t('measure.source.spanning', {
        names: format.list(c.viewports.map((n) => (n === '(page)' ? t('measure.pageArea') : n))),
      });
    default:
      return t('measure.source.uncalibrated');
  }
}

/** The value as shown and written: "20.00 m", or "200.0 mm (uncalibrated)". */
export function measurementText(kind: MeasureKind, a: PdfAnnotationObject, s: Scale | null) {
  const v = valueText(kind, measurePoints(a), s, format);
  return v.calibrated ? v.value : t('measure.uncalibrated', { value: v.value });
}

/** The measurement's grouped label (a v1.1.0 measurement's FreeText), if it has one. */
export function labelOf(scope: AnnotationScope, id: string): PdfAnnotationObject | null {
  for (const ta of scope.getAnnotations()) {
    const o = ta.object;
    if (
      o.type === PdfAnnotationSubtype.FREETEXT &&
      o.inReplyToId === id &&
      o.replyType === PdfAnnotationReplyType.Group
    )
      return o;
  }
  return null;
}

/**
 * A measurement's tool and what only Triya PDF keeps about it (M14-03, D-74):
 * its own `measure` field (made or edited in this session), else the file's
 * Triya data, else its standard data (ADR-035 Amendment 1 decision 4). Null
 * for a v1.1.0 measurement that still has its grouped label (it keeps that
 * label until "Update old measurements", Q38), and for what isn't one.
 */
export function metaFor(
  docId: string,
  a: PdfAnnotationObject,
  scope?: AnnotationScope,
): MeasureMeta | null {
  const own = metaOf(a);
  if (own) return own;
  const kind = kindOf(docId, a);
  if (!kind) return null;
  if (scope && labelOf(scope, a.id)) return null;
  const file = fileMeta(docId, a);
  if (file) return file;
  const tool = toolFromShape(kind, toUserSpace(measurePoints(a), frameOf(docId, a.pageIndex)));
  const cp = fileMeasure(docId, a.pageIndex, a.id)?.measure.cp;
  return tool === 'length' && cp === 'Inline' ? { tool, cap: 'inline' } : { tool };
}

/** The measuring tool a measurement was made with (null: not one). */
export function toolOf(docId: string, a: PdfAnnotationObject): MeasureTool | null {
  const own = metaOf(a);
  if (own) return own.tool;
  const kind = kindOf(docId, a);
  if (!kind) return null;
  return fileMeta(docId, a)?.tool ?? toolFromShape(kind, measurePoints(a).map(mirror));
}

/** "Slab S1: 42.5 m²", or the value alone (Q27). */
export const sheetText = (label: string | undefined, value: string): string =>
  captionText(label, value, (l, v) => t('measure.caption.labelled', { label: l, value: v }));

/** What was last staged per annotation (so an edit that keeps the scale stages nothing). */
const staged = new Map<string, string>();

async function stage(
  docId: string,
  a: PdfAnnotationObject,
  kind: MeasureKind,
  s: Scale | null,
  meta: MeasureMeta | null,
) {
  const keys = measureKeys(
    kind,
    s,
    meta
      ? {
          place: meta.cap ?? 'top',
          offset: meta.capOffset ?? null,
          ...(a.type === PdfAnnotationSubtype.LINE ? { leader: leaderOf(a) } : {}),
        }
      : {},
  );
  const key = `${docId}/${a.id}`;
  const sig = JSON.stringify(keys);
  if (staged.get(key) === sig) return;
  staged.set(key, sig);
  try {
    await renderEngine().rpc.call('stageObjects', {
      docId,
      target: { page: a.pageIndex, annot: a.id },
      set: keys.set,
      ...(keys.remove.length ? { remove: keys.remove } : {}),
    }).promise;
    documentStore.getState().markDirty(docId);
  } catch (err) {
    staged.delete(key);
    recordError('measure.stage', err);
  }
}

function pageSize(registry: PluginRegistry, docId: string, page: number) {
  const p = registry.getStore().getState().core.documents[docId]?.document?.pages[page];
  return p?.size ?? { width: 612, height: 792 };
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
const sameRect = (r: Rect, q: Rect): boolean =>
  near(r.origin.x, q.origin.x) &&
  near(r.origin.y, q.origin.y) &&
  near(r.size.width, q.size.width) &&
  near(r.size.height, q.size.height);

/** The rect that holds a measurement's geometry (with its line endings and leader lines). */
function geometryRect(a: PdfAnnotationObject): Rect {
  const o = a as unknown as {
    strokeWidth?: number;
    lineEndings?: LineEndings;
    linePoints?: { start: Pt; end: Pt };
    vertices?: Pt[];
  };
  const w = o.strokeWidth ?? 1;
  if (a.type === PdfAnnotationSubtype.LINE && o.linePoints)
    return dimensionRect(o.linePoints.start, o.linePoints.end, leaderOf(a), w, o.lineEndings);
  const pts = o.vertices ?? [];
  if (pts.length === 0) return a.rect;
  return a.type === PdfAnnotationSubtype.POLYGON
    ? expandRect(rectFromPoints(pts), w / 2)
    : patching.lineRectWithEndings(pts, w, o.lineEndings);
}

/** The rect that holds a measurement and its caption (estimated width, measureMarkup.ts). */
export function measureRect(a: PdfAnnotationObject, meta: MeasureMeta, text: string): Rect {
  const geo = geometryRect(a);
  const box = captionBoundsEP(meta, measurePoints(a), leaderOf(a), text);
  if (!box) return geo;
  return unionRect(geo, {
    origin: { x: box[0], y: box[1] },
    size: { width: box[2] - box[0], height: box[3] - box[1] },
  });
}

/** Measurements being refreshed: their own value update fires an event too. */
const busy = new Set<string>();

/** Brings a measurement's value, caption, label and keys up to date. */
function refresh(registry: PluginRegistry, docId: string, id: string, how: 'join' | 'outside') {
  const key = `${docId}/${id}`;
  if (busy.has(key)) return;
  const scope = capability<AnnotationCapability>(registry, 'annotation').forDocument(docId);
  const a = scope.getAnnotationById(id)?.object;
  if (!a) return;
  const kind = kindOf(docId, a);
  if (!kind) return;
  const s = scaleForMeasurement(docId, a);
  const value = measurementText(kind, a, s);
  const found = metaFor(docId, a, scope);
  let apply: () => void;
  if (found) {
    // An area's fill comes in as the plugin's fill colour (the tool's style, a
    // pasted style) and moves into `measure` (no /IC, ADR-035 Amendment 1).
    const color = (a as { color?: string }).color;
    const meta =
      a.type === PdfAnnotationSubtype.POLYGON && color && color !== 'transparent'
        ? { ...found, fill: color }
        : found;
    // One markup (M14-03, D-74): the value (and label) drawn in its own appearance.
    const text = sheetText(meta.label, value);
    const rect = measureRect(a, meta, text);
    const subject = t(TOOL_SUBJECT[meta.tool]);
    const patch: Record<string, unknown> = {};
    if (a.contents !== text) patch['contents'] = text;
    if (!sameMeta(metaOf(a), meta)) patch['measure'] = meta;
    if (a.subject !== subject) patch['subject'] = subject;
    if (!sameRect(a.rect, rect)) patch['rect'] = rect;
    // An area's fill lives in `measure` (no /IC, ADR-035 Amendment 1).
    if (
      a.type === PdfAnnotationSubtype.POLYGON &&
      (a as { color?: string }).color !== 'transparent'
    )
      patch['color'] = 'transparent';
    apply = () => {
      if (Object.keys(patch).length) scope.updateAnnotation(a.pageIndex, a.id, patch);
    };
  } else {
    // A v1.1.0 measurement keeps its grouped label until it is updated (Q38).
    const label = labelOf(scope, a.id);
    const rect = labelRect(
      kind,
      measurePoints(a),
      value,
      pageSize(registry, docId, a.pageIndex),
      undefined,
      leaderOf(a),
    );
    apply = () => {
      if (a.contents !== value) scope.updateAnnotation(a.pageIndex, a.id, { contents: value });
      if (
        label &&
        (label.contents !== value ||
          !near(label.rect.origin.x, rect.origin.x) ||
          !near(label.rect.origin.y, rect.origin.y) ||
          !near(label.rect.size.width, rect.size.width))
      )
        scope.updateAnnotation(label.pageIndex, label.id, { contents: value, rect });
    };
  }
  busy.add(key);
  try {
    if (how === 'join') joinStep(apply);
    else {
      outsideHistory(apply);
      // The plugin commits on history changes; this change made none.
      scope.commit();
    }
  } finally {
    busy.delete(key);
  }
  void stage(docId, a, kind, s, found);
  stagePageData(docId, a.pageIndex, () => pageAnnots(scope, a.pageIndex));
}

const pageAnnots = (scope: AnnotationScope, page: number): PdfAnnotationObject[] =>
  scope.getAnnotations({ pageIndex: page }).map((ta) => ta.object);

/**
 * Changes what Triya PDF keeps about a measurement (its label, caption place,
 * caption offset, fill: the Properties pane, a dragged caption), as one undo
 * step; its caption and keys follow.
 */
export function setMeasureMeta(
  docId: string,
  id: string,
  change: { [K in keyof MeasureMeta]?: MeasureMeta[K] | undefined },
): void {
  const registry = hostStore.getState().registry;
  if (!registry) return;
  const scope = capability<AnnotationCapability>(registry, 'annotation').forDocument(docId);
  const a = scope.getAnnotationById(id)?.object;
  if (!a) return;
  const meta = metaFor(docId, a, scope);
  if (!meta) return;
  const next = metaOf({ measure: { ...meta, ...change } });
  if (!next || sameMeta(next, meta)) return;
  scope.updateAnnotation(a.pageIndex, a.id, { measure: next } as Partial<PdfAnnotationObject>);
}

/** The page's measurements valued by its scales (not a file's own other scale). */
function followers(registry: PluginRegistry, docId: string, page: number): string[] {
  const scope = capability<AnnotationCapability>(registry, 'annotation').forDocument(docId);
  return scope
    .getAnnotations({ pageIndex: page })
    .map((ta) => ta.object)
    .filter((o) => kindOf(docId, o) && choiceFor(docId, o).kind !== 'own')
    .map((o) => o.id);
}

/** Called once the plugin registry is up (DocumentHost); returns the unsubscribe. */
export function installMeasurements(registry: PluginRegistry): () => void {
  let cap: AnnotationCapability;
  try {
    cap = capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return () => undefined;
  }
  const offEvents = cap.onAnnotationEvent((e) => {
    if (e.type === 'delete') {
      if (e.committed) return;
      // A removed measurement's Triya data goes with it (pageData.ts).
      if (kindOf(e.documentId, e.annotation)) {
        const scope = cap.forDocument(e.documentId);
        const page = e.annotation.pageIndex;
        stagePageData(e.documentId, page, () => pageAnnots(scope, page));
      }
      return;
    }
    if (e.type !== 'create' && e.type !== 'update') return;
    if (!kindOf(e.documentId, e.annotation)) return;
    const id = e.annotation.id;
    // Undo/redo restores the value and label with the geometry; a scale changed
    // since then is caught up afterwards, outside history.
    if (isReplaying())
      queueMicrotask(() => {
        refresh(registry, e.documentId, id, 'outside');
      });
    else refresh(registry, e.documentId, id, 'join');
  });

  // A selected label selects its measurement alone (vertex handles stay).
  const offState = cap.onStateChange(() => {
    const docId = documentStore.getState().activeId;
    if (!docId) return;
    const scope = cap.forDocument(docId);
    const sel = scope.getSelectedAnnotations().map((ta) => ta.object);
    if (sel.length < 2) return;
    const ids = new Set(sel.map((o) => o.id));
    const keep = sel.filter(
      (o) =>
        !(
          o.type === PdfAnnotationSubtype.FREETEXT &&
          o.replyType === PdfAnnotationReplyType.Group &&
          o.inReplyToId &&
          ids.has(o.inReplyToId) &&
          kindOf(docId, sel.find((p) => p.id === o.inReplyToId) ?? o)
        ),
    );
    if (keep.length !== sel.length) scope.setSelection(keep.map((o) => o.id));
  });

  // A page's scale set or changed (D-77, Q23): its measurements follow. The
  // scale change is the undo step (scaleStore.ts changeScales), so undo and
  // redo bring the values back with it; a change the person made says how
  // many measurements it updated, with Undo (scaleNote.ts).
  const offScales = scaleStore.subscribe((s, prev) => {
    for (const [docId, d] of Object.entries(s.docs)) {
      const p = prev.docs[docId];
      if (typeof d === 'string') continue;
      const before = p && typeof p !== 'string' ? p : null;
      if (before?.vp === d.vp && before.pages === d.pages) continue;
      const pages = new Set<number>(
        Object.keys(d.vp)
          .map(Number)
          .filter((n) => before?.vp[n] !== d.vp[n]),
      );
      const note = pages.size > 0 && takeScaleNote(docId);
      const scope = cap.forDocument(docId);
      let touched = 0;
      for (const page of pages) {
        const ids = followers(registry, docId, page);
        if (note) {
          const frame = frameOf(docId, page);
          const items = ids.flatMap((id) => {
            const o = scope.getAnnotationById(id)?.object;
            return o ? [{ id, pts: toUserSpace(measurePoints(o), frame) }] : [];
          });
          touched += touchedBy(
            items,
            layoutFor(prev, docId, page),
            layoutFor(s, docId, page),
          ).length;
        }
        for (const id of ids) refresh(registry, docId, id, 'outside');
      }
      if (touched > 0) showScaleNote(docId, touched);
    }
  });

  return () => {
    offEvents();
    offState();
    offScales();
  };
}
