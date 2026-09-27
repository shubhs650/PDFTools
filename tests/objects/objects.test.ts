// M3-03: PDF values, parser and serializer (ported from the M0-S2 spike,
// spikes/s2-measure/pdf-object.test.ts) and the RPC wire form.
import { describe, expect, it } from 'vitest';
import {
  D,
  N,
  Parser,
  PdfRef,
  PdfStream,
  PdfString,
  S,
  containsString,
  fmtNum,
  isDict,
  nameOf,
  parseIndirect,
  serialize,
  serializeIndirect,
} from '../../src/model/pdf/objects';
import { fromJson, toJson } from '../../src/model/pdf/wire';

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const parse = (s: string) => new Parser(enc(s)).parse();

describe('Parser', () => {
  it('parses nested dicts, arrays, refs, names with #xx, numbers and strings', () => {
    const v = parse(
      '<< /A [1 -2.5 .5 3 0 R] /N#20x /x /S (a\\(b\\)\\n\\101) /H <48 65 6C6> /B true /Z null >>',
    );
    expect(isDict(v)).toBe(true);
    if (!isDict(v)) return;
    const a = v.get('A') as unknown[];
    expect(a.slice(0, 3)).toEqual([1, -2.5, 0.5]);
    expect(a[3]).toEqual(new PdfRef(3, 0));
    expect(nameOf(v.get('N x'))).toBe('x');
    expect((v.get('S') as PdfString).text()).toBe('a(b)\nA');
    expect((v.get('H') as PdfString).text()).toBe('Hel`');
    expect(v.get('B')).toBe(true);
    expect(v.get('Z')).toBeNull();
  });

  it('decodes UTF-16BE and PDFDocEncoding text strings', () => {
    expect((parse('<FEFF00B50020006D>') as PdfString).text()).toBe('µ m');
    // 0x80 is a bullet and 0xA0 the euro sign in PDFDocEncoding, not Latin-1.
    expect((parse('<80A0E9>') as PdfString).text()).toBe('•€é');
  });

  it('skips comments and keeps two numbers that are not a reference', () => {
    expect(parse('[1 2 % comment\n 3]')).toEqual([1, 2, 3]);
    expect(parse('[4 0]')).toEqual([4, 0]);
  });

  it('fails loudly on truncated or malformed input', () => {
    expect(() => parse('<< /A 1')).toThrow(/unterminated/);
    expect(() => parse('(abc')).toThrow(/unterminated/);
    expect(() => parse('[1 2')).toThrow(/unterminated/);
    expect(() => parse('<< 1 2 >>')).toThrow(/not a name/);
    expect(() => parse('@')).toThrow(/unexpected/);
    expect(() => parse('['.repeat(1000))).toThrow(/too deep/);
  });

  it('reads stream data by length', () => {
    const p = new Parser(enc('<< /Length 3 >>\nstream\nabc\nendstream'));
    const d = p.parse();
    if (!isDict(d)) throw new Error('no dict');
    const s = p.streamAfter(d, 3);
    expect(s).toBeInstanceOf(PdfStream);
    expect(String.fromCharCode(...(s?.raw ?? []))).toBe('abc');
    const short = new Parser(enc('<< >> stream\nab'));
    short.parse();
    expect(() => short.streamAfter(new Map(), 5)).toThrow(/past the end/);
  });
});

describe('serialize', () => {
  it('writes reals with 10 significant digits and never in exponent form', () => {
    expect(fmtNum(0.003527777777777778)).toBe('0.003527777778');
    expect(fmtNum(35.27777777777778)).toBe('35.27777778');
    expect(fmtNum(1.5e-9)).toBe('0.0000000015');
    expect(fmtNum(-0.0000000001)).toBe('-0.0000000001');
    expect(fmtNum(12345678.25)).toBe('12345678.25');
    expect(fmtNum(-0)).toBe('0');
    expect(() => fmtNum(Number.NaN)).toThrow();
    expect(() => fmtNum(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('is stable: a serialized number parses back to the same text', () => {
    for (const n of [0.003527777777777778, 1 / 3, 2.54 / 72, 123.456789012345, 1e-7])
      expect(fmtNum(Number(fmtNum(n)))).toBe(fmtNum(n));
  });

  it('round-trips through the parser', () => {
    const d = D({
      Type: N('Measure'),
      R: S('1 mm = 100 mm'),
      X: [D({ U: S('mm'), C: 35.277778, D: 100 })],
      P: new PdfRef(12),
      Q: S('sq m²'),
      Odd: N('a b/c'),
      Paren: S('a (b) \\ c'),
    });
    const text = serialize(d);
    expect(text).toContain('/Odd /a#20b#2fc');
    const back = parse(text);
    expect(serialize(back)).toBe(text);
    expect(((back as Map<string, unknown>).get('Q') as PdfString).text()).toBe('sq m²');
    expect(((back as Map<string, unknown>).get('Paren') as PdfString).text()).toBe('a (b) \\ c');
  });

  it('keeps string bytes exactly (encrypted strings are opaque bytes)', () => {
    const bytes = Uint8Array.from([0, 255, 40, 41, 92, 10]);
    const back = parse(serialize(new PdfString(bytes)));
    expect([...(back as PdfString).bytes]).toEqual([...bytes]);
  });

  it('refuses streams', () => {
    expect(() => serialize(new PdfStream(new Map(), new Uint8Array()))).toThrow(/streams/);
  });
});

describe('indirect objects', () => {
  it('parses and writes `N G obj … endobj`', () => {
    const text = '12 0 obj\r\n<< /Type /Annot /Subtype /Line >>\r\nendobj';
    const { num, gen, value } = parseIndirect(enc(text));
    expect([num, gen]).toEqual([12, 0]);
    const out = String.fromCharCode(...serializeIndirect(num, gen, value));
    expect(out).toBe('12 0 obj\n<</Type /Annot /Subtype /Line>>\nendobj');
  });

  it('refuses stream objects and truncated objects', () => {
    expect(() =>
      parseIndirect(enc('3 0 obj\n<< /Length 1 >>\nstream\nx\nendstream\nendobj')),
    ).toThrow(/streams/);
    expect(() => parseIndirect(enc('3 0 obj\n<< /A 1 >>'))).toThrow();
  });
});

describe('containsString', () => {
  it('finds strings at any depth', () => {
    expect(containsString(D({ A: [1, N('x')], B: D({ C: 2 }) }))).toBe(false);
    expect(containsString(D({ A: [1, D({ U: S('m') })] }))).toBe(true);
  });
});

describe('wire form (RPC)', () => {
  it('round-trips every value kind', () => {
    const v = D({
      Type: N('Viewport'),
      BBox: [0, 0, 100.5, 200],
      Name: S('Detail A'),
      Uni: S('Détail Ω'),
      P: new PdfRef(7, 1),
      On: true,
      Z: null,
      Measure: D({ X: [D({ U: S('mm'), C: 0.3527777778 })] }),
    });
    const j = toJson(v);
    const cloned = structuredClone(j);
    expect(serialize(fromJson(cloned))).toBe(serialize(v));
  });

  it('builds strings from text and validates hex', () => {
    expect((fromJson({ text: 'm²' }) as PdfString).text()).toBe('m²');
    expect(() => fromJson({ hex: 'zz' })).toThrow(/hex/);
    expect(() => fromJson(Number.NaN)).toThrow(/number/);
  });
});
