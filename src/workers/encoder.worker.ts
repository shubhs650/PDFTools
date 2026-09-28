// Image encoder worker (ADR-011 decision 4): the main thread never draws or
// encodes tile and preview images (CLAUDE.md rule 1). Pixels arrive by transfer.
import type { EncoderApi } from '../engine/encoderApi';
import { Transfer } from '../engine/protocol';
import { serve } from './rpc-host';

type Fonts = FontFaceSet & { add(face: FontFace): void };
const faces = new Map<string, Promise<void>>();

/** Loads a same-origin font once as the family `name` (ADR-003: Regular only). */
function loadFace(name: string, url: string): Promise<void> {
  let p = faces.get(name);
  if (!p) {
    p = (async () => {
      const face = new FontFace(name, await (await fetch(url)).arrayBuffer());
      await face.load();
      (self as unknown as { fonts: Fonts }).fonts.add(face);
    })();
    p.catch(() => faces.delete(name));
    faces.set(name, p);
  }
  return p;
}

serve<EncoderApi>(self, {
  encode: async ({ data, width, height, type, quality }) => {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
    return canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
  },
  // M3-14 (ADR-015 d1): a rounded frame; the first line large, the others small;
  // each line squeezed to the stamp's width when too long. Canvas text only.
  stamp: async ({ lines, color, width, height, scale: k, fontUrl, cjkFontUrl }) => {
    await loadFace('StampSans', fontUrl);
    if (cjkFontUrl) await loadFace('StampCJK', cjkFontUrl);
    const family = cjkFontUrl ? 'StampSans, StampCJK' : 'StampSans';
    const w = Math.round(width * k);
    const h = Math.round(height * k);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5 * k;
    ctx.beginPath();
    ctx.roundRect(1.5 * k, 1.5 * k, w - 3 * k, h - 3 * k, 6 * k);
    ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    const max = w - 20 * k;
    const [first = '', ...rest] = lines;
    ctx.font = `${String(18 * k)}px ${family}`;
    ctx.fillText(first, 10 * k, 24 * k, max);
    ctx.font = `${String(10 * k)}px ${family}`;
    rest.slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, 10 * k, (40 + i * 13) * k, max);
    });
    const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
    return new Transfer(png, [png]);
  },
});
