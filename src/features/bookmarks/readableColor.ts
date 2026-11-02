// A bookmark's own colour (/C) shown readably (M6-15, rule 12, §8.2): the
// file's colour is kept when it has WCAG AA contrast (4.5:1) on every
// background a row can have, and is otherwise mixed toward the theme's text
// colour just enough to reach it. Pure: the theme's colours come in.

export type Rgb = readonly [number, number, number]; // 0 … 1 each

const channel = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** WCAG 2 relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio, 1 … 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * `fg`, or the first mix of `fg` toward `text` (in 5 % steps) that has at
 * least `min` contrast on every one of `backgrounds`; `text` itself if none.
 */
export function readableOn(fg: Rgb, backgrounds: readonly Rgb[], text: Rgb, min = 4.5): Rgb {
  const ok = (c: Rgb) => backgrounds.every((bg) => contrastRatio(c, bg) >= min);
  for (let step = 0; step <= 20; step++) {
    const c = step === 0 ? fg : mix(fg, text, step / 20);
    if (ok(c)) return c;
  }
  return text;
}

/**
 * `#rrggbb` or `#rgb` (the design tokens, as written or as the minified CSS
 * has them) → 0 … 1 channels; null for anything else (system colour names).
 */
export function parseHex(css: string): Rgb | null {
  const v = css.trim();
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(v);
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(v);
  const parts = long
    ? [long[1], long[2], long[3]]
    : short
      ? [short[1], short[2], short[3]].map((h) => `${h ?? '0'}${h ?? '0'}`)
      : null;
  if (!parts) return null;
  return parts.map((h) => parseInt(h ?? '0', 16) / 255) as unknown as Rgb;
}
