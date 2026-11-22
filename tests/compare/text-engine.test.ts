// M12-17 (D-63): the text comparison engine on self-made text: tokens with
// engineering values kept whole, our own Myers, the XY-cut reading order,
// words from positioned characters (right to left, combining marks,
// generated and rotated characters), paragraphs with line-end hyphens, and
// the matching: replacements with percent change, moves with the edits inside
// them, reflow that changes nothing, marks on the page.
import { describe, expect, it } from 'vitest';
import { TEXT_GENERATED, textBytes } from '../../src/model/compare/material';
import { CompareStore } from '../../src/workers/compare/store';
import { buildDoc } from '../../src/model/compare/text/document';
import { pageLayout, wordsOf, xyCut, type Item } from '../../src/model/compare/text/layout';
import { matchText } from '../../src/model/compare/text/match';
import { Interner, diff, hunks, matches, type Hunk } from '../../src/model/compare/text/myers';
import { normKey, numberOf, percentChange, tokenize } from '../../src/model/compare/text/tokens';
import { docOf, linesText, pageTextOf, type SynthChar } from './support/textPages';

const keys = (s: string): string[] => tokenize(s).map((t) => `${t.kind}:${t.key}`);

describe('tokens', () => {
  it('keeps engineering values whole', () => {
    expect(keys('24.0 bar(g) at 280°C, ≥50 MΩ')).toEqual([
      'value:24.0bar(g)',
      'word:at',
      'value:280°C',
      'punct:,',
      'value:≥50MΩ',
    ]);
    expect(keys('Ra 3.2 µm')).toEqual(['word:Ra', 'value:3.2µm']);
    expect(keys('Ra 3.2 μm')).toEqual(['word:Ra', 'value:3.2µm']);
    expect(keys('M_Ed = 142.5 kN·m')).toEqual(['word:M_Ed', 'punct:=', 'value:142.5kN·m']);
    expect(keys('カー・ド')).toEqual(['char:カ', 'char:ー', 'char:・', 'char:ド']);
  });

  it('keeps tags, dates and money whole', () => {
    expect(keys('PO-88412-R2 on 2026-11-14 for $1,520.00')).toEqual([
      'tag:PO-88412-R2',
      'word:on',
      'date:2026-11-14',
      'word:for',
      'number:$1,520.00',
    ]);
    expect(keys('ISO 4406 code 17/15/12')).toEqual([
      'word:ISO',
      'number:4406',
      'word:code',
      'tag:17/15/12',
    ]);
    expect(keys('DOC-4410-REV2 dated 22.11.2026')).toEqual([
      'tag:DOC-4410-REV2',
      'word:dated',
      'date:22.11.2026',
    ]);
    expect(keys('Clause 3.4.1 applies')).toEqual(['word:Clause', 'number:3.4.1', 'word:applies']);
  });

  it('splits scripts without spaces into characters; Latin runs and numbers stay whole', () => {
    expect(tokenize('材質はSUS316L、板厚8.0 mm').map((t) => t.key)).toEqual([
      '材',
      '質',
      'は',
      'SUS316L',
      '、',
      '板',
      '厚',
      '8.0mm',
    ]);
  });

  it('keeps combining marks with their letters (Devanagari, Arabic)', () => {
    expect(tokenize('सुरक्षा गुणांक 3.0').map((t) => t.key)).toEqual(['सुरक्षा', 'गुणांक', '3.0']);
    expect(tokenize('الضمان ١٢ شهرًا').map((t) => t.kind)).toEqual(['word', 'word', 'word']);
  });

  it('normalises ligatures, dashes, quotes and micro', () => {
    expect(normKey('3.4–3.9 ‘x’ μ')).toBe("3.4-3.9 'x' µ");
    expect(tokenize('ﬁnal ﬂow')[0]?.key).toBe('final');
    expect(tokenize('6 mm')[0]?.key).toBe(tokenize('6mm')[0]?.key);
  });

  it('reads numbers and their percent change', () => {
    expect(numberOf('$1,450.00')).toBe(1450);
    expect(numberOf('3,5 mm')).toBe(3.5);
    expect(numberOf('−12')).toBe(-12);
    expect(percentChange(1450, 1520)).toBeCloseTo(4.83, 2);
    expect(percentChange(0, 5)).toBeUndefined();
  });
});

/** A plain DP LCS length, the reference for Myers. */
function lcsLength(a: number[], b: number[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j] ?? 0;
      dp[j] = x === b[j - 1] ? prev + 1 : Math.max(dp[j] ?? 0, dp[j - 1] ?? 0);
      prev = tmp;
    }
  }
  return dp[b.length] ?? 0;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const kept = (hs: Hunk[]): number =>
  hs.filter((h) => h.op === '=').reduce((s, h) => s + h.a1 - h.a0, 0);

describe('myers', () => {
  it('finds a longest common subsequence on 2,000 random cases', () => {
    const r = rng(7);
    for (let n = 0; n < 2000; n++) {
      const alpha = 2 + Math.floor(r() * 6);
      const a = Array.from({ length: Math.floor(r() * 30) }, () => Math.floor(r() * alpha));
      const b = Array.from({ length: Math.floor(r() * 30) }, () => Math.floor(r() * alpha));
      const ms = matches(a, b, { anchors: false });
      expect(ms.length).toBe(lcsLength(a, b));
      let pi = -1;
      let pj = -1;
      for (const [i, j] of ms) {
        expect(a[i]).toBe(b[j]);
        expect(i > pi && j > pj).toBe(true);
        pi = i;
        pj = j;
      }
    }
  });

  it('anchored matches stay within 5 % of the LCS on edited prose-like text', () => {
    const r = rng(11);
    let worst = 1;
    for (let n = 0; n < 300; n++) {
      const a = Array.from({ length: 200 }, () => Math.floor(r() ** 2 * 400));
      const b = a.filter(() => r() > 0.05).map((x) => (r() < 0.05 ? Math.floor(r() * 400) : x));
      const k = kept(diff(a, b));
      const best = lcsLength(a, b);
      expect(k).toBeLessThanOrEqual(best);
      worst = Math.min(worst, k / best);
    }
    expect(worst).toBeGreaterThan(0.95);
  });

  it('hunks cover both sequences in order, a deletion before its insertion', () => {
    expect(
      diff([1, 2, 3, 4, 5], [1, 9, 3, 4, 6, 5])
        .map((h) => h.op)
        .join(''),
    ).toBe('=-+=+=');
    expect(hunks([], 2, 0)).toEqual([{ op: '-', a0: 0, a1: 2, b0: 0, b1: 0 }]);
  });

  it('never anchors on the keys it is told to skip', () => {
    // 5 is the only unique item: as an anchor it would leave 1 match of the 4 possible.
    const a = [5, 1, 1, 2, 2];
    const b = [1, 1, 2, 2, 5];
    expect(matches(a, b)).toHaveLength(1);
    expect(matches(a, b, { noAnchor: new Set([5]) })).toHaveLength(4);
  });

  it('interns strings both ways', () => {
    const i = new Interner();
    expect([i.id('a'), i.id('b'), i.id('a')]).toEqual([0, 1, 0]);
    expect(i.key(1)).toBe('b');
    expect(i.size).toBe(2);
  });
});

const item = (x0: number, y0: number, w: number, size = 9): Item => ({
  x0,
  y0,
  x1: x0 + w,
  y1: y0 + size,
  size,
});

describe('reading order (XY-cut)', () => {
  it('reads two columns one after the other, whatever the content order', () => {
    const left = Array.from({ length: 10 }, (_, i) => item(50, 100 + i * 12, 230));
    const right = Array.from({ length: 10 }, (_, i) => item(310, 100 + i * 12, 230));
    const rows = left.flatMap((l, i) => [l, right[i] ?? l]);
    const order = xyCut(rows).flat();
    expect(order.slice(0, 10).every((i) => i.x0 === 50)).toBe(true);
    expect(order.slice(10).every((i) => i.x0 === 310)).toBe(true);
    expect(order.map((i) => i.y0).slice(0, 10)).toEqual(left.map((i) => i.y0));
  });

  it('reads right-to-left columns from the right', () => {
    const left = Array.from({ length: 5 }, (_, i) => item(50, 100 + i * 12, 230));
    const right = Array.from({ length: 5 }, (_, i) => item(310, 100 + i * 12, 230));
    expect(xyCut([...left, ...right], { rtl: true }).flat()[0]?.x0).toBe(310);
  });

  it('takes a heading across both columns first', () => {
    const head = item(50, 60, 490, 14);
    const left = Array.from({ length: 6 }, (_, i) => item(50, 100 + i * 12, 230));
    const right = Array.from({ length: 6 }, (_, i) => item(310, 100 + i * 12, 230));
    expect(xyCut([...right, ...left, head]).flat()[0]).toBe(head);
  });

  it('does not take a strip of footnote numbers for a column', () => {
    const marks = Array.from({ length: 4 }, (_, i) => item(50, 700 + i * 12, 5, 7));
    const notes = Array.from({ length: 4 }, (_, i) => item(62, 700 + i * 12, 400, 7));
    expect(xyCut([...marks, ...notes]).length).toBe(4);
  });

  it('a page stored row by row across two columns reads column by column', () => {
    const lines = [];
    for (let i = 0; i < 8; i++) {
      lines.push({ text: `left ${String(i)} alpha beta`, x: 50, y: 100 + i * 12 });
      lines.push({ text: `right ${String(i)} gamma delta`, x: 310, y: 100 + i * 12 });
    }
    const l = pageLayout(linesText(lines, 595));
    const words = Array.from({ length: l.wordSize.length }, (_, k) =>
      l.text.slice(l.wordStart[k] ?? 0, l.wordStart[k + 1] ?? 0),
    );
    expect(words.slice(0, 4)).toEqual(['left', '0', 'alpha', 'beta']);
    expect(words.indexOf('right')).toBe(32);
  });
});

/** Characters of a word at x, `w` wide each, in the order given. */
const glyphs = (text: string, x: number, w = 5, y = 100): SynthChar[] =>
  Array.from(text).map((ch, i) => ({
    code: ch.codePointAt(0) ?? 32,
    x0: x + i * w,
    y0: y,
    x1: x + (i + 1) * w,
    y1: y + 10,
  }));

describe('words from positioned characters', () => {
  it('ends a word at a gap, a baseline shift or a size jump; skips generated characters', () => {
    const t = pageTextOf([
      ...glyphs('ab', 50),
      // A generated space PDFium added: ignored, the gap decides.
      { code: 32, x0: 60, y0: 100, x1: 60, y1: 110, flags: TEXT_GENERATED },
      ...glyphs('cd', 61),
      ...glyphs('ef', 75),
      { code: 'g'.codePointAt(0) ?? 0, x0: 85, y0: 96, x1: 90, y1: 106 },
      { code: 'h'.codePointAt(0) ?? 0, x0: 90, y0: 96, x1: 95, y1: 106, size: 20 },
    ]);
    expect(wordsOf(t).map((w) => w.text)).toEqual(['abcd', 'ef', 'g', 'h']);
  });

  it('turns right-to-left letters drawn in visual order back to logical order', () => {
    // "سلام" drawn left to right: the last letter first.
    const t = pageTextOf(glyphs(Array.from('سلام').reverse().join(''), 50));
    const [w] = wordsOf(t);
    expect(w?.text).toBe('سلام');
  });

  it('keeps a combining mark with its letter even where its glyph sits apart', () => {
    // कि: the vowel sign ि is drawn left of क.
    const t = pageTextOf([
      { code: 0x915, x0: 60, y0: 100, x1: 66, y1: 110 },
      { code: 0x93f, x0: 50, y0: 100, x1: 54, y1: 110 },
    ]);
    expect(wordsOf(t).map((w) => w.text)).toEqual(['कि']);
  });

  it('leaves rotated text out of the running text', () => {
    const t = pageTextOf([
      ...glyphs('body', 50),
      ...glyphs('STAMP', 200).map((c) => ({ ...c, angle: 90 })),
    ]);
    expect(wordsOf(t).map((w) => w.text)).toEqual(['body']);
  });
});

describe('paragraphs', () => {
  it('joins line-end hyphens and keeps a paragraph across a page break when the line is full', () => {
    const intern = new Interner();
    const page1 = pageLayout(
      linesText([
        { text: 'The pump casing shall be speci\u0002', y: 100 },
        { text: 'fied by the purchaser and is well-', y: 112 },
        { text: 'known to all suppliers of the works', y: 124 },
      ]),
    );
    const page2 = pageLayout(linesText([{ text: 'and their sub-contractors.', y: 100 }]));
    const d = buildDoc([page1, page2], intern);
    expect(d.unitText).toEqual([
      // A hard hyphen at a line end before a lower-case word is taken for hyphenation.
      'The pump casing shall be specified by the purchaser and is wellknown to all suppliers of the works and their sub-contractors.',
    ]);
    expect(d.pages).toBe(2);
  });

  it('breaks at a gap, a change of size and a list item; counts empty pages', () => {
    const intern = new Interner();
    const d = buildDoc(
      [
        pageLayout(
          linesText([
            { text: '1 Scope', y: 50, size: 14 },
            { text: 'This specification covers pumps.', y: 80 },
            { text: 'a) centrifugal pumps', y: 92 },
            { text: 'b) reciprocating pumps', y: 104 },
          ]),
        ),
        pageLayout(linesText([])),
      ],
      intern,
    );
    expect(d.unitText).toEqual([
      '1 Scope',
      'This specification covers pumps.',
      'a) centrifugal pumps',
      'b) reciprocating pumps',
    ]);
    expect(d.empty).toEqual([1]);
  });
});

describe('matching', () => {
  const run = (a: string[][], b: string[][], moves?: boolean) => {
    const intern = new Interner();
    return matchText(docOf(a, intern), docOf(b, intern), moves === false ? { moves } : {});
  };

  it('reports a value change inside a paragraph as one replacement with its percent change', () => {
    const r = run(
      [['Introduction to the works.', 'Test pressure shall be 24.0 bar(g) for 30 minutes.']],
      [['Introduction to the works.', 'Test pressure shall be 30.0 bar(g) for 30 minutes.']],
    );
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({
      kind: 'replaced',
      a: { text: '24.0 bar(g)', page: 0 },
      b: { text: '30.0 bar(g)', page: 0 },
      pct: 25,
    });
    // Marked where it is: "Test pressure shall be " is 23 characters of 5 pt from x = 50.
    const rect = r.changes[0]?.b?.rects[0];
    expect(rect).toMatchObject({ page: 0, x0: 165, y0: 180, y1: 190 });
    expect(rect?.x1).toBeCloseTo(220);
    expect(r.stats.matched).toBe(1);
  });

  it('gives no percent change for words or for more than one number', () => {
    const r = run(
      [['Seat of arbitration: Mumbai, 12 or 14 days.']],
      [['Seat of arbitration: Singapore, 20 days.']],
    );
    expect(r.changes.map((c) => c.pct)).toEqual([undefined, undefined]);
  });

  it('reports insertions and deletions in reading order with their pages', () => {
    // "Bravo." ends short of the column: the paragraph does not go on over the page.
    const r = run(
      [['Alpha paragraph one.', 'Bravo.'], ['Charlie paragraph three.']],
      [['Alpha paragraph one.', 'An added note.', 'Bravo.'], []],
    );
    expect(r.changes.map((c) => [c.kind, c.a?.text ?? c.b?.text, c.a?.page ?? c.b?.page])).toEqual([
      ['inserted', 'An added note.', 0],
      ['deleted', 'Charlie paragraph three.', 1],
    ]);
    expect(r.limited).toEqual({ a: [], b: [1] });
  });

  it('reports a moved paragraph once, with the edit inside it', () => {
    const paras = Array.from(
      { length: 6 },
      (_, i) =>
        `Paragraph ${'ABCDEF'[i] ?? ''} describes the foundation design basis and the soil parameters used for item ${String(i * 7 + 3)} of the works.`,
    );
    const moved = (paras[1] ?? '').replace('item 10', 'item 12');
    const b = [paras[0], paras[2], paras[3], paras[4], moved, paras[5]] as string[];
    const r = run([paras], [b]);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]?.kind).toBe('moved');
    expect(r.changes[0]?.inner?.map((c) => [c.a?.text, c.b?.text, c.pct])).toEqual([
      ['10', '12', 20],
    ]);
    // Without moves: a deletion and an insertion, the edit hidden inside them.
    expect(run([paras], [b], false).changes.map((c) => c.kind)).toEqual(['deleted', 'inserted']);
  });

  it('reports nothing for the same text split into other paragraphs or pages', () => {
    const r = run(
      [['One two three four five six.', 'Seven eight nine ten.']],
      [['One two three four'], ['five six. Seven eight nine ten.']],
    );
    expect(r.changes).toEqual([]);
  });

  it('aligns renumbered clauses by their words, never by their unique numbers', () => {
    const body = (n: string, what: string) =>
      `${n} The contractor shall provide the ${what} in accordance with the specification and the approved drawings.`;
    const subjects = [
      'centrifugal pumps with their drivers',
      'gate valves with gear operators',
      'carbon steel piping and its supports',
      'field instruments and junction boxes',
      'power cables on ladder trays',
      'induction motors for the fans',
    ];
    const a = subjects.map((s, i) => body(`3.${String(i + 1)}`, s));
    const b = [
      body('3.1', subjects[0] ?? ''),
      body('3.2', 'shell and tube heat exchangers'),
      ...subjects.slice(1).map((s, i) => body(`3.${String(i + 3)}`, s)),
    ];
    // One page of one paragraph: a stretch the word level compares as one stream.
    const r = run([[a.join(' ')]], [[b.join(' ')]]);
    // The new clause is one insertion (where it starts is a matter of taste:
    // its words repeat the clause after it); each later number shifted once.
    const [ins, ...rest] = r.changes;
    expect(ins?.kind).toBe('inserted');
    expect(ins?.b?.text).toContain('heat exchangers');
    expect(rest.map((c) => [c.kind, c.a?.text, c.b?.text])).toEqual(
      [3, 4, 5, 6].map((n) => ['replaced', `3.${String(n)}`, `3.${String(n + 1)}`]),
    );
  });

  it('marks one character of a script without spaces, not the whole run', () => {
    const r = run([['材質はSUS304とする']], [['材料はSUS304とする']]);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ kind: 'replaced', a: { text: '質' }, b: { text: '料' } });
    const rect = r.changes[0]?.b?.rects[0];
    // The run is one word "材料はSUS304とする" (14 characters, 70 pt); 料 is its second character.
    expect(rect?.x0).toBeCloseTo(55);
    expect(rect?.x1).toBeCloseTo(60);
  });

  it('gives content sync points for every paragraph matched whole', () => {
    const r = run(
      [
        ['Alpha paragraph one.', 'Bravo.'],
        ['Charlie paragraph three.', 'Delta.'],
      ],
      [
        ['Alpha paragraph one.', 'Bravo.'],
        ['New.', 'Charlie paragraph three.', 'Delta.'],
      ],
    );
    expect(r.changes.map((c) => c.b?.text)).toEqual(['New.']);
    expect(Array.from(r.sync)).toEqual([
      0, 150, 0, 150, 0, 180, 0, 180, 1, 150, 1, 180, 1, 180, 1, 210,
    ]);
  });
});

describe('headers and footers', () => {
  /** n pages, each with a running header and footer around its own body text. */
  const doc = (n: number, rev: string, intern: Interner, of = n) =>
    buildDoc(
      Array.from({ length: n }, (_, p) =>
        pageLayout(
          linesText(
            [
              { text: `Spec PS-201 Rev ${rev}`, y: 30 },
              { text: `Body text unique to page ${String(p + 1)} goes here.`, y: 300 },
              { text: `Page ${String(p + 1)} of ${String(of)}`, y: 800 },
            ],
            595,
          ),
        ),
      ),
      intern,
    );

  it('finds a running header and footer, leaves them out of the text and masks the page number', () => {
    const d = doc(6, 'C', new Interner());
    expect(d.hf.map((g) => [g.band, g.template.join(' '), g.pages.length])).toEqual([
      ['bottom', 'Page {n} of 6', 6],
      ['top', 'Spec PS-201 Rev C', 6],
    ]);
    expect(d.unitText.every((t) => t.startsWith('Body text'))).toBe(true);
  });

  it('reports a changed header and footer once, not on every page', () => {
    const intern = new Interner();
    const r = matchText(doc(6, 'C', intern), doc(6, 'D', intern, 7));
    expect(r.changes.map((c) => [c.kind, c.a?.text, c.b?.text, c.b?.page])).toEqual([
      ['header', 'C', 'D', 0],
      ['footer', '6', '7', 0],
    ]);
    expect(r.changes[0]?.b?.rects).toHaveLength(1);
  });

  it('can be switched off: the page furniture is running text again', () => {
    const d = buildDoc(
      [
        pageLayout(linesText([{ text: 'Top', y: 30 }], 595)),
        pageLayout(linesText([{ text: 'Top', y: 30 }], 595)),
      ],
      new Interner(),
      { headersFooters: false },
    );
    expect(d.hf).toEqual([]);
    expect(d.unitText.join(' ')).toBe('Top Top');
  });
});

describe('the Compare worker store', () => {
  const page = (paras: string[]) =>
    linesText(
      paras.map((text, i) => ({ text, y: 50 + i * 30 })),
      595,
    );

  it('keeps a text comparison page as its layout, smaller than its characters', () => {
    const store = new CompareStore();
    store.open('c');
    const t = page(['A paragraph of some length to weigh.', 'And a second one, a little longer.']);
    const chars = textBytes(t);
    const bytes = store.putText('c', 'a', 0, t, true);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(chars);
    expect(store.text('c', 'a', 0)).toBeUndefined();
    expect(store.summary('c').texts).toEqual({ a: 1, b: 0 });
  });

  it('matches the pages put so far, or the pages asked for', () => {
    const store = new CompareStore();
    store.open('c');
    store.putText('c', 'a', 0, page(['Rated flow 120 m3/h at 4.0 bar.']), true);
    store.putText('c', 'b', 0, page(['Rated flow 150 m3/h at 4.0 bar.']), true);
    store.putText('c', 'b', 2, page(['A page after a gap.']), true);
    const stages = new Set<string>();
    const r = store.matchText('c', undefined, undefined, (stage) => stages.add(stage));
    expect(r.changes).toMatchObject([{ kind: 'replaced', a: { text: '120 m3/h' }, pct: 25 }]);
    expect(stages).toEqual(new Set(['read', 'match']));
    expect(() => store.matchText('c', { a: 1, b: 3 })).toThrow('page text missing');
  });
});
