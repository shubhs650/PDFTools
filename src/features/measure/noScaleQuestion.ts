// The no-scale question (M14-02, D-77, ADR-035, Q29): the first measurement of
// a size on a page with no scale asks once: Set scale, Calibrate, or Measure at
// paper size. It never blocks the click: the measurement starts (uncalibrated)
// and the question waits in a card over the document, so a zoom or a pan in the
// meantime keeps the points (D-78). The answer is kept for that page for the
// session; a scale it sets (paper size is 1:1) is the document's scale data,
// saved with the next Ctrl+S. Angle and Count (later tools) never ask.
import { createStore, useStore } from 'zustand';
import { appStore, type Tool } from '../../app/store/appStore';
import { t } from '../../i18n';
import type { GestureKind, Where } from '../../model/measureGesture';
import { toUserSpace } from '../../model/measurement';
import type { Pt } from '../../model/scale';
import { scaleChoice } from '../../model/scaleViewport';
import { showStatusToast } from '../snapshot/snapshot';
import { startPicking } from './calibrate';
import {
  applyScale,
  layoutFor,
  loadDefaults,
  loadScales,
  openScaleDialog,
  scaleStore,
} from './scaleStore';
import { frameOf } from './viewports';

/** Measurements of a size: they need a scale. */
const SIZED: ReadonlySet<GestureKind> = new Set([
  'distance',
  'polylength',
  'perimeter',
  'area',
  // A Radius or Diameter is a length; an Angle needs no scale (M14-05, Q9).
  'circle2',
  'circle3',
]);

interface PromptState {
  /** Pages asked already, per document ("docId/page"), for the session. */
  asked: ReadonlySet<string>;
  /** The question on screen. */
  open: { docId: string; page: number; tool: Tool } | null;
}

export const scalePromptStore = createStore<PromptState>()(() => ({
  asked: new Set(),
  open: null,
}));

export function useScalePrompt<T>(selector: (s: PromptState) => T): T {
  return useStore(scalePromptStore, selector);
}

const keyOf = (docId: string, page: number): string => `${docId}/${String(page)}`;

/**
 * True when a measurement starting at `at` (EmbedPDF page points) should ask:
 * a sized measurement, the page's scales are known, the page was not asked
 * yet, and the point has no scale (no page scale, no detail viewport there).
 */
export function needsScale(w: Where, kind: GestureKind, at: Pt): boolean {
  if (!SIZED.has(kind)) return false;
  if (scalePromptStore.getState().asked.has(keyOf(w.doc, w.page))) return false;
  const st = scaleStore.getState();
  const d = st.docs[w.doc];
  if (!d || typeof d === 'string') {
    // Not read yet: read now; the next measurement asks if it still has none.
    void loadScales(w.doc);
    return false;
  }
  const pts = toUserSpace([at], frameOf(w.doc, w.page));
  return scaleChoice(pts, layoutFor(st, w.doc, w.page)).kind === 'uncalibrated';
}

/** A measurement starts on a page (gesture.ts): ask when the page has no scale. */
export function askScaleIfNeeded(w: Where, kind: GestureKind, at: Pt): void {
  if (!needsScale(w, kind, at)) return;
  scalePromptStore.setState((s) => ({
    asked: new Set(s.asked).add(keyOf(w.doc, w.page)),
    open: { docId: w.doc, page: w.page, tool: w.tool as Tool },
  }));
}

export type ScaleAnswer = 'setScale' | 'calibrate' | 'paperSize' | 'close';

/** The answer: the question goes and the page is not asked again this session. */
export async function answerScale(answer: ScaleAnswer): Promise<void> {
  const q = scalePromptStore.getState().open;
  scalePromptStore.setState({ open: null });
  if (!q) return;
  if (answer === 'setScale') openScaleDialog('setScale', q.page);
  else if (answer === 'calibrate') {
    // Picking ends the measurement in progress (another tool); its tool comes back after.
    scaleStore.setState({ target: q.page });
    void loadDefaults();
    startPicking(appStore.getState().tool === q.tool ? q.tool : undefined);
  } else if (answer === 'paperSize') {
    await loadDefaults();
    const { unit, precision, ftIn } = scaleStore.getState().defaults;
    // Paper size: 1 : 1 in the person's usual unit (mm by default).
    const ok = await applyScale(q.docId, [q.page], {
      paper: 1,
      real: 1,
      unit,
      precision,
      ...(ftIn ? { ftIn } : {}),
    });
    if (ok)
      showStatusToast(q.docId, t('measure.noScale.paperDone', { page: String(q.page + 1) }), true);
  }
}

/**
 * Another tool before an answer: the question goes, and the page asks again
 * at its next measurement (it was not answered).
 */
appStore.subscribe((s, prev) => {
  const q = scalePromptStore.getState().open;
  if (!q || s.tool === prev.tool || s.tool === q.tool) return;
  scalePromptStore.setState((st) => {
    const asked = new Set(st.asked);
    asked.delete(keyOf(q.docId, q.page));
    return { asked, open: null };
  });
});

/** Tests. */
export function resetScalePrompt(): void {
  scalePromptStore.setState({ asked: new Set(), open: null });
}
