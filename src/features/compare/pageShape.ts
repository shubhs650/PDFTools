// Page pictures of the input window (M12-24, ADR-033): whether a picture is on
// screen, and a page's shape read from the engine's document.
import { useEffect, useMemo, useState, type RefCallback } from 'react';
import type { PageShape } from '../../model/compare/pageFit';
import { usePages as usePageOps } from '../pages/pageOps';
import { useHost } from '../view/host';

/** Pictures start this far outside the visible area, so a slow scroll finds them drawn. */
const AHEAD = '240px';

/** Whether an element is on screen (or within AHEAD of it), as a callback ref and a flag. */
export function useOnScreen<T extends Element>(): [RefCallback<T>, boolean] {
  const [el, setEl] = useState<T | null>(null);
  // Without IntersectionObserver (tests), every picture counts as on screen.
  const [on, setOn] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setOn(e.isIntersecting);
      },
      { rootMargin: AHEAD },
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [el]);
  return [setEl, on];
}

/** One page's size and /Rotate, read from the engine's document (no page list copied). */
export function usePageShape(docId: string, page: number): PageShape | null {
  const registry = useHost((s) => s.registry);
  const version = usePageOps((s) => s.version[docId] ?? 0);
  return useMemo(() => {
    const p = registry?.getStore().getState().core.documents[docId]?.document?.pages[page];
    return p ? { width: p.size.width, height: p.size.height, rotation: p.rotation } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version: the page list changed in place
  }, [registry, docId, page, version]);
}
