// Drag to reorder the file tabs (M11-04, ADR-028 D-50): one press on a tab, from
// pointerdown to pointerup. Mouse and pen lift the tab after a 4 px move; on touch,
// holding the tab still for 300 ms lifts it and moving first scrolls the row (the tabs
// take every touch gesture, `touch-action: none`). The lifted tab follows the pointer
// along the row, the others slide out of its way (CSS transitions on `transform`),
// the row scrolls near its ends, Esc puts everything back. Positions are measured once
// at the lift; each move only sets transforms (no layout per frame, rule 1).
import {
  clampLeft,
  DRAG_THRESHOLD_PX,
  dropIndex,
  edgeSpeed,
  shiftFor,
  TOUCH_HOLD_MS,
  type TabSlot,
} from './tabDrag';

/** A touch that moves this far before the hold time scrolls the row instead. */
const TOUCH_SLOP_PX = 8;

/** What the strip gives a drag: its elements, and what to do at each stage. */
export interface TabDragHost {
  /** The scrolling row (`.tab-list`). */
  list(): HTMLElement | null;
  /** A tab's two elements (the tab and its ×), in that order. */
  parts(id: string): HTMLElement[];
  /** The + at the row's end: the row scrolls before reaching it. */
  addButton(): HTMLElement | null;
  /** The tab order now. */
  order(): readonly string[];
  /** The tab lifted (hide the hover card, show the lift). */
  lift(id: string): void;
  /** The drag ended, dropped or put back. */
  end(): void;
  /** Dropped at a new place: commit the order (animated from where it is now). */
  drop(id: string, to: number): void;
  /** Make the dragged tab the selected one. */
  activate(id: string): void;
  /** The click that follows this press is not a click on the tab. */
  swallowClick(): void;
}

type Phase = 'pressed' | 'panning' | 'dragging' | 'done';

let active: { cancel(): void } | null = null;

/** Is a tab being dragged right now (the hover card stays shut)? */
export const isTabDragging = (): boolean => active !== null;

const setX = (els: readonly HTMLElement[], x: number): void => {
  for (const el of els) el.style.transform = x ? `translateX(${String(x)}px)` : '';
};

/**
 * Starts tracking a press on tab `id` (the primary button or a touch). Call from the
 * tab's pointerdown with the element pressed (it takes the pointer capture); the press
 * may become a drag, a scroll (touch) or stay a click.
 */
export function beginTabPress(
  host: TabDragHost,
  e: PointerEvent,
  target: HTMLElement,
  id: string,
): void {
  if (!e.isPrimary || (e.pointerType !== 'touch' && e.button !== 0)) return;
  active?.cancel();
  const row = host.list();
  if (!row) return;
  const list: HTMLElement = row;
  const touch = e.pointerType === 'touch';
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  let lastX = startX;
  let phase: Phase = 'pressed';
  let panX = 0;
  let panScroll = 0;

  // Measured at the lift.
  let ids: string[] = [];
  let els: HTMLElement[][] = [];
  let slots: TabSlot[] = [];
  let from = -1;
  let to = -1;
  let grab = 0;
  let rowStart = 0;
  let rowEnd = 0;
  let listLeft = 0;
  let raf = 0;
  let hold: ReturnType<typeof setTimeout> | undefined;

  try {
    target.setPointerCapture(pointerId);
  } catch {
    // A synthetic or already-released pointer: the window listeners still follow it.
  }

  const contentX = (x: number): number => x - listLeft + list.scrollLeft;

  const place = (): void => {
    const slot = slots[from];
    if (!slot) return;
    const left = clampLeft(slots, from, contentX(lastX) - grab);
    setX(els[from] ?? [], left - slot.left);
    const next = dropIndex(slots, from, left);
    if (next === to) return;
    to = next;
    els.forEach((parts, j) => {
      if (j !== from) setX(parts, shiftFor(j, from, to, slot.width));
    });
  };

  const tick = (): void => {
    raf = 0;
    if (phase !== 'dragging' || list.scrollWidth <= list.clientWidth) return;
    const v = edgeSpeed(lastX, rowStart, rowEnd);
    if (v === 0) return;
    const before = list.scrollLeft;
    list.scrollLeft = before + v;
    if (list.scrollLeft === before) return; // at the end
    place();
    raf = requestAnimationFrame(tick);
  };

  const lift = (): void => {
    ids = [...host.order()];
    from = ids.indexOf(id);
    els = ids.map((i) => host.parts(i));
    if (from < 0 || els.some((p) => p.length === 0)) {
      finish(false);
      return;
    }
    // Any slide still running from an earlier move ends now, so the measures are true.
    for (const parts of els)
      for (const el of parts) {
        el.style.transition = 'none';
        el.style.transform = '';
      }
    const rect = list.getBoundingClientRect();
    listLeft = rect.left;
    const lefts = els.map((p) => (p[0]?.getBoundingClientRect().left ?? 0) - listLeft);
    const lastParts = els[els.length - 1] ?? [];
    const lastEl = lastParts[lastParts.length - 1];
    const lastRight = lastEl
      ? lastEl.getBoundingClientRect().right -
        listLeft +
        (parseFloat(getComputedStyle(lastEl).marginRight) || 0)
      : 0;
    slots = lefts.map((l, j) => ({
      left: l + list.scrollLeft,
      width: (lefts[j + 1] ?? lastRight) - l,
    }));
    const add = host.addButton()?.getBoundingClientRect();
    rowStart = rect.left;
    rowEnd = add && add.width > 0 ? Math.min(rect.right, add.left) : rect.right;
    // Where the tab was grabbed: it moves with the pointer from the press on.
    grab = contentX(touch ? lastX : startX) - (slots[from]?.left ?? 0);
    to = from;
    // Others slide (their CSS transition); the lifted tab follows the pointer exactly.
    // (Reading a box applies the cleared transforms first, so nothing slides from them.)
    list.getBoundingClientRect();
    els.forEach((parts, j) => {
      for (const el of parts) el.style.transition = j === from ? 'none' : '';
    });
    phase = 'dragging';
    host.lift(id);
    place();
  };

  const putBack = (): void => {
    for (const parts of els)
      for (const el of parts) {
        el.style.transition = '';
        el.style.transform = '';
      }
  };

  function finish(drop: boolean): void {
    const was = phase;
    phase = 'done';
    clearTimeout(hold);
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    list.removeEventListener('scroll', onScroll);
    target.removeEventListener('lostpointercapture', onCancel);
    if (active === session) active = null;
    if (was === 'panning') host.swallowClick();
    if (was !== 'dragging') return;
    host.swallowClick();
    // The order changed under the drag (a file closed): nothing to drop into.
    const same = ids.join('\n') === host.order().join('\n');
    host.end();
    if (drop && same && to !== from) host.drop(id, to);
    else putBack();
    if (drop) host.activate(id);
  }

  function onMove(ev: PointerEvent): void {
    if (ev.pointerId !== pointerId) return;
    lastX = ev.clientX;
    if (phase === 'pressed') {
      const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (touch) {
        if (moved < TOUCH_SLOP_PX) return;
        clearTimeout(hold);
        phase = 'panning';
        panX = ev.clientX;
        panScroll = list.scrollLeft;
      } else if (moved >= DRAG_THRESHOLD_PX) lift();
      else return;
    }
    if (phase === 'panning') {
      list.scrollLeft = panScroll - (ev.clientX - panX);
      return;
    }
    if (phase !== 'dragging') return;
    ev.preventDefault();
    place();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function onUp(ev: PointerEvent): void {
    if (ev.pointerId === pointerId) finish(true);
  }

  function onCancel(ev: PointerEvent): void {
    if (ev.pointerId === pointerId) finish(false);
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || phase !== 'dragging') return;
    // Ours, not the app's Esc (cancel the tool) or a dialog's.
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  }

  function onContextMenu(ev: Event): void {
    // A long press on touch must not open a menu over a lifted tab.
    if (phase === 'dragging') ev.preventDefault();
  }

  function onScroll(): void {
    if (phase === 'dragging') place();
  }

  const session = {
    cancel: () => {
      finish(false);
    },
  };
  active = session;
  // Window listeners (capture): they see the pointer even if capture could not be set.
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  list.addEventListener('scroll', onScroll, { passive: true });
  target.addEventListener('lostpointercapture', onCancel);
  if (touch)
    hold = setTimeout(() => {
      if (phase === 'pressed') lift();
    }, TOUCH_HOLD_MS);
}
