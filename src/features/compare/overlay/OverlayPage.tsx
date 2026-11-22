import { useEffect, useRef } from 'react';
import { renderEngine } from '../../view/host';
import { OverlayPainter, type PainterStats, type TileContent } from './painter';
import type { Size } from './frames';

/**
 * The overlay as a page's content (M12-12): the overlay window is a document
 * window of the comparison's notes, and this layer draws the overlay where the
 * notes page's own content would be, at the window's zoom (EmbedPDF's, 1 CSS px
 * per point at 100 %). The painter places the Render worker's tiles (M12-11);
 * its state goes on the scroll container as data attributes and to `onStats`.
 */
export function OverlayPage({
  frame,
  content,
  scale,
  onStats,
}: {
  frame: Size;
  content: TileContent;
  scale: number;
  onStats: (s: PainterStats, viewport: HTMLElement) => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const painter = useRef<OverlayPainter | null>(null);
  const report = useRef(onStats);
  const key = JSON.stringify([frame, content]);

  // The latest reporter (before the painter's effects below, which may report at once).
  useEffect(() => {
    report.current = onStats;
  });

  useEffect(() => {
    const sh = sheet.current;
    const vp = sh?.closest<HTMLElement>('.viewport');
    if (!sh || !vp) return;
    const p = new OverlayPainter(
      vp,
      sh,
      (req) => renderEngine().rpc.call('overlayTile', req),
      (s) => {
        report.current(s, vp);
      },
      1,
    );
    painter.current = p;
    const changed = (): void => {
      p.viewChanged();
    };
    vp.addEventListener('scroll', changed, { passive: true });
    const ro = new ResizeObserver(changed);
    ro.observe(vp);
    return () => {
      vp.removeEventListener('scroll', changed);
      ro.disconnect();
      p.dispose();
      painter.current = null;
    };
  }, []);

  useEffect(() => {
    painter.current?.setContent(frame, content);
    // `key` stands for the frame and the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    painter.current?.setZoom(scale);
  }, [scale]);

  return <div ref={sheet} className="overlay-sheet-paper overlay-page" aria-hidden="true" />;
}
