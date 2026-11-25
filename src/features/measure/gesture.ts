// The measurement being drawn (M14-02, D-78, ADR-035), for every handler the
// annotation plugin makes. The plugin makes new pointer handlers for a page
// whenever the zoom changes and whenever the page is laid out again (a scroll
// that takes it out of view and back, Previous / Next view), so the points
// live here (model/measureGesture.ts) and each new handler for the same page
// picks them up and shows the preview again. Only Esc, another tool, another
// tab or a click on another page ends a measurement; a page change says so.
import type { PluginRegistry } from '@embedpdf/core';
import { documentStore } from '../../app/store/documentStore';
import { t } from '../../i18n';
import {
  anchorOf,
  cancel as cancelGesture,
  click as clickGesture,
  finish as finishGesture,
  move as moveGesture,
  owns,
  type Gesture,
  type GestureKind,
  type Where,
} from '../../model/measureGesture';
import type { Pt } from '../../model/scale';
import { addDrawingProvider, type HandlerContext } from '../annotate/tools/drawTools';
import { showStatusToast } from '../snapshot/snapshot';
import { setLive } from './measureStore';
import { askScaleIfNeeded } from './noScaleQuestion';

/** How a tool shows, places and takes away its measurement. */
export interface Drawer {
  show(g: Gesture, ctx: HandlerContext): void;
  place(g: Gesture, ctx: HandlerContext): void;
  hide(ctx: HandlerContext): void;
}

interface Current {
  g: Gesture;
  /** The newest handler context of the gesture's page: its preview goes there. */
  ctx: HandlerContext;
  draw: Drawer;
}

let current: Current | null = null;

/** Before a new measurement starts on a page (the no-scale question, M14-02). */
type StartHook = (where: Where, kind: GestureKind, at: Pt) => void;
let onStart: StartHook | null = null;

export function setGestureStartHook(fn: StartHook | null): void {
  onStart = fn;
}

/** The gesture in progress (tests, the e2e probe). */
export function currentGesture(): Gesture | null {
  return current?.g ?? null;
}

function end(reason: 'page' | 'other' | 'cancel', c: Current): void {
  c.draw.hide(c.ctx);
  setLive(null);
  if (reason === 'page')
    showStatusToast(
      c.g.doc,
      t('measure.gesture.pageChanged', { page: String(c.g.page + 1) }),
      false,
    );
}

/** A handler was made for a page: it shows the measurement in progress there, if any. */
export function attachGesture(w: Where, ctx: HandlerContext, draw: Drawer): void {
  if (!current || !owns(current.g, w)) return;
  current = { ...current, ctx, draw };
  draw.show(current.g, ctx);
}

/** A click with a measuring tool. */
export function clickMeasure(
  w: Where,
  kind: GestureKind,
  at: Pt,
  ctx: HandlerContext,
  draw: Drawer,
  closeRadius = 0,
): void {
  const prev = current;
  if (!owns(prev?.g ?? null, w)) onStart?.(w, kind, at);
  const r = clickGesture(prev?.g ?? null, w, kind, at, closeRadius);
  if (r.ended && prev) end(r.ended.reason, prev);
  current = r.gesture ? { g: r.gesture, ctx, draw } : null;
  if (r.commit) {
    draw.hide(ctx);
    setLive(null);
    draw.place(r.commit, ctx);
  } else if (current) draw.show(current.g, ctx);
}

/** The pointer moved over a page with a measuring tool. */
export function moveMeasure(w: Where, at: Pt): void {
  if (!current || !owns(current.g, w)) return;
  current = { ...current, g: moveGesture(current.g, w, at) ?? current.g };
  current.draw.show(current.g, current.ctx);
}

/** Enter or a double-click: placed when it has enough points, else dropped. */
export function finishMeasure(): boolean {
  const c = current;
  if (!c) return false;
  current = null;
  const r = finishGesture(c.g);
  c.draw.hide(c.ctx);
  setLive(null);
  if (r.commit) c.draw.place(r.commit, c.ctx);
  return true;
}

/** Esc, another tool, another tab: dropped. */
export function cancelMeasure(): boolean {
  const c = current;
  if (!c) return false;
  current = cancelGesture();
  end('cancel', c);
  return true;
}

/** The last point placed on this page with this tool (Shift locks the angle from it). */
export function gestureAnchor(w: Where): Pt | null {
  return anchorOf(current?.g ?? null, w);
}

/** How many points are placed with this tool on this page (0: none in progress). */
export function currentPoints(w: Where): number {
  return current && owns(current.g, w) ? current.g.pts.length : 0;
}

/** True while a measurement is half drawn with this tool on this page. */
export function drawingOn(w: Where): boolean {
  return owns(current?.g ?? null, w);
}

// ---- which document a handler is for --------------------------------------------

let registering: string | null = null;

/**
 * The document whose page handlers the plugin is making right now. EmbedPDF's
 * handler context has the page but not the document; its registerPageHandlers
 * (pinned 2.15.x) makes them all in one synchronous call, so wrapping it tells
 * us. Outside that call (tests, other callers): the active document.
 */
export function registeringDoc(): string {
  return registering ?? documentStore.getState().activeId ?? '';
}

interface AnnotationInternals {
  registerPageHandlers?: (documentId: string, ...rest: unknown[]) => unknown;
}

/** Called once the plugin registry is up; returns the remover. */
export function installGestures(registry: PluginRegistry): () => void {
  const plugin = registry.getPlugin('annotation') as unknown as AnnotationInternals | null;
  const raw = plugin?.registerPageHandlers;
  let unwrap = (): void => undefined;
  if (plugin && typeof raw === 'function') {
    const wrapped = function (this: unknown, documentId: string, ...rest: unknown[]): unknown {
      const before = registering;
      registering = documentId;
      try {
        return raw.call(this, documentId, ...rest);
      } finally {
        registering = before;
      }
    };
    plugin.registerPageHandlers = wrapped;
    unwrap = () => {
      if (plugin.registerPageHandlers === wrapped) plugin.registerPageHandlers = raw;
    };
  }
  const offProvider = addDrawingProvider({ finish: finishMeasure, cancel: cancelMeasure });
  // The first measurement on a page with no scale asks once (noScaleQuestion.ts).
  setGestureStartHook(askScaleIfNeeded);
  return () => {
    unwrap();
    offProvider();
    setGestureStartHook(null);
    current = null;
  };
}
