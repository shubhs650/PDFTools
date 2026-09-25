// Image encoder worker (ADR-011 decision 4): the main thread never draws or
// encodes tile and preview images (CLAUDE.md rule 1). Pixels arrive by transfer.
import type { EncoderApi } from '../engine/encoderApi';
import { serve } from './rpc-host';

serve<EncoderApi>(self, {
  encode: async ({ data, width, height, type, quality }) => {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
    return canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
  },
});
