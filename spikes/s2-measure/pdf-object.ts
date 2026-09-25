// M0-S2: minimal PDF object layer (read + serialize) for what PDFium/EmbedPDF
// cannot do: read and write nested dictionaries such as /Measure and page /VP.
// Read-only parser: classic xref tables, xref streams (incl. PNG predictors),
// /Prev chains, hybrid /XRefStm, object streams. Unencrypted files only;
// encrypted files are detected and reported (see ADR-007).

export class PdfName {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
}
export class PdfRef {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen = 0) {
    this.num = num;
    this.gen = gen;
  }
}
export class PdfString {
  readonly bytes: Uint8Array;
  readonly hex: boolean;
  constructor(bytes: Uint8Array, hex = false) {
    this.bytes = bytes;
    this.hex = hex;
  }
  /** Text string: UTF-16BE with BOM, else PDFDocEncoding (≈ Latin-1 here). */
  text(): string {
    const b = this.bytes;
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
      return new TextDecoder().decode(b.subarray(3));
    return String.fromCharCode(...b);
  }
  static of(text: string): PdfString {
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\xff]*$/.test(text))
      return new PdfString(Uint8Array.from(text, (c) => c.charCodeAt(0)));
    const out = [0xfe, 0xff];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      out.push(c >> 8, c & 0xff);
    }
    return new PdfString(Uint8Array.from(out));
  }
}
export type PdfDict = Map<string, PdfValue>;
export class PdfStream {
  readonly dict: PdfDict;
  readonly raw: Uint8Array;
  constructor(dict: PdfDict, raw: Uint8Array) {
    this.dict = dict;
    this.raw = raw;
  }
}
export type PdfValue =
  null | boolean | number | PdfName | PdfString | PdfRef | PdfValue[] | PdfDict | PdfStream;

export const isDict = (v: PdfValue | undefined): v is PdfDict => v instanceof Map;
export const nameOf = (v: PdfValue | undefined): string | undefined =>
  v instanceof PdfName ? v.name : undefined;
export const numOf = (v: PdfValue | undefined): number | undefined =>
  typeof v === 'number' ? v : undefined;

// ---- tokenizer / parser -------------------------------------------------------

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export class Parser {
  private readonly b: Uint8Array;
  pos: number;
  constructor(b: Uint8Array, pos = 0) {
    this.b = b;
    this.pos = pos;
  }

  private skipWs(): void {
    const b = this.b;
    for (;;) {
      while (this.pos < b.length && WS.has(b[this.pos] ?? 0)) this.pos++;
      if (b[this.pos] === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else return;
    }
  }

  private regular(): string {
    const start = this.pos;
    while (
      this.pos < this.b.length &&
      !WS.has(this.b[this.pos] ?? 0) &&
      !DELIM.has(this.b[this.pos] ?? 0)
    )
      this.pos++;
    return String.fromCharCode(...this.b.subarray(start, this.pos));
  }

  peekKeyword(): string {
    this.skipWs();
    const save = this.pos;
    const w = this.regular();
    this.pos = save;
    return w;
  }

  expectKeyword(k: string): void {
    this.skipWs();
    const w = this.regular();
    if (w !== k) throw new Error(`expected ${k}, got "${w}" at ${String(this.pos)}`);
  }

  parse(): PdfValue {
    this.skipWs();
    const b = this.b;
    const c = b[this.pos];
    if (c === undefined) throw new Error('unexpected end of data');
    if (c === 0x2f) {
      this.pos++;
      const raw = this.regular();
      return new PdfName(
        raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
      );
    }
    if (c === 0x28) return this.literal();
    if (c === 0x3c && b[this.pos + 1] === 0x3c) return this.dictOrStream();
    if (c === 0x3c) return this.hexString();
    if (c === 0x5b) {
      this.pos++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skipWs();
        if (b[this.pos] === 0x5d) {
          this.pos++;
          return arr;
        }
        arr.push(this.parse());
      }
    }
    const w = this.regular();
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      // "N G R" reference?
      if (/^\d+$/.test(w)) {
        const save = this.pos;
        this.skipWs();
        const g = this.regular();
        if (/^\d+$/.test(g)) {
          this.skipWs();
          if (this.regular() === 'R') return new PdfRef(Number(w), Number(g));
        }
        this.pos = save;
      }
      return Number(w);
    }
    throw new Error(`unexpected token "${w}" at ${String(this.pos)}`);
  }

  private literal(): PdfString {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++] ?? 0;
      if (c === 0x5c) {
        const n = b[this.pos++] ?? 0;
        const map: Record<number, number> = {
          0x6e: 10,
          0x72: 13,
          0x74: 9,
          0x62: 8,
          0x66: 12,
          0x28: 0x28,
          0x29: 0x29,
          0x5c: 0x5c,
        };
        if (map[n] !== undefined) out.push(map[n]);
        else if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30;
          for (let k = 0; k < 2 && (b[this.pos] ?? 0) >= 0x30 && (b[this.pos] ?? 0) <= 0x37; k++)
            v = v * 8 + ((b[this.pos++] ?? 0) - 0x30);
          out.push(v & 0xff);
        } else if (n === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (n !== 0x0a) out.push(n);
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29 && --depth === 0) break;
      out.push(c);
    }
    return new PdfString(Uint8Array.from(out));
  }

  private hexString(): PdfString {
    this.pos++;
    let hex = '';
    while (this.pos < this.b.length && this.b[this.pos] !== 0x3e) {
      const ch = String.fromCharCode(this.b[this.pos++] ?? 0);
      if (/[0-9A-Fa-f]/.test(ch)) hex += ch;
    }
    this.pos++;
    if (hex.length % 2) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return new PdfString(out, true);
  }

  private dictOrStream(): PdfDict | PdfStream {
    this.pos += 2;
    const d: PdfDict = new Map();
    for (;;) {
      this.skipWs();
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      const k = this.parse();
      if (!(k instanceof PdfName)) throw new Error(`dict key is not a name at ${String(this.pos)}`);
      d.set(k.name, this.parse());
    }
    return d;
  }

  /** After a dict: `stream` keyword → raw bytes (length resolved by caller). */
  streamAfter(dict: PdfDict, length: number): PdfStream | null {
    const save = this.pos;
    this.skipWs();
    if (this.regular() !== 'stream') {
      this.pos = save;
      return null;
    }
    if (this.b[this.pos] === 0x0d) this.pos++;
    if (this.b[this.pos] === 0x0a) this.pos++;
    const raw = this.b.subarray(this.pos, this.pos + length);
    this.pos += length;
    return new PdfStream(dict, raw);
  }
}

// ---- document reader ------------------------------------------------------------

type XrefEntry =
  { type: 1; offset: number; gen: number } | { type: 2; stream: number; index: number };
export type Inflate = (b: Uint8Array) => Uint8Array;

function unpredict(data: Uint8Array, parms: PdfValue | undefined): Uint8Array {
  if (!isDict(parms)) return data;
  const predictor = numOf(parms.get('Predictor')) ?? 1;
  if (predictor < 10) return data;
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
      else {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      cur[i] = v & 0xff;
    }
    out.set(cur, r * rowLen);
    prev.set(cur);
  }
  return out;
}

export class PdfDocument {
  readonly xref = new Map<number, XrefEntry>();
  trailer: PdfDict = new Map();
  readonly encrypted: boolean;
  private readonly cache = new Map<number, PdfValue>();
  private readonly objStmCache = new Map<number, Map<number, PdfValue>>();

  readonly bytes: Uint8Array;
  private readonly inflate: Inflate;

  constructor(bytes: Uint8Array, inflate: Inflate) {
    this.bytes = bytes;
    this.inflate = inflate;
    const tail = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 1024)));
    const m = [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
    if (!m) throw new Error('no startxref');
    const seen = new Set<number>();
    let at: number | undefined = Number(m[1]);
    let first = true;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      const trailer = this.readSection(at);
      if (first) this.trailer = trailer;
      first = false;
      const stm = numOf(trailer.get('XRefStm'));
      if (stm !== undefined && !seen.has(stm)) {
        seen.add(stm);
        this.readSection(stm);
      }
      at = numOf(trailer.get('Prev'));
    }
    this.encrypted = this.trailer.has('Encrypt');
  }

  private readSection(at: number): PdfDict {
    const p = new Parser(this.bytes, at);
    if (p.peekKeyword() === 'xref') {
      p.expectKeyword('xref');
      for (;;) {
        const k = p.peekKeyword();
        if (k === 'trailer') break;
        const start = p.parse() as number;
        const count = p.parse() as number;
        for (let i = 0; i < count; i++) {
          const off = Number(p.peekKeyword());
          p.parse();
          const gen = Number(p.peekKeyword());
          p.parse();
          const t = p.peekKeyword();
          p.expectKeyword(t);
          if (t === 'n' && !this.xref.has(start + i))
            this.xref.set(start + i, { type: 1, offset: off, gen });
          if (t === 'f' && !this.xref.has(start + i))
            this.xref.set(start + i, { type: 1, offset: -1, gen });
        }
      }
      p.expectKeyword('trailer');
      return p.parse() as PdfDict;
    }
    // Cross-reference stream.
    const { value } = this.parseIndirectAt(at);
    if (!(value instanceof PdfStream)) throw new Error(`no xref at ${String(at)}`);
    const d = value.dict;
    const data = this.decode(value);
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
        else this.xref.set(num, { type: 1, offset: -1, gen: 0 });
      }
    }
    return d;
  }

  private parseIndirectAt(at: number): { num: number; value: PdfValue } {
    const p = new Parser(this.bytes, at);
    const num = p.parse() as number;
    p.parse();
    p.expectKeyword('obj');
    const v = p.parse();
    if (isDict(v)) {
      const lenV = v.get('Length');
      const len = lenV instanceof PdfRef ? (this.get(lenV) as number) : (numOf(lenV) ?? 0);
      const s = p.streamAfter(v, len);
      if (s) return { num, value: s };
    }
    return { num, value: v };
  }

  decode(s: PdfStream): Uint8Array {
    if (this.encrypted) throw new Error('encrypted streams are not supported (ADR-007)');
    const f = s.dict.get('Filter');
    const filters = Array.isArray(f) ? f.map(nameOf) : f ? [nameOf(f)] : [];
    const parms = s.dict.get('DecodeParms');
    let data = s.raw;
    filters.forEach((name, i) => {
      if (name !== 'FlateDecode') throw new Error(`unsupported filter ${name ?? '?'}`);
      data = unpredict(this.inflate(data), Array.isArray(parms) ? parms[i] : parms);
    });
    return data;
  }

  get(ref: PdfRef | number): PdfValue {
    const num = typeof ref === 'number' ? ref : ref.num;
    if (this.cache.has(num)) return this.cache.get(num) ?? null;
    const e = this.xref.get(num);
    let v: PdfValue = null;
    if (e?.type === 1 && e.offset >= 0) v = this.parseIndirectAt(e.offset).value;
    if (e?.type === 2) v = this.fromObjStm(e.stream).get(num) ?? null;
    this.cache.set(num, v);
    return v;
  }

  private fromObjStm(stmNum: number): Map<number, PdfValue> {
    const hit = this.objStmCache.get(stmNum);
    if (hit) return hit;
    const s = this.get(stmNum);
    if (!(s instanceof PdfStream)) throw new Error(`object stream ${String(stmNum)} missing`);
    const data = this.decode(s);
    const n = numOf(s.dict.get('N')) ?? 0;
    const first = numOf(s.dict.get('First')) ?? 0;
    const head = new Parser(data, 0);
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) pairs.push([head.parse() as number, head.parse() as number]);
    const out = new Map<number, PdfValue>();
    for (const [num, off] of pairs) out.set(num, new Parser(data, first + off).parse());
    this.objStmCache.set(stmNum, out);
    return out;
  }

  resolve(v: PdfValue | undefined): PdfValue | undefined {
    return v instanceof PdfRef ? this.get(v) : v;
  }

  /** Page objects in order, with their object numbers. */
  pages(): { num: number; dict: PdfDict }[] {
    const root = this.resolve(this.trailer.get('Root'));
    if (!isDict(root)) throw new Error('no catalog');
    const out: { num: number; dict: PdfDict }[] = [];
    const walk = (ref: PdfValue | undefined, depth: number): void => {
      if (depth > 64) return;
      const node = this.resolve(ref);
      if (!isDict(node)) return;
      if (nameOf(node.get('Type')) === 'Pages') {
        for (const k of (node.get('Kids') as PdfValue[] | undefined) ?? []) walk(k, depth + 1);
      } else if (ref instanceof PdfRef) out.push({ num: ref.num, dict: node });
    };
    walk(root.get('Pages'), 0);
    return out;
  }

  maxObjNum(): number {
    return Math.max(numOf(this.trailer.get('Size')) ?? 0, ...this.xref.keys());
  }
}

// ---- serializer -----------------------------------------------------------------

/** PDF reals: no exponent notation; 10 significant digits (scale factors are tiny). */
export const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) throw new Error(`not a PDF number: ${String(n)}`);
  if (Number.isInteger(n)) return String(n);
  const digits = Math.min(20, Math.max(0, 9 - Math.floor(Math.log10(Math.abs(n)))));
  const s = n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
};

export function serialize(v: PdfValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return fmtNum(v);
  if (v instanceof PdfName) {
    return `/${v.name.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
  }
  if (v instanceof PdfRef) return `${String(v.num)} ${String(v.gen)} R`;
  if (v instanceof PdfString) {
    const printable = v.bytes.every((c) => c >= 0x20 && c < 0x7f);
    if (!printable || v.hex)
      return `<${[...v.bytes].map((c) => c.toString(16).padStart(2, '0')).join('')}>`;
    return `(${String.fromCharCode(...v.bytes).replace(/[\\()]/g, (c) => `\\${c}`)})`;
  }
  if (Array.isArray(v)) return `[${v.map(serialize).join(' ')}]`;
  if (v instanceof PdfStream) throw new Error('streams are not serialized by this layer');
  return `<<${[...v.entries()].map(([k, x]) => `${serialize(new PdfName(k))} ${serialize(x)}`).join(' ')}>>`;
}

/** Plain JS helpers for building dictionaries. */
export const N = (n: string): PdfName => new PdfName(n);
export const S = (t: string): PdfString => PdfString.of(t);
export const D = (o: Record<string, PdfValue>): PdfDict => new Map(Object.entries(o));
