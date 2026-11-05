// A text comment's text colour apart from its border colour (ADR-024). Pure.
//
// Storage follows Acrobat and PDF-XChange: `/DA`'s `rg` is the border (and
// callout line) colour, the text colour is in the `/DS` default style string
// (`color:#0000FF`). PDFium draws the text in `/DA`'s colour, so the Render
// worker recolours the text in PDFium's own appearance: `recolorText` changes
// the one fill colour operator inside each `BT … ET` block and nothing else.

/** PdfStandardFont 0 … 11 as /DS names them: [family, bold, italic]. */
const DS_FONTS: readonly (readonly [string, boolean, boolean])[] = [
  ['Courier', false, false],
  ['Courier', true, false],
  ['Courier', true, true],
  ['Courier', false, true],
  ['Helvetica', false, false],
  ['Helvetica', true, false],
  ['Helvetica', true, true],
  ['Helvetica', false, true],
  ['Times', false, false],
  ['Times', true, false],
  ['Times', true, true],
  ['Times', false, true],
];

const ALIGN = ['left', 'center', 'right'] as const;

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** `#rrggbb` (or `#rgb`) → `#RRGGBB`; null when it is not a colour. */
export function normalizeHex(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(hex.trim());
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toUpperCase()}`;
}

/**
 * The `/DS` string for a text comment, as Acrobat writes it:
 * `font: bold Helvetica 12pt; text-align:left; color:#0000FF`.
 */
export function defaultStyleString(o: {
  fontFamily?: number | undefined;
  fontSize?: number | undefined;
  textAlign?: number | undefined;
  color: string;
}): string {
  const [family, bold, italic] = DS_FONTS[o.fontFamily ?? 4] ?? ['Helvetica', false, false];
  const weight = [bold ? 'bold' : '', italic ? 'italic' : ''].filter(Boolean).join(' ');
  const size = typeof o.fontSize === 'number' && o.fontSize > 0 ? o.fontSize : 12;
  const align = ALIGN[o.textAlign ?? 0] ?? 'left';
  const color = normalizeHex(o.color) ?? '#000000';
  return `font: ${weight ? `${weight} ` : ''}${family} ${fmt(size)}pt; text-align:${align}; color:${color}`;
}

/** The text colour in a `/DS` string (`color:#RRGGBB`), or null. */
export function colorFromDefaultStyle(ds: string | undefined): string | null {
  if (!ds) return null;
  const hex = /(?:^|[;\s])color\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/iu.exec(ds)?.[1];
  if (hex) return normalizeHex(hex);
  const rgb =
    /(?:^|[;\s])color\s*:\s*rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/iu.exec(ds);
  if (!rgb) return null;
  const parts = rgb.slice(1, 4).map((v) => Math.min(255, Number(v)));
  return normalizeHex(`#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
}

// ------------------------------------------------------------ content streams

interface Token {
  /** An operator, or null for an operand. */
  op: string | null;
  text: string;
  start: number;
  end: number;
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

/** Content-stream tokens (operands and operators); strings and comments are skipped over whole. */
function tokens(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (WS.has(c)) {
      i++;
      continue;
    }
    const start = i;
    const ch = s[i];
    if (ch === '%') {
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (ch === '(') {
      let depth = 0;
      for (; i < n; i++) {
        const d = s[i];
        if (d === '\\') i++;
        else if (d === '(') depth++;
        else if (d === ')' && --depth === 0) break;
      }
      i++;
    } else if (ch === '<' && s[i + 1] === '<') i += 2;
    else if (ch === '>' && s[i + 1] === '>') i += 2;
    else if (ch === '<') {
      while (i < n && s[i] !== '>') i++;
      i++;
    } else if (ch === '[' || ch === ']' || ch === '{' || ch === '}') i++;
    else if (ch === '/') {
      i++;
      while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
    } else {
      while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
      if (i === start) i++;
    }
    const text = s.slice(start, i);
    const isOp = /^[A-Za-z'"*][A-Za-z0-9'"*]*$/u.test(text) && !/^(?:true|false|null)$/u.test(text);
    out.push({ op: isOp ? text : null, text, start, end: i });
  }
  return out;
}

/** Fill colour operators and how many numeric operands each takes (`sc`/`scn` vary). */
const FILL_OPS: Readonly<Record<string, number>> = { g: 1, rg: 3, k: 4 };
const OTHER_FILL = new Set(['sc', 'scn', 'cs']);

export type RecolorResult =
  { ok: true; content: string; changed: boolean } | { ok: false; reason: 'no-text' | 'unexpected' };

const channel = (v: string): number => Math.round(Math.min(1, Math.max(0, Number(v))) * 255);

function sameColor(op: string, operands: readonly string[], rgb: readonly number[]): boolean {
  if (op === 'rg') return operands.every((v, i) => channel(v) === rgb[i]);
  if (op === 'g') return rgb.every((c) => c === channel(operands[0] ?? '0'));
  return false;
}

/**
 * PDFium's appearance content with the text drawn in `hex`: in each
 * `BT … ET` block, its one fill colour operator (`g`, `rg` or `k`) becomes
 * `r g b rg`. Anything else (no text, no or several colour operators in a
 * block, a colour space operator) is "unexpected": the caller keeps PDFium's
 * appearance. `changed` is false when the text already has that colour.
 */
export function recolorText(content: string, hex: string): RecolorResult {
  const color = normalizeHex(hex);
  if (!color) return { ok: false, reason: 'unexpected' };
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const toks = tokens(content);
  const edits: { start: number; end: number }[] = [];
  let blocks = 0;
  let changed = false;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]?.op !== 'BT') continue;
    blocks++;
    let found: { op: string; at: number } | null = null;
    let j = i + 1;
    for (; j < toks.length && toks[j]?.op !== 'ET'; j++) {
      const op = toks[j]?.op;
      if (!op) continue;
      if (OTHER_FILL.has(op)) return { ok: false, reason: 'unexpected' };
      if (op in FILL_OPS) {
        if (found) return { ok: false, reason: 'unexpected' };
        found = { op, at: j };
      }
    }
    if (j >= toks.length || !found) return { ok: false, reason: 'unexpected' };
    const count = FILL_OPS[found.op] ?? 0;
    const operands = toks.slice(found.at - count, found.at);
    if (
      found.at - count <= i ||
      operands.length !== count ||
      operands.some((t) => t.op !== null || !Number.isFinite(Number(t.text)))
    )
      return { ok: false, reason: 'unexpected' };
    const first = operands[0];
    const opTok = toks[found.at];
    if (!first || !opTok) return { ok: false, reason: 'unexpected' };
    if (
      !sameColor(
        found.op,
        operands.map((t) => t.text),
        rgb,
      )
    )
      changed = true;
    edits.push({ start: first.start, end: opTok.end });
    i = j;
  }
  if (blocks === 0) return { ok: false, reason: 'no-text' };
  if (!changed) return { ok: true, content, changed: false };
  const op = `${rgb.map((c) => String(Math.round((c / 255) * 10000) / 10000)).join(' ')} rg`;
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += content.slice(at, e.start) + op;
    at = e.end;
  }
  return { ok: true, content: out + content.slice(at), changed: true };
}
