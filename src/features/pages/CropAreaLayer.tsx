import type { Rect } from '@embedpdf/models';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/store/appStore';
import { pageSize } from '../snapshot/snapshot';
import { snapshotRect } from '../snapshot/snapshotModel';
import { cropAreaDrawn } from './crop';

/**
 * The Crop Tool on a page (M11-08·O9): while it is on, the page takes the
 * pointer and a drag draws the area to keep; Crop Pages then opens with its
 * margins, for this page (the range can be changed there). Typing the margins
 * in Crop Pages is the keyboard way (rule 12).
 */
export function CropAreaLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const on = useApp((s) => s.tool === 'cropArea');
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Rect | null>(null);

  // Native listeners: they run before the page's own pointer handling (text
  // selection) further up, which a React handler could not stop.
  useEffect(() => {
    const el = root.current;
    if (!el || !on) return;
    let start: { x: number; y: number } | null = null;
    // offsetX/Y: the layer's own coordinates (the page as shown, before the view's rotation).
    const at = (e: PointerEvent) => ({ x: e.offsetX / scale, y: e.offsetY / scale });
    const rectTo = (e: PointerEvent): Rect | null => {
      if (!start) return null;
      const { width, height } = pageSize(documentId, pageIndex);
      return snapshotRect(start, at(e), width, height);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      // The document takes focus, so Esc ends the tool.
      el.closest<HTMLElement>('#document-panel')?.focus({ preventScroll: true });
      start = at(e);
      setDraft(null);
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      e.stopPropagation();
      setDraft(rectTo(e));
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      e.stopPropagation();
      const r = rectTo(e);
      start = null;
      setDraft(null);
      if (r)
        cropAreaDrawn(documentId, pageIndex, {
          x: r.origin.x,
          y: r.origin.y,
          width: r.size.width,
          height: r.size.height,
        });
    };
    const cancel = () => {
      start = null;
      setDraft(null);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [on, scale, documentId, pageIndex]);

  if (!on) return null;
  return (
    <div ref={root} className="crop-area-layer" data-testid="crop-area-layer">
      {draft ? (
        <div
          className="crop-area-rect"
          data-testid="crop-area-draft"
          aria-hidden="true"
          style={{
            left: `${String(draft.origin.x * scale)}px`,
            top: `${String(draft.origin.y * scale)}px`,
            width: `${String(draft.size.width * scale)}px`,
            height: `${String(draft.size.height * scale)}px`,
          }}
        />
      ) : null}
    </div>
  );
}
