// Make cloud comments from differences (M12-14, D-61, Q17): each difference's
// box, a little larger, as a cloud's corners in Document B's page as the
// viewer lays it out (EmbedPDF: points, top left, the page unturned). The
// box is in B's displayed page (after /Rotate). Pure.
import { displayedToLaid, type Pt } from '../align/manual';
import type { Box } from './textDiff';

/** Room left between a difference and its cloud (pt). */
export const CLOUD_MARGIN = 4;

/** The laid-out page a cloud goes on: its unturned size and its quarter turns. */
export interface LaidPage {
  width: number;
  height: number;
  rotation: number;
}

/**
 * The cloud's corners for a difference's box: grown by `margin`, kept on the
 * displayed page, then turned into the laid-out page (clockwise as shown).
 */
export function cloudVertices(box: Box, page: LaidPage, margin = CLOUD_MARGIN): Pt[] {
  const turned = (page.rotation & 1) === 1;
  const dw = turned ? page.height : page.width;
  const dh = turned ? page.width : page.height;
  const x0 = Math.max(0, Math.min(box[0], box[2]) - margin);
  const y0 = Math.max(0, Math.min(box[1], box[3]) - margin);
  const x1 = Math.min(dw, Math.max(box[0], box[2]) + margin);
  const y1 = Math.min(dh, Math.max(box[1], box[3]) + margin);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map((p) => displayedToLaid(page.rotation, page.width, page.height, p));
}
