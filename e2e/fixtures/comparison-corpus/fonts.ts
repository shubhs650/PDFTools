// Glyph widths (1/1000 em) of the standard 14 fonts the corpus uses, for
// ASCII 32–126 from the public font metrics, plus the WinAnsi characters the
// corpus prints. Used only to wrap and align text; close is good enough.

import type { FontKey } from './pdf.ts';

const HELV =
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584';
const HELV_BOLD =
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584';

const table = (s: string): number[] => s.split(' ').map(Number);
const WIDTHS: Record<'regular' | 'bold', number[]> = {
  regular: table(HELV),
  bold: table(HELV_BOLD),
};

/** Widths of the non-ASCII characters the corpus uses (both weights alike). */
const EXTRA: Record<string, number> = {
  Ø: 778,
  '°': 400,
  '±': 584,
  '×': 584,
  µ: 556,
  '²': 333,
  '³': 333,
  '–': 556,
  '—': 1000,
  '§': 556,
  '‘': 222,
  '’': 222,
  '“': 333,
  '”': 333,
  '•': 350,
  '€': 556,
  '\x01': 500, // fi ligature in FL
  '\x02': 500, // fl ligature in FL
};

export function charWidth(ch: string, font: FontKey): number {
  if (font === 'F3') return 600;
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) {
    const w = (font === 'F2' ? WIDTHS.bold : WIDTHS.regular)[code - 32];
    if (w !== undefined) return w;
  }
  return EXTRA[ch] ?? 556;
}

export function textWidth(s: string, font: FontKey, size: number): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, font);
  return (w * size) / 1000;
}

/** Unicode → WinAnsi code points for the characters above 0x7e that differ from Latin-1. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
};

/** A PDF literal string in WinAnsi (every character the corpus prints is in it). */
export function winAnsi(s: string): string {
  let out = '(';
  for (const ch of s) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`not in WinAnsi: ${ch}`);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `${out})`;
}
