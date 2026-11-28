// The Measurements pane's data (M14-08, D-76, ADR-035): each measurement of a
// document read from the annotation plugin's state (already in memory; no
// document reading, rule 1) and the page scales the Work worker handed back
// (scaleStore), as the pane's model takes it (model/measureList.ts). Also the
// pane's own choices (This page or All pages) and the scale viewport selected
// from its Scales section, which the page outlines show (M14-09 edits it).
import type { PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../../app/store/documentStore';
import { format, t } from '../../../i18n';
import { measureEntry, type MeasureEntry } from '../../../model/measureList';
import { measurePoints } from '../../../model/measurement';
import { ratioLabel, type Scale } from '../../../model/scale';
import type { Box } from '../../../model/scaleViewport';
import { annotationCapability } from '../../annotate/selection';
import { goToPoint } from '../../view/controller';
import { choiceFor, metaFor, toolOf, type MeasureChoice } from '../measurements';
import { entriesOf, scaleStore } from '../scaleStore';
import { rectOfBox } from '../viewports';

/** Where a measurement's scale comes from, short: "Detail A · 1 : 5", "1 : 100", "No scale". */
export function whereText(c: MeasureChoice): string {
  const ratio = (s: Scale): string => ratioLabel(s, format);
  switch (c.kind) {
    case 'viewport':
      return t('viewport.item', { name: c.viewport.name, ratio: ratio(c.viewport.scale) });
    case 'page':
      return ratio(c.scale);
    case 'own':
      return t('measurements.ownScale', { ratio: ratio(c.scale) });
    case 'spanning':
      return format.list(c.viewports.map((n) => (n === '(page)' ? t('measure.pageArea') : n)));
    default:
      return t('measurements.noScale');
  }
}

/** The document's measurements as the pane lists them. */
export function measureEntries(
  docId: string,
  objects: readonly PdfAnnotationObject[],
): MeasureEntry[] {
  const out: MeasureEntry[] = [];
  for (const a of objects) {
    const tool = toolOf(docId, a);
    if (!tool) continue;
    const c = choiceFor(docId, a);
    const scale =
      c.kind === 'own'
        ? c.scale
        : c.kind === 'viewport'
          ? c.viewport.scale
          : c.kind === 'page'
            ? c.scale
            : null;
    out.push(
      measureEntry({
        id: a.id,
        page: a.pageIndex,
        tool,
        label: metaFor(docId, a)?.label,
        points: measurePoints(a),
        scale,
        spans: c.kind === 'spanning' ? c.viewports : null,
        where: whereText(c),
        at: a.rect.origin,
      }),
    );
  }
  return out;
}

/** A row's click or Enter: the page shows the measurement and selects it. */
export function showMeasurement(docId: string, id: string): void {
  const scope = annotationCapability()?.forDocument(docId);
  const a = scope?.getAnnotationById(id)?.object;
  if (!scope || !a) return;
  goToPoint(a.pageIndex, a.rect.origin.x, a.rect.origin.y);
  scope.selectAnnotation(a.pageIndex, a.id);
}

export type PaneScope = 'page' | 'all';

/** A scale viewport picked in the Scales section: its page and /VP index. */
export interface PickedViewport {
  docId: string;
  page: number;
  index: number;
}

interface PaneState {
  /** This page or All pages (Q16); the session's choice, for every document. */
  scope: PaneScope;
  /** The viewport the Scales section selected, drawn as selected on its page. */
  viewport: PickedViewport | null;
}

export const measurePaneStore = createStore<PaneState>()(() => ({
  scope: 'all',
  viewport: null,
}));

export function useMeasurePane<T>(selector: (s: PaneState) => T): T {
  return useStore(measurePaneStore, selector);
}

export function setPaneScope(scope: PaneScope): void {
  measurePaneStore.setState({ scope });
}

/** Shows a scale viewport on its page and selects it. */
export function showViewport(docId: string, page: number, index: number, bbox: Box): void {
  const r = rectOfBox(docId, page, bbox);
  goToPoint(page, r.left, r.top);
  measurePaneStore.setState({ viewport: { docId, page, index } });
}

export function clearPickedViewport(): void {
  if (measurePaneStore.getState().viewport) measurePaneStore.setState({ viewport: null });
}

// The pick goes when its page's viewports change (an index may then name
// another one), its document closes, or a click lands anywhere but the Scales
// section (M14-09 adds selecting on the page itself).
scaleStore.subscribe((s, prev) => {
  const v = measurePaneStore.getState().viewport;
  if (!v || s.docs === prev.docs) return;
  if (entriesOf(s, v.docId, v.page) !== entriesOf(prev, v.docId, v.page)) clearPickedViewport();
});
documentStore.subscribe((s) => {
  const v = measurePaneStore.getState().viewport;
  if (v && !(v.docId in s.docs)) clearPickedViewport();
});
if (typeof document !== 'undefined')
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!measurePaneStore.getState().viewport) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el?.closest('.mpane-scales')) clearPickedViewport();
    },
    true,
  );
