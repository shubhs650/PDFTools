// Render cost model (M1-17, ADR-004 decision 3): predicts whether a render
// will take more than 100 ms from what PDFium must draw and how many pixels
// it fills. Drawings pack thousands of segments into one path object, so path
// segments count on their own. Fitted to renders of the self-made fixtures in
// the container (ms at a 256 / 1024 / 4096 px longest side):
//   contract page (53 objects)            8 / 13 / 150
//   A0, 40k segments in 400 paths         13 / 21 / 90
//   A0, 400k segments in 4,000 paths      115 / 208 / 580
// It errs towards "heavy": a false positive only costs a few slice yields.

export const HEAVY_MS = 100;

const BASE_MS = 2;
const PER_OBJECT_MS = 0.01;
const PER_SEGMENT_MS = 0.0003;
const PER_MEGAPIXEL_MS = 8;
/** Stroking cost grows with both segments and pixels. */
const PER_SEGMENT_MEGAPIXEL_MS = 0.00006;

export interface RenderCost {
  /** Page objects (text, paths, images, forms). */
  objects: number;
  /** Path segments over all path objects. */
  segments: number;
  /** Output size in device pixels. */
  width: number;
  height: number;
}

export function estimateMs({ objects, segments, width, height }: RenderCost): number {
  const mp = (width * height) / 1e6;
  return (
    BASE_MS +
    objects * PER_OBJECT_MS +
    segments * PER_SEGMENT_MS +
    mp * PER_MEGAPIXEL_MS +
    segments * mp * PER_SEGMENT_MEGAPIXEL_MS
  );
}

export function isHeavy(cost: RenderCost): boolean {
  return estimateMs(cost) > HEAVY_MS;
}
