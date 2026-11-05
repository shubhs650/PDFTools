// What a text comment's editor writes (M7-02, ADR-023 D-43 d); textEdit.ts does the writing.

/**
 * The text an editor holds, as /Contents: no-break spaces (which the browser
 * types for a run of spaces) are spaces, and an emptied editor's lone line
 * break is no text.
 */
export function editorText(raw: string): string {
  const text = raw.replace(/\u00A0/g, ' ');
  return text === '\n' ? '' : text;
}

/** What a commit writes: the patch, or null when the text did not change. */
export function contentsPatch(
  current: string | undefined,
  raw: string,
): { contents: string } | null {
  const text = editorText(raw);
  return text === (current ?? '') ? null : { contents: text };
}

/** How far (screen px) a press on a text comment must travel to become a move (M7-03). */
export const MOVE_THRESHOLD_PX = 3;

/**
 * A pointer movement on screen as a movement in page points (M7-03): the
 * view's scale and the page's rotation (quarter turns) undone, as the
 * annotation plugin's own drag does.
 */
export function pageDelta(
  dx: number,
  dy: number,
  scale: number,
  rotation: number,
): { x: number; y: number } {
  const turns = ((Math.round(rotation) % 4) + 4) % 4;
  const x = dx / scale;
  const y = dy / scale;
  switch (turns) {
    case 1:
      return { x: y, y: -x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: -y, y: x };
    default:
      return { x, y };
  }
}

// --- Growing to fit the text (M7-12, bug B15) -------------------------------

interface Rect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}
interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** The text comment fields the fit reads (EmbedPDF's model, page points, y down). */
export interface FitTarget {
  rect: Rect;
  rectangleDifferences?: Insets;
  intent?: string;
  rotation?: number;
  calloutLine?: readonly unknown[];
}

/** Room left below the last line and after the longest typewriter line (pt). */
export const FIT_SLACK_PT = { height: 2, width: 4 };

const round = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * The geometry of a text comment whose text needs `grow` more points (width
 * for a typewriter, which does not wrap; height for all three) to show all of
 * it, as PDF-XChange grows them while typing. Only ever grows, and stays on
 * the page (`page` is its size in points). A callout's text box grows; its
 * line stays where it points, the rect and /RD follow. A turned comment is
 * left as it is. Null when nothing changes.
 */
export function grownTextGeometry(
  obj: FitTarget,
  grow: { width: number; height: number },
  page: { width: number; height: number },
): { rect: Rect; rectangleDifferences?: Insets } | null {
  if ((obj.rotation ?? 0) % 360 !== 0) return null;
  const dw = grow.width > 0.5 ? grow.width + FIT_SLACK_PT.width : 0;
  const dh = grow.height > 0.5 ? grow.height + FIT_SLACK_PT.height : 0;
  if (!dw && !dh) return null;
  const callout = obj.intent === 'FreeTextCallout' || (obj.calloutLine?.length ?? 0) > 0;
  const rd = obj.rectangleDifferences ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const r = obj.rect;
  const box = callout
    ? {
        x: r.origin.x + rd.left,
        y: r.origin.y + rd.top,
        w: r.size.width - rd.left - rd.right,
        h: r.size.height - rd.top - rd.bottom,
      }
    : { x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height };
  const w = Math.max(box.w, Math.min(box.w + dw, page.width - box.x));
  const h = Math.max(box.h, Math.min(box.h + dh, page.height - box.y));
  if (w - box.w < 0.01 && h - box.h < 0.01) return null;
  if (!callout)
    return { rect: { origin: { ...r.origin }, size: { width: round(w), height: round(h) } } };
  const right = Math.max(r.origin.x + r.size.width, box.x + w);
  const bottom = Math.max(r.origin.y + r.size.height, box.y + h);
  return {
    rect: {
      origin: { ...r.origin },
      size: { width: round(right - r.origin.x), height: round(bottom - r.origin.y) },
    },
    rectangleDifferences: {
      left: rd.left,
      top: rd.top,
      right: round(right - (box.x + w)),
      bottom: round(bottom - (box.y + h)),
    },
  };
}
