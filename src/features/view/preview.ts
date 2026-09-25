// The bounded base image under the tiles (ADR-011 decision 3). The stock
// RenderLayer renders the whole page at the current zoom (a 190,000 px bitmap
// at 6400 % on A0), so the preview is capped at a longest side of 1024 device
// px and quantized to half-octave steps, so small zoom changes reuse the
// cached image. Sharpness at any zoom comes from the tiles.

export const PREVIEW_MAX_PX = 1024;

/** Scale factor (with dpr 1) for a page of `size` points shown at `scale` × `dpr`. */
export function previewScale(
  size: { width: number; height: number },
  scale: number,
  dpr: number,
  maxPx = PREVIEW_MAX_PX,
): number {
  const longest = Math.max(size.width, size.height);
  if (!(longest > 0) || !(scale > 0)) return 0;
  const cap = maxPx / longest;
  const wanted = scale * Math.max(1, dpr);
  const stepped = 2 ** (Math.floor(Math.log2(wanted) * 2) / 2);
  return Math.min(stepped, cap);
}
