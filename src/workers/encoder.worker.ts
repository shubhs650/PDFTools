// Image encoder worker (ADR-011 decision 4): the main thread never draws or
// encodes tile and preview images (CLAUDE.md rule 1). Pixels arrive by transfer.
import type { EncoderApi } from '../engine/encoderApi';
import { Transfer } from '../engine/protocol';
import { serve } from './rpc-host';
import {
  clearWhiteBackground,
  fitEdge,
  inkBounds,
  SIGNATURE_MAX_EDGE,
} from '../model/visualSignature';

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

/** `canvas` cropped to its ink, as a PNG (null: nothing visible). */
async function croppedPng(
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  pad: number,
): Promise<Transfer<{ png: ArrayBuffer; width: number; height: number }> | null> {
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const box = inkBounds(px.data, canvas.width, canvas.height, pad);
  if (!box) return null;
  const out = new OffscreenCanvas(box.width, box.height);
  const octx = out.getContext('2d');
  if (!octx) throw new Error('2d context unavailable');
  octx.putImageData(px, -box.x, -box.y);
  const png = await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer();
  return new Transfer({ png, width: box.width, height: box.height }, [png]);
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
  // M6-13 (ADR-022 d3): typed signatures and initials in a bundled handwriting font.
  signatureText: async ({ text, fontUrl, family, color, px }) => {
    await loadFace(family, fontUrl);
    const probe = new OffscreenCanvas(1, 1).getContext('2d');
    if (!probe) throw new Error('2d context unavailable');
    const font = `${String(px)}px "${family}"`;
    probe.font = font;
    // Script fonts reach far left and right of their advance: room on both sides.
    const w = Math.min(SIGNATURE_MAX_EDGE * 2, Math.ceil(probe.measureText(text).width + px));
    const h = Math.ceil(px * 1.8);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context unavailable');
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px / 2, h / 2, w - px);
    return croppedPng(canvas, ctx, 4);
  },
  // M6-13: an uploaded PNG/JPG, decoded here (never on the main thread, rule 1).
  signatureImage: async ({ data, transparent }) => {
    const bitmap = await createImageBitmap(new Blob([data]));
    try {
      const size = fitEdge({ width: bitmap.width, height: bitmap.height });
      const canvas = new OffscreenCanvas(size.width, size.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      if (transparent) {
        const px = ctx.getImageData(0, 0, size.width, size.height);
        clearWhiteBackground(px.data);
        ctx.putImageData(px, 0, 0);
      }
      return await croppedPng(canvas, ctx, 2);
    } finally {
      bitmap.close();
    }
  },
  // M7-08 (D-45): a pasted GIF, WebP or BMP becomes a PNG (PDFium places PNG and JPEG).
  toPng: async ({ data }) => {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([data]));
    } catch {
      return null;
    }
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(bitmap, 0, 0);
      const png = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
      return new Transfer({ png, width: bitmap.width, height: bitmap.height }, [png]);
    } finally {
      bitmap.close();
    }
  },
});
