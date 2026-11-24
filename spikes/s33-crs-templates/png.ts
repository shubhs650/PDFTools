// Spike S33 (M13-06): a tiny PNG writer for self-made logos and snapshot
// stand-ins (rule 13: no real documents). Pure, works in Node and workers.
import { zlibSync } from 'fflate';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA pixel function → PNG bytes. */
export function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A made-up logo: a blue ring with a triangle (no real company's mark). */
export function logoPng(size = 96): Uint8Array {
  const c = size / 2;
  return png(size, size, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (d > c * 0.78 && d < c * 0.95) return [31, 78, 160, 255];
    const inTri = y > c * 0.55 && y < c * 1.35 && Math.abs(x - c) < (y - c * 0.55) * 0.6;
    if (inTri) return [230, 120, 30, 255];
    return [255, 255, 255, 0];
  });
}

/** A stand-in for a CRS snapshot: a grey sheet with a red cloud-ish ring. */
export function snapshotPng(width: number, height: number, seed = 1): Uint8Array {
  return png(width, height, (x, y) => {
    const border = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
    if (border) return [90, 90, 90, 255];
    const grid = (x + seed * 7) % 40 === 0 || (y + seed * 3) % 40 === 0;
    const d = Math.hypot((x - width / 2) / (width / 3), (y - height / 2) / (height / 3));
    if (d > 0.9 && d < 1.0) return [220, 30, 30, 255];
    return grid ? [200, 200, 210, 255] : [250, 250, 250, 255];
  });
}
