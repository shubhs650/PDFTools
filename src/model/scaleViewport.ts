// Scale viewports on a page (M3-17, §7.4, ADR-007): a page's /VP list split
// into its default scale (a viewport over the whole page, M3-15) and its
// detail viewports ("Detail A 1:5"), edits of that list, and the scale a
// measurement gets from it. Pure; boxes are PDF user space.
import {
  chooseScale,
  type PageViewport,
  type Pt,
  type Scale,
  type ScaleChoice,
  type ScaleViewport,
} from './scale';

export type Box = [number, number, number, number];

/** x1 < x2, y1 < y2. */
export const normBox = ([x1, y1, x2, y2]: Box): Box => [
  Math.min(x1, x2),
  Math.min(y1, y2),
  Math.max(x1, x2),
  Math.max(y1, y2),
];

/** Covers the whole page (within half a point): the page's default viewport. */
export function coversPage(box: Box, mediaBox: Box): boolean {
  const [x1, y1, x2, y2] = normBox(box);
  const [mx1, my1, mx2, my2] = normBox(mediaBox);
  return x1 <= mx1 + 0.5 && y1 <= my1 + 0.5 && x2 >= mx2 - 0.5 && y2 >= my2 - 0.5;
}

export interface PageLayout {
  pageDefault: Scale | null;
  /** Detail viewports with a scale, with their index in the page's /VP list. */
  details: (ScaleViewport & { index: number })[];
}

/** `list`: the page's /VP entries in order, null where an entry couldn't be read. */
export function layoutOf(list: readonly (PageViewport | null)[], mediaBox: Box): PageLayout {
  let pageDefault: Scale | null = null;
  const details: PageLayout['details'] = [];
  list.forEach((v, index) => {
    if (!v?.scale) return;
    if (coversPage(v.bbox, mediaBox)) pageDefault ??= v.scale;
    else details.push({ name: v.name, bbox: normBox(v.bbox), scale: v.scale, index });
  });
  return { pageDefault, details };
}

/** The scale choice for measured points (user space) on a page laid out as `layout`. */
export function scaleChoice(pts: Pt[], layout: PageLayout): ScaleChoice {
  return chooseScale(pts, layout.details, layout.pageDefault);
}

/** The scale a choice values a measurement in (spanning: the page default, flagged). */
export function scaleOfChoice(c: ScaleChoice): Scale | null {
  if (c.kind === 'viewport') return c.viewport.scale;
  if (c.kind === 'page') return c.scale;
  if (c.kind === 'spanning') return c.fallback;
  return null;
}

/** Adds (index undefined) or replaces the entry at `index`. */
export function withEntry<T>(list: readonly T[], item: T, index?: number): T[] {
  if (index === undefined || index < 0 || index >= list.length) return [...list, item];
  return list.map((x, i) => (i === index ? item : x));
}

export function withoutEntry<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** A name not used on the page yet: "Detail A", "Detail B", … */
export function nextViewportName(list: readonly PageViewport[], base: string): string {
  const used = new Set(list.map((v) => v.name));
  for (let i = 0; i < 26 * 27; i++) {
    const letters =
      i < 26
        ? String.fromCharCode(65 + i)
        : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    const name = `${base} ${letters}`;
    if (!used.has(name)) return name;
  }
  return base;
}
