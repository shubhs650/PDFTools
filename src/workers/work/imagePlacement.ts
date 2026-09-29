// Images in reading order (M4-05, M4-Q6 follow-up). PDF Oxide's Markdown puts
// a page's images after all of its text, and its HTML has none; the Word
// export (M4-07) and the Markdown/HTML exports want each image where it sits
// on the page. Here each text block of Oxide's output is given the top of the
// text line it starts with (Oxide's line boxes), and each image goes before
// the first block that starts at or below the image's top edge. Pure; PDF
// user space (y up). Two-column pages keep Oxide's block order, so an image in
// the right column may land between left-column blocks (documented limit).

export interface LineBox {
  text: string;
  /** Top edge (y up). */
  top: number;
}

export interface ImageBox<T = unknown> {
  top: number;
  left: number;
  ref: T;
}

export type Placed<T> = { kind: 'block'; index: number } | { kind: 'image'; ref: T };

/** Letters and digits only, lower-case: what survives Markdown/HTML markup and spacing. */
export function textKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/<[^>]*>/g, ' ') // HTML tags
    .replace(/&[a-z]+;|&#\d+;/gi, ' ') // entities
    .replace(/\]\([^)]*\)/g, ' ') // link targets
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Markdown split into blocks at blank lines, keeping fenced code blocks whole.
 * Empty blocks are dropped.
 */
export function splitMarkdownBlocks(md: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fenced = false;
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === '') {
      if (cur.length) out.push(cur.join('\n'));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out.filter((b) => b.trim() !== '');
}

/** HTML split into its top-level elements (Oxide writes one per line). */
export function splitHtmlBlocks(html: string): string[] {
  return html.split('\n').filter((l) => l.trim() !== '');
}

const PREFIX = 12;

/**
 * The top of each block: the first line (from the last match on, in Oxide's
 * order) whose key and the block's key start the same way. A block with no
 * match takes the previous block's top (the first one: +Infinity, the page top).
 */
export function blockTops(blocks: readonly string[], lines: readonly LineBox[]): number[] {
  const keys = lines.map((l) => textKey(l.text));
  const tops: number[] = [];
  let from = 0;
  let prev = Number.POSITIVE_INFINITY;
  for (const b of blocks) {
    const k = textKey(b);
    let top = prev;
    if (k) {
      for (let i = from; i < keys.length; i++) {
        const lk = keys[i] ?? '';
        if (!lk) continue;
        const n = Math.min(PREFIX, lk.length, k.length);
        if (lk.slice(0, n) === k.slice(0, n)) {
          top = lines[i]?.top ?? prev;
          from = i + 1;
          break;
        }
      }
    }
    tops.push(top);
    prev = top;
  }
  return tops;
}

/** Blocks and images in reading order. Images: top first, then left first. */
export function placeImages<T>(
  tops: readonly number[],
  images: readonly ImageBox<T>[],
): Placed<T>[] {
  const queue = [...images].sort((a, b) => b.top - a.top || a.left - b.left);
  const out: Placed<T>[] = [];
  const TOL = 1; // points
  tops.forEach((top, index) => {
    while (queue.length && top <= (queue[0]?.top ?? -Infinity) + TOL) {
      const img = queue.shift();
      if (img) out.push({ kind: 'image', ref: img.ref });
    }
    out.push({ kind: 'block', index });
  });
  for (const img of queue) out.push({ kind: 'image', ref: img.ref });
  return out;
}
