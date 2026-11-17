// Images to PDF (M11-08·O8, D-55): where one image goes on its page. Pure;
// PDF user space (points, y up). Shared by the Work worker, which builds the
// pages, and the dialog's summary.
import { BLANK_MAX_SIDE, BLANK_MIN_SIDE } from './blankSize';
import type { ImageFileInfo } from './imageFile';

/** "fit": the page takes the image's own size; a paper size turns to match each image. */
export type ImagePageSize = 'fit' | 'a4' | 'letter';

export const IMAGE_PAGE_SIZES: readonly ImagePageSize[] = ['fit', 'a4', 'letter'];

/** Portrait paper sizes in points (ISO 216, ANSI). */
const PAPER: Record<Exclude<ImagePageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** The margin on paper sizes when one is asked for: 10 mm. */
export const IMAGE_MARGIN = (10 * 72) / 25.4;

/** A file that states no resolution is taken at 96 pixels per inch, as a browser shows it. */
export const DEFAULT_IMAGE_DPI = 96;

/** Most images one Images to PDF job takes (Create Blank's page limit). */
export const IMAGES_MAX = 1000;

/**
 * Most bytes of images one job takes: the files are read at once and the Work
 * worker's PDFium holds every image until the save, in a 32-bit WebAssembly heap.
 */
export const IMAGES_MAX_BYTES = 512 * 1024 * 1024;

/** PDF matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export interface ImagePlacement {
  /** The page's width and height in points. */
  width: number;
  height: number;
  /** Maps the image's unit square onto the page (the image object's matrix). */
  matrix: Matrix;
}

/** Whether the orientation turns the image a quarter (EXIF 5–8): its shown width is its stored height. */
export const turnsQuarter = (orientation: number): boolean => orientation >= 5 && orientation <= 8;

/**
 * The unit square onto itself so that the stored image shows the way the
 * camera meant (EXIF orientation 1–8; anything else counts as 1). In image
 * space row 0 is at the top, y = 1.
 */
export function orientationMatrix(orientation: number): Matrix {
  switch (orientation) {
    case 2: // mirrored left to right
      return [-1, 0, 0, 1, 1, 0];
    case 3: // turned half a turn
      return [-1, 0, 0, -1, 1, 1];
    case 4: // mirrored top to bottom
      return [1, 0, 0, -1, 0, 1];
    case 5: // transposed: row 0 becomes the left column
      return [0, -1, -1, 0, 1, 1];
    case 6: // turn a quarter clockwise: row 0 becomes the right column
      return [0, -1, 1, 0, 0, 1];
    case 7: // transversed: row 0 becomes the right column, read upwards
      return [0, 1, 1, 0, 0, 0];
    case 8: // turn a quarter counterclockwise: row 0 becomes the left column
      return [0, 1, -1, 0, 1, 0];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/** `m` then `n` (row vectors, as PDF composes them). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + b * c2,
    a * b2 + b * d2,
    c * a2 + d * c2,
    c * b2 + d * d2,
    e * a2 + f * c2 + e2,
    e * b2 + f * d2 + f2,
  ];
}

/** The image's natural size in points, as shown (orientation applied). */
export function naturalSize(
  info: Pick<ImageFileInfo, 'width' | 'height' | 'dpiX' | 'dpiY' | 'orientation'>,
): { width: number; height: number } {
  const w = (info.width / (info.dpiX ?? DEFAULT_IMAGE_DPI)) * 72;
  const h = (info.height / (info.dpiY ?? DEFAULT_IMAGE_DPI)) * 72;
  return turnsQuarter(info.orientation) ? { width: h, height: w } : { width: w, height: h };
}

/**
 * The page and the image's matrix. "fit": the page is the image's natural
 * size, kept within PDF's page limits (scaled down past 200 in, a tiny image
 * centred on a ½ in page). A paper size takes the image's orientation
 * (landscape for a wide image), and the image is scaled down to fit inside
 * the margin and centred; it is never enlarged.
 */
export function placeImage(
  info: Pick<ImageFileInfo, 'width' | 'height' | 'dpiX' | 'dpiY' | 'orientation'>,
  size: ImagePageSize,
  margin: boolean,
): ImagePlacement {
  const nat = naturalSize(info);
  let page: { width: number; height: number };
  let scale: number;
  if (size === 'fit') {
    scale = Math.min(1, BLANK_MAX_SIDE / Math.max(nat.width, nat.height));
    page = {
      width: Math.max(BLANK_MIN_SIDE, nat.width * scale),
      height: Math.max(BLANK_MIN_SIDE, nat.height * scale),
    };
  } else {
    const [w, h] = PAPER[size];
    page = nat.width > nat.height ? { width: h, height: w } : { width: w, height: h };
    const m = margin ? IMAGE_MARGIN : 0;
    scale = Math.min(1, (page.width - 2 * m) / nat.width, (page.height - 2 * m) / nat.height);
  }
  const w = nat.width * scale;
  const h = nat.height * scale;
  const place: Matrix = [w, 0, 0, h, (page.width - w) / 2, (page.height - h) / 2];
  return { ...page, matrix: multiply(orientationMatrix(info.orientation), place) };
}

/** The name of the new document: the image's own name for one image, else a count. */
export function imagesBaseName(names: readonly string[]): string | null {
  const [first] = names;
  if (names.length !== 1 || first === undefined) return null;
  const base = first.replace(/\.(jpe?g|jfif|png)$/iu, '').trim();
  return base === '' ? null : base;
}
