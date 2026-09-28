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
}
