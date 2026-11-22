// A small typesetter for the text-comparison documents: wrapped and justified
// paragraphs, hyphenation at marked points (`~` in the source word), the fi
// and fl ligatures, numbered footnotes (`{fn:text}`), headings, page breaks and
// running headers and footers. Units are points.

import { textWidth, winAnsi } from './fonts.ts';
import { num, type FontKey } from './pdf.ts';

export interface PageSetup {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const A4: PageSetup = {
  width: 595.28,
  height: 841.89,
  top: 72,
  bottom: 64,
  left: 64,
  right: 64,
};

export interface ParaOptions {
  font?: FontKey;
  size?: number;
  leading?: number;
  justify?: boolean;
  indent?: number;
  spaceAfter?: number;
  /** Draw fi and fl as ligature glyphs (this paragraph only). */
  ligatures?: boolean;
}

interface Word {
  text: string;
  /** Hyphenation points: indexes into `text` where a break may go. */
  hyph: number[];
  /** Footnote number printed as a superscript after the word. */
  fn?: number;
}

interface Line {
  words: Word[];
  /** The last word was cut at a hyphenation point. */
  hyphenated: boolean;
}

export class Flow {
  readonly pages: string[][] = [];
  private y = 0;
  private notes: { n: number; text: string }[] = [];
  private reserved = 0;
  private fnCount = 0;
  private readonly fnTexts = new Map<number, string>();
  /** Footnote style. */
  private readonly fnSize = 7.5;
  private readonly fnLeading = 9.5;

  readonly setup: PageSetup;
  private readonly docLigatures: boolean;

  constructor(setup: PageSetup, docLigatures = false) {
    this.setup = setup;
    this.docLigatures = docLigatures;
    this.newPage();
  }

  get page(): string[] {
    const p = this.pages[this.pages.length - 1];
    if (!p) throw new Error('no page');
    return p;
  }

  /** Page numbers (from 1) where named places landed, for the manifest. */
  readonly marks = new Map<string, number>();

  mark(key: string): void {
    this.marks.set(key, this.pages.length);
  }

  get cursor(): number {
    return this.y;
  }

  get contentWidth(): number {
    return this.setup.width - this.setup.left - this.setup.right;
  }

  newPage(): void {
    if (this.pages.length) this.flushNotes();
    this.pages.push([]);
    this.y = this.setup.height - this.setup.top;
  }

  /** Room left on this page above the footnotes. */
  room(): number {
    return this.y - this.setup.bottom - this.reserved;
  }

  /** Starts a new page unless `h` points still fit. */
  ensure(h: number): void {
    if (this.room() < h) this.newPage();
  }

  skip(h: number): void {
    this.y -= h;
  }

  raw(ops: string): void {
    this.page.push(ops);
  }

  heading(text: string, size = 12, spaceBefore = 10): void {
    if (this.y < this.setup.height - this.setup.top - 1) this.y -= spaceBefore;
    this.ensure(size * 1.3 + 3 * 13);
    this.y -= size;
    this.raw(
      `BT /F2 ${num(size)} Tf ${num(this.setup.left)} ${num(this.y)} Td ${winAnsi(text)} Tj ET`,
    );
    this.y -= size * 0.5;
  }

  para(text: string, o: ParaOptions = {}): void {
    const font = o.font ?? 'F1';
    const size = o.size ?? 10;
    const leading = o.leading ?? size * 1.3;
    const lig = (o.ligatures ?? this.docLigatures) && font === 'F1';
    const indent = o.indent ?? 0;
    const words = this.parse(text);
    const lines = this.wrap(words, font, size, this.contentWidth - indent, lig);
    lines.forEach((line, i) => {
      const fns = line.words.filter((w) => w.fn !== undefined);
      let need = leading;
      for (const w of fns) {
        const note = this.noteText(w.fn ?? 0);
        need += this.noteHeight(note, lig) + (this.notes.length === 0 ? 10 : 0);
      }
      if (this.room() < need) this.newPage();
      for (const w of fns) {
        const note = this.noteText(w.fn ?? 0);
        this.reserved += this.noteHeight(note, lig) + (this.notes.length === 0 ? 10 : 0);
        this.notes.push({ n: w.fn ?? 0, text: note });
      }
      this.y -= leading;
      const last = i === lines.length - 1;
      this.renderLine(
        line,
        font,
        size,
        this.setup.left + indent,
        this.y,
        this.contentWidth - indent,
        !!o.justify && !last,
        lig,
      );
    });
    this.y -= o.spaceAfter ?? size * 0.6;
  }

  /** Finishes the last page and returns one content stream per page. */
  finish(headerFooter?: (page: number, total: number) => string): string[] {
    this.flushNotes();
    const total = this.pages.length;
    return this.pages.map((ops, i) =>
      [...ops, headerFooter ? headerFooter(i + 1, total) : ''].join('\n'),
    );
  }

  // --- internals -----------------------------------------------------------

  private noteText(n: number): string {
    return this.fnTexts.get(n) ?? '';
  }

  private parse(text: string): Word[] {
    const words: Word[] = [];
    // Footnotes attach to the word before them.
    const re = /\{fn:([^}]*)\}/g;
    let src = '';
    let lastIdx = 0;
    const marks: { pos: number; text: string }[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
      src += text.slice(lastIdx, m.index);
      marks.push({ pos: src.length, text: m[1] ?? '' });
      lastIdx = m.index + m[0].length;
    }
    src += text.slice(lastIdx);
    let pos = 0;
    for (const raw of src.split(' ')) {
      const start = pos;
      pos += raw.length + 1;
      if (!raw) continue;
      const hyph: number[] = [];
      let t = '';
      for (const ch of raw) {
        if (ch === '~') hyph.push(t.length);
        else t += ch;
      }
      const word: Word = { text: t, hyph };
      const mark = marks.find((mk) => mk.pos === start + raw.length);
      if (mark) {
        this.fnCount++;
        word.fn = this.fnCount;
        this.fnTexts.set(this.fnCount, mark.text);
      }
      words.push(word);
    }
    return words;
  }

  private wordWidth(w: Word, font: FontKey, size: number, lig: boolean): number {
    let width = textWidth(lig ? ligate(w.text) : w.text, font, size);
    if (w.fn !== undefined) width += textWidth(String(w.fn), font, size * 0.62);
    return width;
  }

  private wrap(words: Word[], font: FontKey, size: number, width: number, lig: boolean): Line[] {
    const lines: Line[] = [];
    const space = textWidth(' ', font, size);
    let cur: Word[] = [];
    let used = 0;
    const queue = [...words];
    while (queue.length) {
      const w = queue.shift();
      if (!w) break;
      const ww = this.wordWidth(w, font, size, lig);
      const add = (cur.length ? space : 0) + ww;
      if (used + add <= width || cur.length === 0) {
        cur.push(w);
        used += add;
        continue;
      }
      // Try the last hyphenation point that still fits.
      let split = false;
      for (let k = w.hyph.length - 1; k >= 0; k--) {
        const at = w.hyph[k] ?? 0;
        const head: Word = { text: `${w.text.slice(0, at)}-`, hyph: [] };
        if (used + space + this.wordWidth(head, font, size, lig) <= width) {
          cur.push(head);
          lines.push({ words: cur, hyphenated: true });
          const tail: Word = {
            text: w.text.slice(at),
            hyph: w.hyph.slice(k + 1).map((h) => h - at),
            ...(w.fn !== undefined ? { fn: w.fn } : {}),
          };
          queue.unshift(tail);
          split = true;
          break;
        }
      }
      if (split) {
        cur = [];
        used = 0;
        continue;
      }
      lines.push({ words: cur, hyphenated: false });
      cur = [w];
      used = ww;
    }
    if (cur.length) lines.push({ words: cur, hyphenated: false });
    return lines;
  }

  private renderLine(
    line: Line,
    font: FontKey,
    size: number,
    x: number,
    y: number,
    width: number,
    justify: boolean,
    lig: boolean,
  ): void {
    const f: FontKey = lig ? 'FL' : font;
    const space = textWidth(' ', font, size);
    const natural =
      line.words.reduce((s, w) => s + this.wordWidth(w, font, size, lig), 0) +
      space * (line.words.length - 1);
    const gaps = line.words.length - 1;
    const tw = justify && gaps > 0 ? (width - natural) / gaps : 0;
    let ops = `BT /${f} ${num(size)} Tf ${num(tw)} Tw ${num(x)} ${num(y)} Td`;
    let run = '';
    const flush = () => {
      if (run) ops += ` ${winAnsi(run)} Tj`;
      run = '';
    };
    line.words.forEach((w, i) => {
      run += (i ? ' ' : '') + (lig ? ligate(w.text) : w.text);
      if (w.fn !== undefined) {
        flush();
        ops += ` /${f} ${num(size * 0.62)} Tf ${num(size * 0.38)} Ts ${winAnsi(String(w.fn))} Tj /${f} ${num(size)} Tf 0 Ts`;
      }
    });
    flush();
    this.raw(`${ops} 0 Tw ET`);
  }

  private noteHeight(text: string, lig: boolean): number {
    const lines = this.wrap(this.plainWords(text), 'F1', this.fnSize, this.contentWidth - 10, lig);
    return lines.length * this.fnLeading + 2;
  }

  private plainWords(text: string): Word[] {
    return text
      .split(' ')
      .filter(Boolean)
      .map((t) => ({ text: t.replace(/~/g, ''), hyph: [] }));
  }

  private flushNotes(): void {
    if (!this.notes.length) return;
    const lig = this.docLigatures;
    let y = this.setup.bottom + this.reserved - 10;
    this.raw(
      `0 G 0.5 w ${num(this.setup.left)} ${num(y + 6)} m ${num(this.setup.left + 120)} ${num(y + 6)} l S`,
    );
    for (const n of this.notes) {
      const lines = this.wrap(
        this.plainWords(n.text),
        'F1',
        this.fnSize,
        this.contentWidth - 10,
        lig,
      );
      y -= this.fnLeading;
      this.raw(
        `BT /F1 ${num(this.fnSize * 0.7)} Tf ${num(this.fnSize * 0.35)} Ts ${num(this.setup.left)} ${num(y)} Td ${winAnsi(String(n.n))} Tj 0 Ts ET`,
      );
      lines.forEach((l, i) => {
        if (i) y -= this.fnLeading;
        this.renderLine(
          l,
          'F1',
          this.fnSize,
          this.setup.left + 10,
          y,
          this.contentWidth - 10,
          false,
          lig,
        );
      });
    }
    this.notes = [];
    this.reserved = 0;
  }
}

/** fi and fl as the ligature codes of font FL. */
export function ligate(s: string): string {
  return s.replace(/fi/g, '\x01').replace(/fl/g, '\x02');
}

/** A running header (left and right) and footer (centre) in 8 pt Helvetica. */
export function headerFooter(
  setup: PageSetup,
  left: string,
  right: string,
  footer: string,
): string {
  const yH = setup.height - 40;
  const yF = 34;
  const rw = textWidth(right, 'F1', 8);
  const fw = textWidth(footer, 'F1', 8);
  return [
    `BT /F1 8 Tf ${num(setup.left)} ${num(yH)} Td ${winAnsi(left)} Tj ET`,
    `BT /F1 8 Tf ${num(setup.width - setup.right - rw)} ${num(yH)} Td ${winAnsi(right)} Tj ET`,
    `0 G 0.4 w ${num(setup.left)} ${num(yH - 5)} m ${num(setup.width - setup.right)} ${num(yH - 5)} l S`,
    `BT /F1 8 Tf ${num((setup.width - fw) / 2)} ${num(yF)} Td ${winAnsi(footer)} Tj ET`,
  ].join('\n');
}
