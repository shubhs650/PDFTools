// Optional content groups ("layers") read from a PDF's bytes (M2-11,
// ADR-012 decision 5 option 1: a list-only pane; PDFium can't toggle them).
// A small read-only scanner, not an object model: it finds the catalog's
// /OCProperties, the /OCG objects and their names, in plain objects and in
// object streams (inflated by the caller). Unencrypted files only (their
// strings and streams are encrypted). Pure but for the injected inflate.

export interface Layer {
  name: string;
  /** Visible in the document's default configuration (/D). */
  on: boolean;
}

export interface LayerList {
  encrypted: boolean;
  layers: Layer[];
}

export type Inflate = (bytes: Uint8Array) => Promise<Uint8Array>;

const latin1 = (u8: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x4000)
    out += String.fromCharCode(...u8.subarray(i, i + 0x4000));
  return out;
};
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Every index of `needle` in `hay`. */
function indexesOf(hay: Uint8Array, needle: Uint8Array): number[] {
  const out: number[] = [];
  const first = needle[0];
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    if (hay[i] !== first) continue;
    for (let k = 1; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    out.push(i);
  }
  return out;
}

const isDigit = (b: number | undefined): boolean => b !== undefined && b >= 48 && b <= 57;

/** The text of every plain (not compressed) object "n g obj … endobj", by number (last wins). */
function plainObject(bytes: Uint8Array, num: number): string | null {
  const hits = indexesOf(bytes, ascii(`${String(num)} 0 obj`)).filter(
    (i) => !isDigit(bytes[i - 1]),
  );
  const at = hits[hits.length - 1];
  if (at === undefined) return null;
  const text = latin1(bytes.subarray(at, at + 65536));
  const end = text.indexOf('endobj');
  return end > 0 ? text.slice(0, end) : text;
}

/** The balanced `<< … >>` starting at or after `from` in `text`. */
export function dictAt(text: string, from: number): string | null {
  const start = text.indexOf('<<', from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '(') {
      // Skip a literal string (balanced parentheses, backslash escapes).
      let p = 1;
      for (i++; i < text.length && p > 0; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '(') p++;
        else if (text[i] === ')') p--;
      }
      i--;
    } else if (c === '<' && text[i + 1] === '<') {
      depth++;
      i++;
    } else if (c === '>' && text[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Object numbers in the array after `key` in `dict` (e.g. /OCGs [3 0 R 4 0 R]). */
export function refsIn(dict: string, key: string): number[] {
  const m = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((r) => Number(r[1]));
}

/** A PDF text string from its literal `( … )` or hex `< … >` form. */
export function decodeString(raw: string): string {
  let bytes: number[];
  if (raw.startsWith('<')) {
    const hex = raw.slice(1, -1).replace(/\s+/g, '');
    bytes = [];
    for (let i = 0; i < hex.length; i += 2)
      bytes.push(parseInt(hex.slice(i, i + 2).padEnd(2, '0'), 16));
  } else {
    bytes = [];
    const s = raw.slice(1, -1);
    for (let i = 0; i < s.length; i++) {
      const c = s[i] ?? '';
      if (c !== '\\') {
        bytes.push(c.charCodeAt(0));
        continue;
      }
      const n = s[++i] ?? '';
      const esc: Record<string, number> = {
        n: 10,
        r: 13,
        t: 9,
        b: 8,
        f: 12,
        '(': 40,
        ')': 41,
        '\\': 92,
      };
      if (n in esc) bytes.push(esc[n] ?? 0);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) oct += s[++i] ?? '';
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (n === '\r' || n === '\n') {
        if (n === '\r' && s[i + 1] === '\n') i++;
      } else bytes.push(n.charCodeAt(0));
    }
  }
  const u8 = Uint8Array.from(bytes);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  return String.fromCharCode(...u8);
}

function nameOf(objText: string): string {
  const m = /\/Name\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/.exec(objText);
  return m?.[1] ? decodeString(m[1]) : '';
}

/** Objects inside the file's object streams, by number. */
async function streamObjects(bytes: Uint8Array, inflate: Inflate): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const at of indexesOf(bytes, ascii('/ObjStm'))) {
    const base = Math.max(0, at - 512);
    const head = latin1(bytes.subarray(base, at + 512));
    // The "n 0 obj" before this /ObjStm key (not an "obj" in the stream after it).
    const rel = head.lastIndexOf(' obj', at - base);
    const dict = dictAt(head, Math.max(0, rel));
    if (!dict?.includes('/FlateDecode')) continue;
    const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const length = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1] ?? NaN);
    const s = head.indexOf('stream', head.indexOf(dict) + dict.length);
    if (s < 0) continue;
    let start = base + s + 6;
    if (bytes[start] === 13) start++;
    if (bytes[start] === 10) start++;
    const end = Number.isFinite(length)
      ? start + length
      : indexesOf(bytes.subarray(start, start + 16 * 1024 * 1024), ascii('endstream'))[0];
    if (end === undefined) continue;
    let data: Uint8Array;
    try {
      data = await inflate(bytes.subarray(start, Number.isFinite(length) ? end : start + end));
    } catch {
      continue;
    }
    const text = latin1(data);
    const pairs = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = pairs[i * 2];
      const off = pairs[i * 2 + 1];
      const next = pairs[i * 2 + 3];
      if (num === undefined || off === undefined) continue;
      out.set(num, text.slice(first + off, next === undefined ? undefined : first + next));
    }
  }
  return out;
}

/** The document's layers in display order (/D /Order, else /OCGs). */
export async function readLayers(bytes: Uint8Array, inflate: Inflate): Promise<LayerList> {
  const hasEncrypt = indexesOf(bytes, ascii('/Encrypt')).some(
    (i) => !/[A-Za-z]/.test(String.fromCharCode(bytes[i + 8] ?? 32)),
  );
  if (hasEncrypt) return { encrypted: true, layers: [] };
  const packed = await streamObjects(bytes, inflate);
  const object = (num: number): string | null => plainObject(bytes, num) ?? packed.get(num) ?? null;

  // /OCProperties: in a plain catalog, or in a packed one.
  let props: string | null = null;
  const sources = [
    ...indexesOf(bytes, ascii('/OCProperties')).map((i) => latin1(bytes.subarray(i, i + 65536))),
    ...[...packed.values()]
      .filter((t) => t.includes('/OCProperties'))
      .map((t) => t.slice(t.indexOf('/OCProperties'))),
  ];
  for (const text of sources) {
    const ref = /^\/OCProperties\s*(\d+)\s+\d+\s+R/.exec(text);
    const dict = ref?.[1] ? dictAt(object(Number(ref[1])) ?? '', 0) : dictAt(text, 0);
    if (dict?.includes('/OCGs')) props = dict;
  }
  if (!props) return { encrypted: false, layers: [] };

  const all = refsIn(props, 'OCGs');
  const dIndex = props.indexOf('/D');
  const d = dIndex >= 0 ? (dictAt(props, dIndex) ?? '') : '';
  const baseOff = /\/BaseState\s*\/OFF/.test(d);
  const off = new Set(refsIn(d, 'OFF'));
  const on = new Set(refsIn(d, 'ON'));
  // /Order may nest arrays; its refs in reading order, then any OCG it leaves out.
  const orderText = /\/Order\s*\[/.exec(d) ? d.slice(d.indexOf('/Order')) : '';
  let depth = 0;
  let end = orderText.length;
  for (let i = orderText.indexOf('['); i < orderText.length; i++) {
    if (orderText[i] === '[') depth++;
    else if (orderText[i] === ']' && --depth === 0) {
      end = i;
      break;
    }
  }
  const ordered = [...orderText.slice(0, end).matchAll(/(\d+)\s+\d+\s+R/g)].map((m) =>
    Number(m[1]),
  );
  const seq = [...new Set([...ordered.filter((n) => all.includes(n)), ...all])];
  return {
    encrypted: false,
    layers: seq.map((num) => ({
      name: nameOf(object(num) ?? ''),
      on: baseOff ? on.has(num) : !off.has(num),
    })),
  };
}
