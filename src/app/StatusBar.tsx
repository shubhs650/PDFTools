import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { nextFold, type Fold } from './statusFold';

export interface StatusBarProps {
  /** Page navigation (M1-15), then Previous / Next View (M13-04). */
  pageNav?: ReactNode;
  /** Status toggles, view-mode switch (M1-16) and zoom box (M1-15). */
  view?: ReactNode;
  /** "Ready offline" / "Preparing offline… n %" / "Update ready" (M1-25). */
  app?: ReactNode;
}

/**
 * Status bar (§5): slots filled by later tasks. The page buttons stay centred while
 * there is room; a wide right-hand side pushes them left, and the tool hint on the left
 * shortens. When even that does not fit (M13-04, D-70), the view modes fold into a menu
 * first (`data-fold="1"`) and only then the status toggles drop their words
 * (`data-fold="2"`).
 */
export function StatusBar({ pageNav, view, app }: StatusBarProps) {
  const { t } = useTranslation();
  const bar = useRef<HTMLElement>(null);
  const fold = useFold(bar);
  return (
    <footer ref={bar} aria-label={t('frame.statusBar')} className="status-bar" data-fold={fold}>
      <div className="status-bar-slot status-bar-slot--start">{app}</div>
      <div className="status-bar-slot status-bar-slot--center">{pageNav}</div>
      <div className="status-bar-slot status-bar-slot--end">{view}</div>
    </footer>
  );
}

/** Width of a slot's parts and the gaps between them; `.tool-hint` shrinks, so it is left out. */
function partsWidth(slot: Element): number {
  const gap = parseFloat(getComputedStyle(slot).columnGap) || 0;
  let used = 0;
  let shown = 0;
  for (const el of Array.from(slot.children)) {
    if (el.classList.contains('tool-hint')) continue;
    const w = el.getBoundingClientRect().width;
    if (w > 0) {
      used += w;
      shown++;
    }
  }
  return used + gap * Math.max(0, shown - 1);
}

/** The fold level the bar needs, measured again when it or any of its parts change size. */
function useFold(ref: React.RefObject<HTMLElement | null>): Fold {
  const [fold, setFold] = useState<Fold>(0);
  // Width each fold level needed when last shown, so the bar unfolds once there is room.
  const needs = useRef<number[]>([]);
  const level = useRef<Fold>(0);
  useLayoutEffect(() => {
    const footer = ref.current;
    if (!footer) return;
    const slots = Array.from(footer.children);
    const measure = (): void => {
      const style = getComputedStyle(footer);
      const gap = parseFloat(style.columnGap) || 0;
      const room =
        footer.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      needs.current[level.current] =
        slots.reduce((sum, slot) => sum + partsWidth(slot), 0) + gap * (slots.length - 1);
      const next = nextFold(level.current, room, needs.current);
      if (next !== level.current) {
        level.current = next;
        setFold(next);
      }
    };
    const sizes = new ResizeObserver(measure);
    const watch = (): void => {
      sizes.disconnect();
      sizes.observe(footer);
      for (const slot of slots) for (const el of Array.from(slot.children)) sizes.observe(el);
    };
    const parts = new MutationObserver(watch);
    for (const slot of slots) parts.observe(slot, { childList: true });
    watch();
    return () => {
      sizes.disconnect();
      parts.disconnect();
    };
  }, [ref]);
  return fold;
}
