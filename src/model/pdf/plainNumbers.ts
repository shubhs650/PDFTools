// Numbers in exponent form ("8.74228e-08") inside a content stream (M13-04). PDF
// numbers have no exponent (ISO 32000-1 §7.3.3), yet PDFium's appearance for a
// line's endings writes the turn of an arrow that way when the line is exactly
// horizontal or upright, and then cannot read it back: the `cm` loses operands and
// the arrow head vanishes (in other viewers too). This rewrites such numbers as
// plain decimals, leaving strings, hex strings and comments alone. Pure.

/** A number with an exponent, as one whole token. */
const EXP = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/u;
const DELIMITER = /[\s()<>[\]{}/%]/u;

/** `v` as a plain PDF number: at most 6 decimals, no trailing zeros, never "-0". */
export function plainNumber(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 5e-7) return '0';
  const s = v.toFixed(6).replace(/\.?0+$/u, '');
  return s === '-0' ? '0' : s;
}

export function plainNumbers(content: string): { content: string; changed: boolean } {
  let out = '';
  let changed = false;
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i] ?? '';
    if (ch === '(') {
      // A literal string: balanced parentheses, backslash escapes.
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        const c = content[j];
        if (c === '\\') j++;
        else if (c === '(') depth++;
        else if (c === ')' && --depth === 0) break;
      }
      out += content.slice(i, j + 1);
      i = j + 1;
    } else if ((ch === '<' && content[i + 1] === '<') || (ch === '>' && content[i + 1] === '>')) {
      out += content.slice(i, i + 2);
      i += 2;
    } else if (ch === '/') {
      // A name ("/1e5" is a name, not a number).
      let j = i + 1;
      while (j < n && !DELIMITER.test(content[j] ?? ' ')) j++;
      out += content.slice(i, j);
      i = j;
    } else if (ch === '<') {
      const j = content.indexOf('>', i);
      const end = j < 0 ? n : j + 1;
      out += content.slice(i, end);
      i = end;
    } else if (ch === '%') {
      let j = i;
      while (j < n && content[j] !== '\n' && content[j] !== '\r') j++;
      out += content.slice(i, j);
      i = j;
    } else if (DELIMITER.test(ch)) {
      out += ch;
      i++;
    } else {
      let j = i;
      while (j < n && !DELIMITER.test(content[j] ?? ' ')) j++;
      const token = content.slice(i, j);
      if (EXP.test(token)) {
        out += plainNumber(Number(token));
        changed = true;
      } else out += token;
      i = j;
    }
  }
  return { content: changed ? out : content, changed };
}
