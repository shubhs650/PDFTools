import { useEffect, useState, type RefObject } from 'react';
import { zoomStepAt, zoomToArea } from './controller';
import { recordJump } from './viewHistory';
import { areaBetween, isAreaDrag, type Area, type Point } from './zoomAreaModel';

/**
 * Zoom to Area on the view (M11-08·O4, ADR-028): while the tool is on (or Z
 * is held with Hand), a drag anywhere in the view draws a rectangle that fills
 * the window when the button is released; a click zooms in one step at that
 * point and Alt+click zooms out. Previous View (Alt+Left) goes back.
 *
 * Native capture listeners on the scroller: they run before the pages' own
 * handling (text selection, comments, links, form fields), which a React
 * handler could not stop. The wheel, the scroll bars and the right button
 * (the page menu) keep their usual jobs.
 */
export function ZoomAreaLayer({ host }: { host: RefObject<HTMLDivElement | null> }) {
  // The rectangle being drawn, in client pixels.
  const [draft, setDraft] = useState<Area | null>(null);

  useEffect(() => {
    const vp = host.current?.querySelector<HTMLElement>('.viewport');
    if (!vp) return;
    let press: (Point & { id: number }) | null = null;
    /** The pointer in viewport pixels: from the scroller's visible top-left. */
    const local = (e: PointerEvent): Point => {
      const r = vp.getBoundingClientRect();
      return { x: e.clientX - r.left - vp.clientLeft, y: e.clientY - r.top - vp.clientTop };
    };
    const toClient = (a: Area): Area => {
      const r = vp.getBoundingClientRect();
      return { ...a, left: a.left + r.left + vp.clientLeft, top: a.top + r.top + vp.clientTop };
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const p = local(e);
      // On a scroll bar: the browser's.
      if (p.x < 0 || p.y < 0 || p.x > vp.clientWidth || p.y > vp.clientHeight) return;
      e.preventDefault();
      e.stopPropagation();
      // The document takes focus, so Esc ends the tool and Z's release is heard.
      vp.focus({ preventScroll: true });
      vp.setPointerCapture(e.pointerId);
      press = { ...p, id: e.pointerId };
      setDraft(null);
    };
    const move = (e: PointerEvent): void => {
      if (press?.id !== e.pointerId) return;
      e.stopPropagation();
      const area = areaBetween(press, local(e));
      setDraft(isAreaDrag(area) ? toClient(area) : null);
    };
    const up = (e: PointerEvent): void => {
      if (press?.id !== e.pointerId) return;
      e.stopPropagation();
      const start = press;
      press = null;
      setDraft(null);
      const area = areaBetween(start, local(e));
      if (isAreaDrag(area)) {
        recordJump();
        zoomToArea(area);
      } else {
        zoomStepAt(e.altKey ? -1 : 1, { vx: start.x, vy: start.y });
      }
    };
    const cancel = (e: PointerEvent): void => {
      if (press?.id !== e.pointerId) return;
      press = null;
      setDraft(null);
    };
    // The click that follows a press is the tool's too: no link is followed,
    // no field or check box changes.
    const swallow = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const opts = { capture: true };
    vp.addEventListener('pointerdown', down, opts);
    vp.addEventListener('pointermove', move, opts);
    vp.addEventListener('pointerup', up, opts);
    vp.addEventListener('pointercancel', cancel, opts);
    vp.addEventListener('click', swallow, opts);
    vp.addEventListener('dblclick', swallow, opts);
    return () => {
      vp.removeEventListener('pointerdown', down, opts);
      vp.removeEventListener('pointermove', move, opts);
      vp.removeEventListener('pointerup', up, opts);
      vp.removeEventListener('pointercancel', cancel, opts);
      vp.removeEventListener('click', swallow, opts);
      vp.removeEventListener('dblclick', swallow, opts);
    };
  }, [host]);

  if (!draft) return null;
  return (
    <div
      className="zoom-area-rect"
      data-testid="zoom-area-rect"
      aria-hidden="true"
      style={{
        left: `${String(draft.left)}px`,
        top: `${String(draft.top)}px`,
        width: `${String(draft.width)}px`,
        height: `${String(draft.height)}px`,
      }}
    />
  );
}
