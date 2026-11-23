// Content streams for the vector overlay's recolouring (M12-16, D-59; ADR-032,
// spike S29 route 2): a small tokenizer whose operands keep their exact bytes,
// so everything that is not a colour instruction is written back untouched.
// Pure.

export type Operand =
  | { kind: 'num'; value: number; raw: string }
  | { kind: 'name'; value: string; raw: string }
  | { kind: 'other'; raw: string };

export interface Instr {
  op: string;
  operands: Operand[];
  /** Exact bytes of the whole instruction (operands and operator). */
  raw: string;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** Latin-1 text of a content stream (one char per byte). */
export const latin1 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};

export const fromLatin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

function decodeName(raw: string): string {
  return raw
    .slice(1)
    .replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Splits a content stream into instructions. Throws on malformed input. */
export function tokenize(src: string): Instr[] {
  const out: Instr[] = [];
  const n = src.length;
  let i = 0;
  let operands: Operand[] = [];
  let start = -1;
  const code = (k: number) => src.charCodeAt(k);
  const skipWs = () => {
    for (;;) {
      while (i < n && WS.has(code(i))) i++;
      if (i < n && code(i) === 0x25) {
        while (i < n && code(i) !== 0x0a && code(i) !== 0x0d) i++;
      } else return;
    }
  };
  // Skips one composite operand (string, array, dict) and returns its end.
  const skipComposite = (): void => {
    const c = src[i];
    if (c === '(') {
      let depth = 0;
      for (; i < n; i++) {
        const ch = src[i];
        if (ch === '\\') i++;
        else if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            i++;
            return;
          }
        }
      }
      throw new Error('unterminated string');
    }
    if (c === '<' && src[i + 1] !== '<') {
      const e = src.indexOf('>', i);
      if (e < 0) throw new Error('unterminated hex string');
      i = e + 1;
      return;
    }
    if (c === '[' || (c === '<' && src[i + 1] === '<')) {
      const close = c === '[' ? ']' : '>>';
      i += c === '[' ? 1 : 2;
      for (;;) {
        skipWs();
        if (i >= n) throw new Error('unterminated array or dict');
        if (src.startsWith(close, i)) {
          i += close.length;
          return;
        }
        const ch = src[i];
        if (ch === '(' || ch === '[' || ch === '<') skipComposite();
        else if (ch === '/') {
          i++;
          while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
        } else {
          const s0 = i;
          while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
          if (i === s0) throw new Error(`unexpected "${src[i] ?? ''}"`);
        }
      }
    }
    throw new Error('not a composite');
  };
  for (;;) {
    skipWs();
    if (i >= n) break;
    if (start < 0) start = i;
    const c = src[i] ?? '';
    const t0 = i;
    if (c === '(' || c === '[' || c === '<') {
      skipComposite();
      operands.push({ kind: 'other', raw: src.slice(t0, i) });
      continue;
    }
    if (c === '/') {
      i++;
      while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
      const raw = src.slice(t0, i);
      operands.push({ kind: 'name', value: decodeName(raw), raw });
      continue;
    }
    while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
    if (i === t0) throw new Error(`unexpected "${c}" at ${String(i)}`);
    const word = src.slice(t0, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      operands.push({ kind: 'num', value: Number(word), raw: word });
      continue;
    }
    if (word === 'true' || word === 'false' || word === 'null') {
      operands.push({ kind: 'other', raw: word });
      continue;
    }
    if (word === 'BI') {
      // Inline image: the dictionary up to ID, then binary data up to EI.
      const id = src.indexOf('ID', i);
      if (id < 0) throw new Error('inline image without ID');
      let k = id + 3;
      for (;;) {
        const e = src.indexOf('EI', k);
        if (e < 0) throw new Error('inline image without EI');
        if (WS.has(code(e - 1)) && (e + 2 >= n || WS.has(code(e + 2)))) {
          i = e + 2;
          break;
        }
        k = e + 1;
      }
      out.push({ op: 'BI', operands, raw: src.slice(start, i) });
      operands = [];
      start = -1;
      continue;
    }
    out.push({ op: word, operands, raw: src.slice(start, i) });
    operands = [];
    start = -1;
  }
  if (operands.length) throw new Error('operands without an operator at the end');
  return out;
}

/** ASCII85Decode (the corpus files use it beside FlateDecode). */
export function ascii85(b: Uint8Array): Uint8Array {
  let t = latin1(b).replace(/\s/g, '');
  if (t.startsWith('<~')) t = t.slice(2);
  const end = t.indexOf('~>');
  if (end >= 0) t = t.slice(0, end);
  const out: number[] = [];
  let g: number[] = [];
  const flush = (v: number, keep: number) => {
    const bs = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bs.slice(0, keep));
  };
  for (const ch of t) {
    if (ch === 'z' && g.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    g.push(ch.charCodeAt(0) - 33);
    if (g.length === 5) {
      flush(
        g.reduce((v, x) => v * 85 + x, 0),
        4,
      );
      g = [];
    }
  }
  if (g.length) {
    const keep = g.length - 1;
    while (g.length < 5) g.push(84);
    flush(
      g.reduce((v, x) => v * 85 + x, 0),
      keep,
    );
  }
  return Uint8Array.from(out);
}
