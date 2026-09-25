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
}
