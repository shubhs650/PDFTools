// Read-only PDF document reader (M3-03, ADR-007 decision 1), ported from the
// M0-S2 spike: classic xref tables, xref streams (PNG predictors), /Prev
// chains, hybrid /XRefStm, object streams. Async because inflate is async in
// the workers (DecompressionStream; ADR-007 "Inflate"). It fails loudly on
// anything it can't read rather than misreading: in encrypted files it reads
// the xref (never encrypted) and plain objects, whose strings stay ciphertext
// (`encrypted` is set), and refuses encrypted streams until the Standard
// security handler lands (M3-04).
import {
  Parser,
  PdfRef,
  PdfStream,
  isDict,
  nameOf,
  numOf,
  type PdfDict,
  type PdfValue,
} from './objects';

export type Inflate = (bytes: Uint8Array) => Promise<Uint8Array>;

type XrefEntry =
  | { type: 1; offset: number; gen: number }
  | { type: 2; stream: number; index: number }
  | { type: 0 };

/** Inflate with the platform's DecompressionStream (browser, worker and Node ≥ 18). */
export const inflateStream: Inflate = async (bytes) => {
  const ds = new DecompressionStream('deflate');
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
};

function unpredict(data: Uint8Array, parms: PdfValue | undefined): Uint8Array {
  if (!isDict(parms)) return data;
  const predictor = numOf(parms.get('Predictor')) ?? 1;
  if (predictor === 1) return data;
  if (predictor < 10) throw new Error(`unsupported predictor ${String(predictor)}`);
  const cols = numOf(parms.get('Columns')) ?? 1;
  const bpc = numOf(parms.get('BitsPerComponent')) ?? 8;
  const colors = numOf(parms.get('Colors')) ?? 1;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((cols * colors * bpc) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  const prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const f = data[r * (rowLen + 1)] ?? 0;
    const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? (cur[i - bpp] ?? 0) : 0;
      const up = prev[i] ?? 0;
      const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
      const x = row[i] ?? 0;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + up;
      else if (f === 3) v = x + Math.floor((a + up) / 2);
      else if (f === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      } else throw new Error(`bad PNG filter ${String(f)}`);
      cur[i] = v & 0xff;
    }
    out.set(cur, r * rowLen);
    prev.set(cur);
  }
  return out;
}

const tailText = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = Math.max(0, bytes.length - 1024); i < bytes.length; i++)
    s += String.fromCharCode(bytes[i] ?? 0);
  return s;
};

export class PdfReader {
  readonly bytes: Uint8Array;
  readonly xref = new Map<number, XrefEntry>();
  trailer: PdfDict = new Map();
  encrypted = false;
  private readonly inflate: Inflate;
  private readonly cache = new Map<number, Promise<PdfValue>>();
  private readonly objStmCache = new Map<number, Promise<Map<number, PdfValue>>>();

  private constructor(bytes: Uint8Array, inflate: Inflate) {
    this.bytes = bytes;
    this.inflate = inflate;
  }

  /** Reads the cross-reference chain from the newest `startxref` back. */
  static async open(bytes: Uint8Array, inflate: Inflate = inflateStream): Promise<PdfReader> {
    const r = new PdfReader(bytes, inflate);
    const m = [...tailText(bytes).matchAll(/startxref\s+(\d+)/g)].pop();
    if (!m) throw new Error('no startxref');
    const seen = new Set<number>();
    let at: number | undefined = Number(m[1]);
    let first = true;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      const trailer = await r.readSection(at);
      if (first) r.trailer = trailer;
      first = false;
      const stm = numOf(trailer.get('XRefStm'));
      if (stm !== undefined && !seen.has(stm)) {
        seen.add(stm);
        await r.readSection(stm);
      }
      at = numOf(trailer.get('Prev'));
    }
    r.encrypted = r.trailer.has('Encrypt');
    return r;
  }

  private async readSection(at: number): Promise<PdfDict> {
    if (at < 0 || at >= this.bytes.length)
      throw new Error(`xref offset ${String(at)} is outside the file`);
    const p = new Parser(this.bytes, at);
    if (p.peekKeyword() === 'xref') {
      p.expectKeyword('xref');
      for (;;) {
        if (p.peekKeyword() === 'trailer') break;
        const start = p.parse();
        const count = p.parse();
        if (typeof start !== 'number' || typeof count !== 'number')
          throw new Error('bad xref subsection');
        for (let i = 0; i < count; i++) {
          const off = p.parse();
          const gen = p.parse();
          const t = p.peekKeyword();
          p.expectKeyword(t);
          if (typeof off !== 'number' || typeof gen !== 'number' || (t !== 'n' && t !== 'f'))
            throw new Error('bad xref entry');
          if (this.xref.has(start + i)) continue;
          this.xref.set(start + i, t === 'n' ? { type: 1, offset: off, gen } : { type: 0 });
        }
      }
      p.expectKeyword('trailer');
      const trailer = p.parse();
      if (!isDict(trailer)) throw new Error('bad trailer');
      return trailer;
    }
    // Cross-reference stream (never encrypted: ISO 32000-1 7.6.1).
    const { value } = await this.parseIndirectAt(at);
    if (!(value instanceof PdfStream)) throw new Error(`no xref at ${String(at)}`);
    const d = value.dict;
    const data = await this.decodeRaw(value);
    const w = (d.get('W') as number[] | undefined) ?? [1, 2, 1];
    const size = numOf(d.get('Size')) ?? 0;
    const index = (d.get('Index') as number[] | undefined) ?? [0, size];
    const [w0 = 1, w1 = 2, w2 = 1] = w;
    const rec = w0 + w1 + w2;
    let pos = 0;
    const field = (n: number, def: number): number => {
      if (n === 0) return def;
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + (data[pos++] ?? 0);
      return v;
    };
    for (let s = 0; s < index.length; s += 2) {
      const start = index[s] ?? 0;
      const count = index[s + 1] ?? 0;
      for (let i = 0; i < count && pos + rec <= data.length; i++) {
        const t = field(w0, 1);
        const a = field(w1, 0);
        const b2 = field(w2, 0);
        const num = start + i;
        if (this.xref.has(num)) continue;
        if (t === 1) this.xref.set(num, { type: 1, offset: a, gen: b2 });
        else if (t === 2) this.xref.set(num, { type: 2, stream: a, index: b2 });
        else this.xref.set(num, { type: 0 });
      }
    }
    return d;
  }

  private async parseIndirectAt(at: number): Promise<{ num: number; value: PdfValue }> {
    const p = new Parser(this.bytes, at);
    const num = p.parse();
    p.parse();
    p.expectKeyword('obj');
    if (typeof num !== 'number') throw new Error(`no object at ${String(at)}`);
    const v = p.parse();
    if (isDict(v)) {
      const lenV = v.get('Length');
      const len = lenV instanceof PdfRef ? await this.get(lenV) : lenV;
      const s = p.streamAfter(v, typeof len === 'number' ? len : 0);
      if (s) return { num, value: s };
    }
    return { num, value: v };
  }

  private async decodeRaw(s: PdfStream): Promise<Uint8Array> {
    const f = s.dict.get('Filter');
    const filters = Array.isArray(f) ? f.map(nameOf) : f ? [nameOf(f)] : [];
    const parms = s.dict.get('DecodeParms');
    let data = s.raw;
    for (let i = 0; i < filters.length; i++) {
      const name = filters[i];
      if (name !== 'FlateDecode') throw new Error(`unsupported filter ${name ?? '?'}`);
      data = unpredict(await this.inflate(data), Array.isArray(parms) ? parms[i] : parms);
    }
    return data;
  }

  /** A stream's decoded data (Flate + PNG predictors only). */
  async decode(s: PdfStream): Promise<Uint8Array> {
    if (this.encrypted && nameOf(s.dict.get('Type')) !== 'XRef')
      throw new Error('encrypted streams are not supported yet (ADR-007, M3-04)');
    return this.decodeRaw(s);
  }

  get(ref: PdfRef | number): Promise<PdfValue> {
    const num = typeof ref === 'number' ? ref : ref.num;
    let hit = this.cache.get(num);
    if (!hit) {
      hit = this.load(num);
      this.cache.set(num, hit);
    }
    return hit;
  }

  private async load(num: number): Promise<PdfValue> {
    const e = this.xref.get(num);
    if (e?.type === 1) return (await this.parseIndirectAt(e.offset)).value;
    if (e?.type === 2) return (await this.fromObjStm(e.stream)).get(num) ?? null;
    return null;
  }

  private fromObjStm(stmNum: number): Promise<Map<number, PdfValue>> {
    let hit = this.objStmCache.get(stmNum);
    if (!hit) {
      hit = this.readObjStm(stmNum);
      this.objStmCache.set(stmNum, hit);
    }
    return hit;
  }

  private async readObjStm(stmNum: number): Promise<Map<number, PdfValue>> {
    const s = await this.get(stmNum);
    if (!(s instanceof PdfStream)) throw new Error(`object stream ${String(stmNum)} missing`);
    const data = await this.decode(s);
    const n = numOf(s.dict.get('N')) ?? 0;
    const first = numOf(s.dict.get('First')) ?? 0;
    const head = new Parser(data, 0);
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const num = head.parse();
      const off = head.parse();
      if (typeof num !== 'number' || typeof off !== 'number')
        throw new Error('bad object stream header');
      pairs.push([num, off]);
    }
    const out = new Map<number, PdfValue>();
    for (const [num, off] of pairs) out.set(num, new Parser(data, first + off).parse());
    return out;
  }

  async resolve(v: PdfValue | undefined): Promise<PdfValue | undefined> {
    return v instanceof PdfRef ? this.get(v) : v;
  }

  /** Page objects in order, with their object numbers. */
  async pages(): Promise<{ num: number; dict: PdfDict }[]> {
    const root = await this.resolve(this.trailer.get('Root'));
    if (!isDict(root)) throw new Error('no catalog');
    const out: { num: number; dict: PdfDict }[] = [];
    const seen = new Set<number>();
    const walk = async (ref: PdfValue | undefined, depth: number): Promise<void> => {
      if (depth > 64) throw new Error('page tree too deep');
      if (ref instanceof PdfRef) {
        if (seen.has(ref.num)) throw new Error('page tree cycle');
        seen.add(ref.num);
      }
      const node = await this.resolve(ref);
      if (!isDict(node)) return;
      if (nameOf(node.get('Type')) === 'Pages') {
        const kids = await this.resolve(node.get('Kids'));
        for (const k of Array.isArray(kids) ? kids : []) await walk(k, depth + 1);
      } else if (ref instanceof PdfRef) out.push({ num: ref.num, dict: node });
    };
    await walk(root.get('Pages'), 0);
    return out;
  }

  maxObjNum(): number {
    return Math.max(numOf(this.trailer.get('Size')) ?? 0, ...this.xref.keys());
  }
}
