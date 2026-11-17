// Images to PDF (M11-08·O8, D-55): what a JPG or PNG file is, read from its
// header only (pure, no decoding). The pixel size, the resolution the file
// states (JFIF density, EXIF X/YResolution or PNG pHYs) and, for a JPEG, the
// EXIF orientation a camera writes instead of turning the pixels.

export type ImageKind = 'jpeg' | 'png';

export interface ImageFileInfo {
  kind: ImageKind;
  /** Stored pixel size (before the orientation is applied). */
  width: number;
  height: number;
  /** Pixels per inch the file states, or null when it states none. */
  dpiX: number | null;
  dpiY: number | null;
  /** EXIF orientation, 1 (as stored) to 8; 1 for a PNG. */
  orientation: number;
}

/** How much of a file to read for its header: JPEG metadata (EXIF) can fill 64 KB before the frame header. */
export const IMAGE_HEADER_BYTES = 256 * 1024;

/**
 * Whether a dropped or opened file is a picture (it goes to Images to PDF,
 * which takes JPG and PNG and names any other picture as left out) rather
 * than a document.
 */
export function looksLikeImage(file: { name: string; type: string }): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|jfif|png|gif|webp|bmp|tiff?|heic|heif|avif)$/iu.test(file.name);
}

const plausibleDpi = (v: number): number | null =>
  Number.isFinite(v) && v >= 10 && v <= 10_000 ? v : null;

/** The header's facts, or null when the bytes are not a JPEG or PNG we can place. */
export function readImageInfo(bytes: Uint8Array): ImageFileInfo | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e)
    return readPng(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return readJpeg(bytes);
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPng(b: Uint8Array): ImageFileInfo | null {
  if (b.length < 33 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = (at: number) =>
    String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
  if (type(12) !== 'IHDR') return null;
  const width = v.getUint32(16);
  const height = v.getUint32(20);
  if (width === 0 || height === 0) return null;
  let dpiX: number | null = null;
  let dpiY: number | null = null;
  // Walk the chunks up to the image data for pHYs (unit 1: pixels per metre).
  for (let at = 8; at + 8 <= b.length;) {
    const len = v.getUint32(at);
    const t = type(at + 4);
    if (t === 'IDAT' || t === 'IEND') break;
    if (t === 'pHYs' && len >= 9 && at + 17 <= b.length && b[at + 16] === 1) {
      dpiX = plausibleDpi(v.getUint32(at + 8) * 0.0254);
      dpiY = plausibleDpi(v.getUint32(at + 12) * 0.0254);
    }
    at += 12 + len;
  }
  return { kind: 'png', width, height, dpiX, dpiY, orientation: 1 };
}

/** SOFn markers that carry the frame size (not DHT C4, JPG C8 or DAC CC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function readJpeg(b: Uint8Array): ImageFileInfo | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let jfif: { x: number; y: number } | null = null;
  let exif: Exif = { orientation: 1, x: null, y: null };
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // no frame header before the scan
    const len = v.getUint16(at + 2);
    if (len < 2) return null;
    const body = at + 4;
    if (isSof(marker)) {
      if (body + 5 > b.length) return null;
      const height = v.getUint16(body + 1);
      const width = v.getUint16(body + 3);
      if (width === 0 || height === 0) return null;
      const dpi = jfif ?? (exif.x !== null && exif.y !== null ? { x: exif.x, y: exif.y } : null);
      return {
        kind: 'jpeg',
        width,
        height,
        dpiX: dpi ? plausibleDpi(dpi.x) : null,
        dpiY: dpi ? plausibleDpi(dpi.y) : null,
        orientation: exif.orientation,
      };
    }
    if (marker === 0xe0 && body + 12 <= b.length && ascii(b, body, 5) === 'JFIF\0') {
      const units = b[body + 7];
      const x = v.getUint16(body + 8);
      const y = v.getUint16(body + 10);
      if (units === 1) jfif = { x, y };
      else if (units === 2) jfif = { x: x * 2.54, y: y * 2.54 };
    }
    if (marker === 0xe1 && body + 14 <= b.length && ascii(b, body, 6) === 'Exif\0\0')
      exif = readExif(v, body + 6, Math.min(b.length, at + 2 + len));
    at += 2 + len;
  }
  return null;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
}

interface Exif {
  orientation: number;
  /** Pixels per inch, when the file states a resolution unit of inches or centimetres. */
  x: number | null;
  y: number | null;
}

/** IFD0's Orientation, X/YResolution and ResolutionUnit from a TIFF header at `tiff`. */
function readExif(v: DataView, tiff: number, end: number): Exif {
  const out: Exif = { orientation: 1, x: null, y: null };
  if (tiff + 8 > end) return out;
  const order = v.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return out;
  const le = order === 0x4949;
  const u16 = (p: number) => (p + 2 <= end ? v.getUint16(p, le) : 0);
  const u32 = (p: number) => (p + 4 <= end ? v.getUint32(p, le) : 0);
  if (u16(tiff + 2) !== 42) return out;
  const ifd = tiff + u32(tiff + 4);
  const count = u16(ifd);
  let unit = 2; // inches, the TIFF default
  let rx: number | null = null;
  let ry: number | null = null;
  const rational = (entry: number): number | null => {
    const p = tiff + u32(entry + 8);
    const den = u32(p + 4);
    return den ? u32(p) / den : null;
  };
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    const tag = u16(e);
    if (tag === 0x0112) {
      const o = u16(e + 8);
      if (o >= 1 && o <= 8) out.orientation = o;
    } else if (tag === 0x011a) rx = rational(e);
    else if (tag === 0x011b) ry = rational(e);
    else if (tag === 0x0128) unit = u16(e + 8);
  }
  if (rx !== null && ry !== null && (unit === 2 || unit === 3)) {
    const k = unit === 3 ? 2.54 : 1;
    out.x = rx * k;
    out.y = ry * k;
  }
  return out;
}
