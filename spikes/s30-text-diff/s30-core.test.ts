// Spike S30 (M12-05): unit tests for the pure pieces (no PDFium).
/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices in range, in hot loops (spike code) */
import { describe, expect, it } from 'vitest';
import { compare } from './compare.ts';
import { paraUnit, type DocText, type Unit } from './doc.ts';
import { detectHf } from './hf.ts';
import { xyCut, type Item, type Line, type Word } from './layout.ts';
import { diff, matches, type Hunk } from './myers.ts';
import { normKey, numberOf, ocrFold, percentChange, tokenize } from './tokens.ts';

const keys = (s: string) => tokenize(s).map((t) => `${t.kind}:${t.key}`);

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
    expect(keys('Clause 3.4.1 applies')).toEqual(['word:Clause', 'number:3.4.1', 'word:applies']);
  });
  it('splits scripts without spaces into characters, Latin runs stay whole', () => {
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
  it('keeps combining marks with their letters', () => {
    expect(tokenize('सुरक्षा गुणांक 3.0').map((t) => t.key)).toEqual(['सुरक्षा', 'गुणांक', '3.0']);
  });
  it('normalises dashes, quotes and micro', () => {
    expect(normKey('3.4–3.9 ‘x’ μ')).toBe("3.4-3.9 'x' µ");
  });
  it('reads numbers and percent change', () => {
    expect(numberOf('$1,450.00')).toBe(1450);
    expect(numberOf('3,5 mm')).toBe(3.5);
    expect(numberOf('−12')).toBe(-12);
    expect(percentChange(1450, 1520)).toBeCloseTo(4.83, 2);
    expect(percentChange(0, 5)).toBeUndefined();
  });
  it('folds typical OCR confusions', () => {
    expect(ocrFold('5O0mm')).toBe(ocrFold('500mm'));
    expect(ocrFold('U1trasonic')).toBe(ocrFold('Ultrasonic'));
    expect(ocrFold('24bar')).not.toBe(ocrFold('30bar'));
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

const kept = (hs: Hunk[]) => hs.filter((h) => h.op === '=').reduce((s, h) => s + h.a1 - h.a0, 0);

describe('myers', () => {
  it('finds a longest common subsequence (no anchors) on random sequences', () => {
    const r = rng(7);
    for (let n = 0; n < 2000; n++) {
      const alpha = 2 + Math.floor(r() * 6);
      const a = Array.from({ length: Math.floor(r() * 30) }, () => Math.floor(r() * alpha));
      const b = Array.from({ length: Math.floor(r() * 30) }, () => Math.floor(r() * alpha));
      const ms = matches(a, b, { anchors: false });
      expect(ms.length).toBe(lcsLength(a, b));
      // Valid: increasing on both sides and equal items.
      for (let k = 0; k < ms.length; k++) {
        const [i, j] = ms[k]!;
        expect(a[i]).toBe(b[j]);
        if (k) {
          const [pi, pj] = ms[k - 1]!;
          expect(i > pi && j > pj).toBe(true);
        }
      }
    }
  });
  it('anchored matches stay close to the LCS on edited prose-like text', () => {
    // Unique anchors are a heuristic: valid, never longer than the LCS, and on
    // text with a word-like vocabulary within a few percent of it.
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
  it('hunks cover both sequences in order', () => {
    const hs = diff([1, 2, 3, 4, 5], [1, 9, 3, 4, 6, 5]);
    expect(hs.map((h) => h.op).join('')).toBe('=-+=+=');
  });
});

const item = (x0: number, y0: number, w: number, size = 9): Item => ({
  x0,
  y0,
  x1: x0 + w,
  y1: y0 + size,
  size,
});

describe('xyCut', () => {
  it('reads two columns one after the other, whatever the input order', () => {
    const left = Array.from({ length: 10 }, (_, i) => item(50, 100 + i * 12, 230));
    const right = Array.from({ length: 10 }, (_, i) => item(310, 100 + i * 12, 230));
    const rows = left.flatMap((l, i) => [l, right[i]!]);
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
    const leaves = xyCut([...marks, ...notes]);
    // Rows, not columns: each mark is read with its own note.
    expect(leaves.length).toBe(4);
  });
});

function hfLine(text: string, page: number, y: number): Line {
  const words = text.split(' ').map((t, i): Word => ({
    text: t,
    x0: 50 + i * 40,
    x1: 85 + i * 40,
    y0: y,
    y1: y + 8,
    size: 8,
    bold: false,
    invisible: false,
    rtl: false,
    base: y + 7,
    page,
  }));
  return { words, x0: 50, x1: 400, y0: y, y1: y + 8, size: 8, bold: false, rtl: false, page };
}

describe('headers and footers', () => {
  it('finds a running footer and marks the page number', () => {
    const pages = Array.from({ length: 6 }, (_, p) => [
      hfLine('Spec PS-201 Rev C', p, 30),
      hfLine(`Body text unique to page ${String(p)} goes here`, p, 300),
      hfLine(`Page ${String(p + 1)} of 6`, p, 800),
    ]);
    const { groups, lines } = detectHf(pages, Array<number>(6).fill(842));
    const foot = groups.find((g) => g.band === 'bottom');
    expect(foot?.template.join(' ')).toBe('Page {n} of 6');
    expect(groups.find((g) => g.band === 'top')?.template.join(' ')).toBe('Spec PS-201 Rev C');
    expect(lines.size).toBe(12);
  });
  it('leaves body lines alone', () => {
    const pages = Array.from({ length: 4 }, (_, p) => [
      hfLine('Top', p, 30),
      hfLine('The same body line', p, 300),
      hfLine('Bottom', p, 800),
    ]);
    const { lines } = detectHf(pages, Array<number>(4).fill(842));
    expect([...lines].every((l) => l.y0 !== 300)).toBe(true);
  });
});

const docOf = (texts: string[]): DocText => ({
  units: texts.map((t) => paraUnit(t)),
  hf: [],
  pages: 1,
  ocrPages: [],
  emptyPages: [],
  ms: { text: 0, tables: 0, order: 0, total: 0 },
});

describe('compare', () => {
  const body = (n: string, what: string) =>
    `${n} The contractor shall provide ${what} in accordance with the specification and the approved drawings.`;
  it('reports a value change inside a paragraph as one replacement with its percent change', () => {
    const A = docOf([
      'Introduction to the works.',
      'Test pressure shall be 24.0 bar(g) for 30 minutes.',
    ]);
    const B = docOf([
      'Introduction to the works.',
      'Test pressure shall be 30.0 bar(g) for 30 minutes.',
    ]);
    const { changes } = compare(A, B);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'replaced',
      a: { text: '24.0 bar(g)' },
      b: { text: '30.0 bar(g)' },
      pct: 25,
    });
  });
  it('folds clause renumbering into one entry and checks cross-references', () => {
    const subjects = ['pumps', 'valves', 'piping', 'instruments', 'cables', 'motors'];
    const A = docOf([
      ...subjects.map((s, i) => body(`3.${String(i + 1)}`, s)),
      'Defects under Clause 3.5 shall be corrected.',
    ]);
    const B = docOf([
      body('3.1', subjects[0] ?? ''),
      body('3.2', 'new heat exchangers and their supports'),
      ...subjects.slice(1).map((s, i) => body(`3.${String(i + 3)}`, s)),
      'Defects under Clause 3.6 shall be corrected.',
    ]);
    const { changes } = compare(A, B);
    const kinds = changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(['inserted', 'renumbered']);
    const ren = changes.find((c) => c.kind === 'renumbered');
    expect(ren?.a?.text).toBe('3.2–3.6');
    expect(ren?.b?.text).toBe('3.3–3.7');
  });
  it('flags a cross-reference that did not follow the renumbering', () => {
    const subjects = ['pumps', 'valves', 'piping', 'instruments'];
    const A = docOf([
      ...subjects.map((s, i) => body(`3.${String(i + 1)}`, s)),
      'Defects under Clause 3.3 shall be corrected.',
    ]);
    const B = docOf([
      body('3.1', subjects[0] ?? ''),
      body('3.2', 'new heat exchangers and their supports'),
      ...subjects.slice(1).map((s, i) => body(`3.${String(i + 3)}`, s)),
      'Defects under Clause 3.3 shall be corrected.',
    ]);
    const { changes } = compare(A, B);
    expect(changes.some((c) => c.kind === 'reference')).toBe(true);
  });
  it('reports a moved paragraph once, with the edit inside it', () => {
    const paras = Array.from(
      { length: 6 },
      (_, i) =>
        `Paragraph ${'ABCDEF'[i] ?? ''} describes the foundation design basis and the soil parameters used for item ${String(i * 7 + 3)} of the works.`,
    );
    const moved = (paras[1] ?? '').replace('item 10', 'item 12');
    const A = docOf(paras);
    const B = docOf([paras[0], paras[2], paras[3], paras[4], moved, paras[5]] as string[]);
    const { changes } = compare(A, B);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe('moved');
    expect(changes[0]?.inner?.map((c) => [c.a?.text, c.b?.text])).toEqual([['10', '12']]);
  });
  it('reports nothing for the same text split into different paragraphs', () => {
    const A = docOf(['One two three four five six.', 'Seven eight nine ten.']);
    const B = docOf(['One two three four', 'five six. Seven eight nine ten.']);
    expect(compare(A, B).changes).toEqual([]);
  });
});

// Unit fields used above; keeps the import used when the type is narrowed.
export type { Unit };
