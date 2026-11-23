// A page's picture in the input window (M12-24, ADR-033): in a pairing row,
// the page picker and Preview pair. Drawn in the Render worker through the
// thumbnail queue (rule 1), only while it is on screen: a picture scrolled
// away gives up its place in the queue, and a picture drawn before comes back
// from the image cache. The frame keeps the page's shape before the picture
// arrives, so nothing moves.
import { fitWidth, heightAt } from '../../model/compare/pageFit';
import { ThumbImage } from '../thumbnails/ThumbImage';
import { useOnScreen, usePageShape } from './pageShape';

export interface PagePictureProps {
  docId: string;
  page: number;
  /** The box the picture fits in, CSS px. */
  box: { width: number; height: number };
  /** Lower first in the thumbnail queue. */
  priority: number;
}

/** A page picture fitted to `box`, drawn only while on screen. Decoration: alt is empty. */
export function PagePicture({ docId, page, box, priority }: PagePictureProps) {
  const shape = usePageShape(docId, page);
  const [ref, on] = useOnScreen<HTMLSpanElement>();
  const width = shape ? fitWidth(shape, box) : box.width;
  const height = shape ? heightAt(shape, width) : box.height;
  return (
    <span
      ref={ref}
      className="compare-picture"
      style={{ width, height }}
      data-testid="compare-picture"
      data-drawn={on && shape ? '' : undefined}
    >
      {on && shape ? (
        <ThumbImage
          documentId={docId}
          pageIndex={page}
          page={shape}
          width={width}
          priority={priority}
        />
      ) : null}
    </span>
  );
}
