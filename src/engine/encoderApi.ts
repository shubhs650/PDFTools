import type { MethodSpec } from './protocol';

/** Encoder worker API (ADR-011 decision 4): RGBA → image Blob off the main thread. */
export interface EncoderApi {
  encode: MethodSpec<
    {
      data: Uint8ClampedArray<ArrayBuffer>;
      width: number;
      height: number;
      type: string;
      quality?: number;
    },
    Blob
  >;
  /**
   * A dynamic stamp (M3-14, ADR-015 decision 1): the lines drawn with the
   * self-hosted Noto Sans into a PNG at `scale` px per point.
   */
  stamp: MethodSpec<
    {
      lines: string[];
      color: string;
      width: number;
      height: number;
      scale: number;
      /** Absolute same-origin URLs of the fonts (fonts.ts). */
      fontUrl: string;
      cjkFontUrl?: string;
    },
    ArrayBuffer
  >;
  /**
   * A typed signature or initials (M6-13, ADR-022 decision 3): `text` in the
   * self-hosted handwriting font at `px`, cropped to the ink, as a PNG with a
   * transparent background. Null when nothing visible was drawn.
   */
  signatureText: MethodSpec<
    {
      text: string;
      /** Absolute same-origin URL of the font (signatureFonts.ts) and its family name. */
      fontUrl: string;
      family: string;
      color: string;
      px: number;
    },
    { png: ArrayBuffer; width: number; height: number } | null
  >;
  /**
   * An uploaded signature image (M6-13): PNG or JPG decoded here, scaled down
   * to at most 1200 px, a white background made transparent if asked, cropped
   * to the ink and encoded as PNG. Null when nothing is left visible.
   */
  signatureImage: MethodSpec<
    { data: ArrayBuffer; transparent: boolean },
    { png: ArrayBuffer; width: number; height: number } | null
  >;
  /**
   * A pasted image in another raster format (M7-08, ADR-023 D-45: GIF, WebP,
   * BMP…) decoded here and encoded as PNG, at its own size, for the Image
   * Stamp path. Null when the browser can't decode it.
   */
  toPng: MethodSpec<
    { data: ArrayBuffer },
    { png: ArrayBuffer; width: number; height: number } | null
  >;
}
