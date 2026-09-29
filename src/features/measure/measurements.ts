// Measurements follow their geometry and scale (M3-16, §7.4, ADR-007, M3-Q2).
// On every create or edit of a measurement, its /Contents gets the formatted
// value, its grouped FreeText label (/IRT + /RT /Group) the same text and a
// place next to it, and the object layer stages /IT, /Measure, /Cap and /CP
// for the single Ctrl+S revision. The value and label join the edit's undo
// step (historyJoin.ts). A scale change re-values the page's measurements.
//
// Which scale: a measurement from a file keeps its own /Measure (ADR-007 d3:
// what its author saw) unless that is the page's own scale, in which case it
// follows the page like ours do. The label is derived: selecting it selects
// the measurement, whose vertices stay editable (a selected group has none).
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  uuidV4,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type { AnnotationCapability, AnnotationScope } from '@embedpdf/plugin-annotation';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { format, t } from '../../i18n';
import {
  LABEL_FONT_SIZE,
  LABEL,
  labelRect,
  measureKeys,
  measureKind,
  measurePoints,
  valueText,
  type MeasureKind,
} from '../../model/measurement';
import { measureFromPdf, ratioLabel, type ScaleChoice, type Scale } from '../../model/scale';
import { layoutOf, scaleChoice, scaleOfChoice } from '../../model/scaleViewport';
import { toUserSpace } from '../../model/measurement';
import { isReplaying, joinStep, outsideHistory } from '../annotate/historyJoin';
import { capability, renderEngine } from '../view/host';
import { layoutFor, readEntries, scaleStore } from './scaleStore';
import { frameOf } from './viewports';

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

/** The measurement's grouped label, if it has one. */
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

/** What was last staged per annotation (so an edit that keeps the scale stages nothing). */
const staged = new Map<string, string>();

async function stage(docId: string, a: PdfAnnotationObject, kind: MeasureKind, s: Scale | null) {
  const keys = measureKeys(kind, s);
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

/** Measurements being refreshed: their own value update fires an event too. */
const busy = new Set<string>();

/** Brings a measurement's value, label and keys up to date. */
function refresh(registry: PluginRegistry, docId: string, id: string, how: 'join' | 'outside') {
  const key = `${docId}/${id}`;
  if (busy.has(key)) return;
  const scope = capability<AnnotationCapability>(registry, 'annotation').forDocument(docId);
  const a = scope.getAnnotationById(id)?.object;
  if (!a) return;
  const kind = kindOf(docId, a);
  if (!kind) return;
  const s = scaleForMeasurement(docId, a);
  const text = measurementText(kind, a, s);
  const label = LABEL.freeText ? labelOf(scope, a.id) : null;
  const rect = labelRect(kind, measurePoints(a), text, pageSize(registry, docId, a.pageIndex));
  const apply = (): void => {
    if (a.contents !== text) scope.updateAnnotation(a.pageIndex, a.id, { contents: text });
    if (!LABEL.freeText) return;
    if (!label) {
      const color = (a as { strokeColor?: string }).strokeColor ?? '#E44234';
      scope.createAnnotation(a.pageIndex, {
        type: PdfAnnotationSubtype.FREETEXT,
        id: uuidV4(),
        pageIndex: a.pageIndex,
        rect,
        contents: text,
        fontFamily: PdfStandardFont.Helvetica,
        fontSize: LABEL_FONT_SIZE,
        fontColor: color,
        textAlign: PdfTextAlignment.Center,
        verticalAlign: PdfVerticalAlignment.Middle,
        opacity: 1,
        color: 'transparent',
        flags: ['print'],
        created: new Date(),
        inReplyToId: a.id,
        replyType: PdfAnnotationReplyType.Group,
      });
    } else if (
      label.contents !== text ||
      !near(label.rect.origin.x, rect.origin.x) ||
      !near(label.rect.origin.y, rect.origin.y) ||
      !near(label.rect.size.width, rect.size.width)
    ) {
      scope.updateAnnotation(label.pageIndex, label.id, { contents: text, rect });
    }
  };
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
  void stage(docId, a, kind, s);
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
    if ((e.type !== 'create' && e.type !== 'update') || e.committed) return;
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

  // A page's scale set (or changed): its measurements re-valued, not undoable.
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
      for (const page of pages)
        for (const id of followers(registry, docId, page)) refresh(registry, docId, id, 'outside');
    }
  });

  return () => {
    offEvents();
    offState();
    offScales();
  };
}
