// PDF values as plain data, for staging object patches over the RPC (M3-03):
// class instances (PdfName, PdfString, Map) don't survive structured clone.
import { PdfName, PdfRef, PdfStream, PdfString, type PdfValue } from './objects';

export type PdfJson =
  | null
  | boolean
  | number
  | { name: string }
  | { text: string }
  | { hex: string }
  | { ref: [number, number] }
  | { dict: Record<string, PdfJson> }
  | PdfJson[];

export function toJson(v: PdfValue): PdfJson {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
  if (v instanceof PdfName) return { name: v.name };
  if (v instanceof PdfRef) return { ref: [v.num, v.gen] };
  if (v instanceof PdfString) {
    if (!v.hex && v.bytes.every((c) => c >= 0x20 && c < 0x7f))
      return { text: String.fromCharCode(...v.bytes) };
    return { hex: [...v.bytes].map((c) => c.toString(16).padStart(2, '0')).join('') };
  }
  if (Array.isArray(v)) return v.map(toJson);
  if (v instanceof PdfStream) throw new Error('streams have no wire form');
  return { dict: Object.fromEntries([...v.entries()].map(([k, x]) => [k, toJson(x)])) };
}

export function fromJson(j: PdfJson): PdfValue {
  if (j === null || typeof j === 'boolean') return j;
  if (typeof j === 'number') {
    if (!Number.isFinite(j)) throw new Error('not a PDF number');
    return j;
  }
  if (Array.isArray(j)) return j.map(fromJson);
  if ('name' in j) return new PdfName(j.name);
  if ('text' in j) return PdfString.of(j.text);
  if ('hex' in j) {
    if (!/^(?:[0-9a-f]{2})*$/i.test(j.hex)) throw new Error('bad hex string');
    const b = new Uint8Array(j.hex.length / 2);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(j.hex.slice(i * 2, i * 2 + 2), 16);
    return new PdfString(b, true);
  }
  if ('ref' in j) return new PdfRef(j.ref[0], j.ref[1]);
  if ('dict' in j) {
    const d = new Map<string, PdfValue>();
    for (const [k, x] of Object.entries(j.dict)) d.set(k, fromJson(x));
    return d;
  }
  throw new Error('unknown PDF value');
}
