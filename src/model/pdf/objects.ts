// PDF object values, parser and serializer (M3-03, ADR-007 decision 1): the
// part of our own object layer that works on one object's text. Used by the
// Render worker to patch objects PDFium serialized (/Measure, /IT, page /VP —
// keys EmbedPDF/PDFium can't write) and by the reader (reader.ts). Ported from
// the M0-S2 spike (spikes/s2-measure/pdf-object.ts). Pure; no I/O.

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

/** PDFDocEncoding bytes that differ from Latin-1 (ISO 32000-1 Annex D.2). */
const PDF_DOC: Record<number, number> = {
  0x18: 0x02d8,
  0x19: 0x02c7,
  0x1a: 0x02c6,
  0x1b: 0x02d9,
  0x1c: 0x02dd,
  0x1d: 0x02db,
  0x1e: 0x02da,
  0x1f: 0x02dc,
  0x80: 0x2022,
  0x81: 0x2020,
  0x82: 0x2021,
  0x83: 0x2026,
  0x84: 0x2014,
  0x85: 0x2013,
  0x86: 0x0192,
  0x87: 0x2044,
  0x88: 0x2039,
  0x89: 0x203a,
  0x8a: 0x2212,
  0x8b: 0x2030,
  0x8c: 0x201e,
  0x8d: 0x201c,
  0x8e: 0x201d,
  0x8f: 0x2018,
  0x90: 0x2019,
  0x91: 0x201a,
  0x92: 0x2122,
  0x93: 0xfb01,
  0x94: 0xfb02,
  0x95: 0x0141,
  0x96: 0x0152,
  0x97: 0x0160,
  0x98: 0x0178,
  0x99: 0x017d,
  0x9a: 0x0131,
  0x9b: 0x0142,
  0x9c: 0x0153,
  0x9d: 0x0161,
  0x9e: 0x017e,
  0xa0: 0x20ac,
};

export class PdfString {
  readonly bytes: Uint8Array;
  readonly hex: boolean;
  constructor(bytes: Uint8Array, hex = false) {
    this.bytes = bytes;
    this.hex = hex;
  }

  /** Text string: UTF-16BE with BOM, UTF-8 with BOM (PDF 2.0), else PDFDocEncoding. */
  text(): string {
    const b = this.bytes;
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
      return new TextDecoder().decode(b.subarray(3));
    let out = '';
    for (const c of b) out += String.fromCharCode(PDF_DOC[c] ?? c);
    return out;
  }

  /** Printable ASCII (plus tab/newlines) as bytes; anything else as UTF-16BE with BOM. */
  static of(text: string): PdfString {
    if (/^[\t\n\r\x20-\x7e]*$/.test(text))
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

/** Plain helpers for building values. */
export const N = (n: string): PdfName => new PdfName(n);
export const S = (t: string): PdfString => PdfString.of(t);
export const D = (o: Record<string, PdfValue>): PdfDict => new Map(Object.entries(o));

/** True when `v` holds a string anywhere (strings are encrypted in encrypted files). */
export function containsString(v: PdfValue | undefined): boolean {
  if (v instanceof PdfString) return true;
  if (Array.isArray(v)) return v.some(containsString);
  if (v instanceof PdfStream) return true;
  if (isDict(v)) return [...v.values()].some(containsString);
  return false;
}

// ---- tokenizer / parser -------------------------------------------------------

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const ESCAPES: Record<number, number> = {
  0x6e: 10,
  0x72: 13,
  0x74: 9,
  0x62: 8,
  0x66: 12,
  0x28: 0x28,
  0x29: 0x29,
  0x5c: 0x5c,
};
/** Nesting limit: deeper structures are refused, never a stack overflow. */
const MAX_DEPTH = 256;

const ascii = (b: Uint8Array, from: number, to: number): string => {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i] ?? 0);
  return s;
};

export class Parser {
  private readonly b: Uint8Array;
  pos: number;
  private depth = 0;
  constructor(b: Uint8Array, pos = 0) {
    this.b = b;
    this.pos = pos;
  }

  skipWs(): void {
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
    return ascii(this.b, start, this.pos);
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
    if (++this.depth > MAX_DEPTH) throw new Error('object nesting too deep');
    try {
      return this.value();
    } finally {
      this.depth--;
    }
  }

  private value(): PdfValue {
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
    if (c === 0x3c && b[this.pos + 1] === 0x3c) return this.dict();
    if (c === 0x3c) return this.hexString();
    if (c === 0x5b) {
      this.pos++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) throw new Error('unterminated array');
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
        const esc = ESCAPES[n];
        if (esc !== undefined) out.push(esc);
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
      if (c === 0x29 && --depth === 0) return new PdfString(Uint8Array.from(out));
      out.push(c);
    }
    throw new Error('unterminated string');
  }

  private hexString(): PdfString {
    this.pos++;
    let hex = '';
    while (this.pos < this.b.length && this.b[this.pos] !== 0x3e) {
      const ch = String.fromCharCode(this.b[this.pos++] ?? 0);
      if (/[0-9A-Fa-f]/.test(ch)) hex += ch;
    }
    if (this.pos >= this.b.length) throw new Error('unterminated hex string');
    this.pos++;
    if (hex.length % 2) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return new PdfString(out, true);
  }

  private dict(): PdfDict {
    this.pos += 2;
    const d: PdfDict = new Map();
    for (;;) {
      this.skipWs();
      if (this.pos >= this.b.length) throw new Error('unterminated dictionary');
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return d;
      }
      const k = this.parse();
      if (!(k instanceof PdfName)) throw new Error(`dict key is not a name at ${String(this.pos)}`);
      d.set(k.name, this.parse());
    }
  }

  /** After a dict: the `stream` keyword → raw bytes of `length` (resolved by the caller). */
  streamAfter(dict: PdfDict, length: number): PdfStream | null {
    const save = this.pos;
    this.skipWs();
    if (this.regular() !== 'stream') {
      this.pos = save;
      return null;
    }
    if (this.b[this.pos] === 0x0d) this.pos++;
    if (this.b[this.pos] === 0x0a) this.pos++;
    if (this.pos + length > this.b.length) throw new Error('stream runs past the end of the file');
    const raw = this.b.subarray(this.pos, this.pos + length);
    this.pos += length;
    return new PdfStream(dict, raw);
  }
}

/** One indirect object `N G obj <value> endobj` (no stream data) parsed from its text. */
export function parseIndirect(bytes: Uint8Array): { num: number; gen: number; value: PdfValue } {
  const p = new Parser(bytes);
  const num = p.parse();
  const gen = p.parse();
  if (typeof num !== 'number' || typeof gen !== 'number') throw new Error('not an object');
  p.expectKeyword('obj');
  const value = p.parse();
  if (p.peekKeyword() === 'stream') throw new Error('streams are not patched by this layer');
  p.expectKeyword('endobj');
  return { num, gen, value };
}

// ---- serializer -----------------------------------------------------------------

/** PDF reals: never exponent form; 10 significant digits (scale factors are tiny, ADR-007). */
export const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) throw new Error(`not a PDF number: ${String(n)}`);
  if (Number.isInteger(n)) return String(n);
  const digits = Math.min(20, Math.max(0, 9 - Math.floor(Math.log10(Math.abs(n)))));
  const s = n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
};

const nameText = (n: string): string =>
  `/${n.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;

export function serialize(v: PdfValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return fmtNum(v);
  if (v instanceof PdfName) return nameText(v.name);
  if (v instanceof PdfRef) return `${String(v.num)} ${String(v.gen)} R`;
  if (v instanceof PdfString) {
    const printable = v.bytes.every((c) => c >= 0x20 && c < 0x7f);
    if (!printable || v.hex)
      return `<${[...v.bytes].map((c) => c.toString(16).padStart(2, '0')).join('')}>`;
    return `(${ascii(v.bytes, 0, v.bytes.length).replace(/[\\()]/g, (c) => `\\${c}`)})`;
  }
  if (Array.isArray(v)) return `[${v.map(serialize).join(' ')}]`;
  if (v instanceof PdfStream) throw new Error('streams are not serialized by this layer');
  return `<<${[...v.entries()].map(([k, x]) => `${nameText(k)} ${serialize(x)}`).join(' ')}>>`;
}

/** `N G obj … endobj` as bytes (Latin-1; serialize() only emits ASCII). */
export function serializeIndirect(num: number, gen: number, value: PdfValue): Uint8Array {
  const text = `${String(num)} ${String(gen)} obj\n${serialize(value)}\nendobj`;
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
