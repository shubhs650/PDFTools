// Spike S31 (M12-06, D-65): the text comparison file's change marks — a
// stand-in word comparison (spike S30 owns the real method) and the marks
// written as standard markups with appearance streams (rule 6) on Document
// B's pages: inserted and moved words highlighted, replaced words
// highlighted with the old text in the note ("was: 1,450.00"), deleted words
// as a caret whose note holds the old text.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  N,
  PdfRef,
  PdfString,
  fmtNum,
  isDict,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { encodeLatin1 } from '../../src/workers/render/save/bytes';
import { call } from '../s29-overlay/pdfiumKit';
import { MARK_NM_PREFIX, type Mark } from './format';
import { pdfDate, type Section } from './section';

export interface Word {
  page: number;
  text: string;
  /** User space: left, bottom, right, top. */
  box: [number, number, number, number];
  line: number;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPF64: Float64Array;
}

/** Words of every page with their boxes, in PDFium's text order; a new line where PDFium breaks one. */
export function words(mod: WrappedPdfiumModule, doc: number): Word[] {
  const heap = mod.pdfium as unknown as Heap;
  const out: Word[] = [];
  const p = heap.wasmExports.malloc(32);
  let line = 0;
  try {
    const pages = call(mod, 'FPDF_GetPageCount', doc);
    for (let pg = 0; pg < pages; pg++) {
      const page = call(mod, 'FPDF_LoadPage', doc, pg);
      const tp = call(mod, 'FPDFText_LoadPage', page);
      const n = call(mod, 'FPDFText_CountChars', tp);
      let cur: Word | null = null;
      const flush = () => {
        if (cur) out.push(cur);
        cur = null;
      };
      for (let i = 0; i < n; i++) {
        const u = call(mod, 'FPDFText_GetUnicode', tp, i);
        if (u === 10 || u === 13) {
          flush();
          if (u === 10) line++;
          continue;
        }
        if (u === 32 || u === 9 || u === 0xa0 || u === 0 || u === 0xfffe) {
          flush();
          continue;
        }
        call(mod, 'FPDFText_GetCharBox', tp, i, p, p + 8, p + 16, p + 24);
        const f = p >> 3;
        const l = heap.HEAPF64[f] ?? 0;
        const r = heap.HEAPF64[f + 1] ?? 0;
        const b = heap.HEAPF64[f + 2] ?? 0;
        const t = heap.HEAPF64[f + 3] ?? 0;
        const ch = String.fromCodePoint(u);
        if (!cur) cur = { page: pg, text: ch, box: [l, b, r, t], line };
        else {
          const c: Word = cur;
          c.text += ch;
          c.box = [
            Math.min(c.box[0], l),
            Math.min(c.box[1], b),
            Math.max(c.box[2], r),
            Math.max(c.box[3], t),
          ];
        }
      }
      flush();
      line++;
      call(mod, 'FPDFText_ClosePage', tp);
      call(mod, 'FPDF_ClosePage', page);
    }
  } finally {
    heap.wasmExports.free(p);
  }
  return out;
}

interface Op {
  eq: boolean;
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** Myers' O(ND) difference with common ends trimmed; beyond `maxD` the middle is one change. */
export function myers(a: readonly string[], b: readonly string[], maxD = 4000): Op[] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const ops: Op[] = [];
  if (s > 0) ops.push({ eq: true, a0: 0, a1: s, b0: 0, b1: s });
  const n = ea - s;
  const m = eb - s;
  const mid: Op[] = [];
  if (n === 0 && m === 0) {
    /* nothing */
  } else if (n === 0 || m === 0) {
    mid.push({ eq: false, a0: s, a1: ea, b0: s, b1: eb });
  } else {
    const max = Math.min(n + m, maxD);
    const off = max + 1;
    let v: Int32Array = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && (v[off + k - 1] ?? 0) < (v[off + k + 1] ?? 0))
            ? (v[off + k + 1] ?? 0)
            : (v[off + k - 1] ?? 0) + 1;
        let y = x - k;
        while (x < n && y < m && a[s + x] === b[s + y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= n && y >= m) {
          found = d;
          break;
        }
      }
    }
    if (found < 0) {
      mid.push({ eq: false, a0: s, a1: ea, b0: s, b1: eb });
    } else {
      // Backtrack into single steps, then merge runs.
      const steps: ('=' | '-' | '+')[] = [];
      let x = n;
      let y = m;
      for (let d = found; d > 0; d--) {
        v = trace[d] ?? v;
        const k = x - y;
        const prevK =
          k === -d || (k !== d && (v[off + k - 1] ?? 0) < (v[off + k + 1] ?? 0)) ? k + 1 : k - 1;
        const px = v[off + prevK] ?? 0;
        const py = px - prevK;
        while (x > px && y > py) {
          steps.push('=');
          x--;
          y--;
        }
        steps.push(x === px ? '+' : '-');
        x = px;
        y = py;
      }
      while (x > 0 && y > 0) {
        steps.push('=');
        x--;
        y--;
      }
      steps.reverse();
      let ia = s;
      let ib = s;
      for (const st of steps) {
        const eq = st === '=';
        const last = mid.at(-1);
        const na = st === '+' ? 0 : 1;
        const nb = st === '-' ? 0 : 1;
        if (last?.eq === eq) {
          last.a1 += na;
          last.b1 += nb;
        } else mid.push({ eq, a0: ia, a1: ia + na, b0: ib, b1: ib + nb });
        ia += na;
        ib += nb;
      }
    }
  }
  ops.push(...mid);
  if (ea < a.length) ops.push({ eq: true, a0: ea, a1: a.length, b0: eb, b1: b.length });
  return ops;
}

/** Quads (x1 y1 x2 y2 x3 y3 x4 y4: top-left, top-right, bottom-left, bottom-right) per line run. */
function quadsOf(ws: readonly Word[]): Map<number, number[][]> {
  const byPage = new Map<number, number[][]>();
  let run: Word[] = [];
  const flush = () => {
    const first = run[0];
    if (!first) return;
    const l = Math.min(...run.map((w) => w.box[0]));
    const b = Math.min(...run.map((w) => w.box[1]));
    const r = Math.max(...run.map((w) => w.box[2]));
    const t = Math.max(...run.map((w) => w.box[3]));
    const list = byPage.get(first.page) ?? [];
    list.push([l, t, r, t, l, b, r, b]);
    byPage.set(first.page, list);
    run = [];
  };
  for (const w of ws) {
    const prev = run.at(-1);
    if (prev && (prev.page !== w.page || prev.line !== w.line)) flush();
    run.push(w);
  }
  flush();
  return byPage;
}

/** The marks for B: a line-level, then word-level comparison (a stand-in for S30's method). */
export function diffMarks(A: readonly Word[], B: readonly Word[]): Mark[] {
  const lines = (ws: readonly Word[]) => {
    const out: { text: string; from: number; to: number }[] = [];
    ws.forEach((w, i) => {
      const last = out.at(-1);
      if (last && ws[last.from]?.line === w.line) {
        last.text += ` ${w.text}`;
        last.to = i + 1;
      } else out.push({ text: w.text, from: i, to: i + 1 });
    });
    return out;
  };
  const la = lines(A);
  const lb = lines(B);
  const marks: Mark[] = [];
  let n = 0;
  const add = (
    kind: Mark['kind'],
    bw: readonly Word[],
    old: string | undefined,
    neu: string | undefined,
  ) => {
    for (const [page, quads] of quadsOf(bw)) {
      const m: Mark = { page: page + 1, kind, quads, nm: `${MARK_NM_PREFIX}${String(++n)}` };
      if (old !== undefined) m.old = old;
      if (neu !== undefined) m.new = neu;
      marks.push(m);
      old = undefined; // the old text once, on the first page of a change
    }
  };
  for (const op of myers(
    la.map((l) => l.text),
    lb.map((l) => l.text),
  )) {
    if (op.eq) continue;
    const aw = A.slice(la[op.a0]?.from ?? A.length, la[op.a1 - 1]?.to ?? A.length);
    const bw = B.slice(lb[op.b0]?.from ?? B.length, lb[op.b1 - 1]?.to ?? B.length);
    if (op.a1 === op.a0) aw.length = 0;
    if (op.b1 === op.b0) bw.length = 0;
    for (const w of myers(
      aw.map((x) => x.text),
      bw.map((x) => x.text),
    )) {
      if (w.eq) continue;
      const oldText = aw
        .slice(w.a0, w.a1)
        .map((x) => x.text)
        .join(' ');
      const newWords = bw.slice(w.b0, w.b1);
      if (newWords.length === 0) {
        // Deleted: a caret before the next word of B (or after the last).
        const at = bw[w.b0] ?? B[(lb[op.b1]?.from ?? B.length) - 1] ?? B[B.length - 1];
        if (!at) continue;
        const h = at.box[3] - at.box[1];
        add(
          'deleted',
          [{ ...at, box: [at.box[0] - h * 0.3, at.box[1], at.box[0] + h * 0.3, at.box[3]] }],
          oldText,
          undefined,
        );
      } else if (w.a1 === w.a0)
        add('inserted', newWords, undefined, newWords.map((x) => x.text).join(' '));
      else add('replaced', newWords, oldText, newWords.map((x) => x.text).join(' '));
    }
  }
  return marks;
}

const COLOURS: Record<Mark['kind'], [number, number, number]> = {
  inserted: [0.55, 0.9, 0.55],
  replaced: [1, 0.8, 0.3],
  moved: [0.55, 0.75, 1],
  deleted: [0.9, 0.1, 0.1],
};
const SUBJECT: Record<Mark['kind'], string> = {
  inserted: 'Inserted',
  replaced: 'Replaced',
  moved: 'Moved',
  deleted: 'Deleted',
};
const AUTHOR = 'Triya PDF comparison';
const clip = (s: string): string => (s.length > 2000 ? `${s.slice(0, 1999)}…` : s);

/** Writes the marks as standard markups on B's pages, in `sec` (an open section on B). */
export async function writeMarks(
  sec: Section,
  marks: readonly Mark[],
  when: Date,
  drop: ReadonlySet<number> = new Set(),
): Promise<number> {
  const pages = await sec.reader.pages();
  // Pages that only lose annotations (`drop`, the unsigned route) are rewritten too.
  if (drop.size > 0) {
    for (const p of pages) {
      const a = await sec.reader.resolve(p.dict.get('Annots'));
      if (!Array.isArray(a) || !a.some((r) => r instanceof PdfRef && drop.has(r.num))) continue;
      const pageNo = pages.indexOf(p) + 1;
      if (!marks.some((m) => m.page === pageNo)) {
        const pd: PdfDict = new Map(p.dict);
        pd.set(
          'Annots',
          a.filter((r) => !(r instanceof PdfRef && drop.has(r.num))),
        );
        sec.value(p.num, pd);
      }
    }
  }
  const byPage = new Map<number, Mark[]>();
  for (const m of marks) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m]);
  const date = PdfString.of(pdfDate(when));
  let written = 0;
  for (const [pageNo, list] of byPage) {
    const page = pages[pageNo - 1];
    if (!page) continue;
    const refs: PdfRef[] = [];
    for (const m of list) {
      const xs = m.quads.flatMap((q) => [q[0] ?? 0, q[2] ?? 0, q[4] ?? 0, q[6] ?? 0]);
      const ys = m.quads.flatMap((q) => [q[1] ?? 0, q[3] ?? 0, q[5] ?? 0, q[7] ?? 0]);
      const pad = 1;
      const rect = [
        Math.min(...xs) - pad,
        Math.min(...ys) - pad,
        Math.max(...xs) + pad,
        Math.max(...ys) + pad,
      ];
      const [r, g, b] = COLOURS[m.kind];
      const col = `${fmtNum(r)} ${fmtNum(g)} ${fmtNum(b)} rg`;
      let content: string;
      if (m.kind === 'deleted') {
        // A caret: a small filled wedge pointing up at the place of the deletion.
        const [x0, y0, x1, y1] = rect as [number, number, number, number];
        const mx = (x0 + x1) / 2;
        content = `${col} ${fmtNum(x0)} ${fmtNum(y0)} m ${fmtNum(mx)} ${fmtNum(y0 + (y1 - y0) * 0.6)} l ${fmtNum(x1)} ${fmtNum(y0)} l h f`;
      } else {
        content =
          `/G0 gs ${col} ` +
          m.quads
            .map(
              (q) =>
                `${fmtNum(q[0] ?? 0)} ${fmtNum(q[1] ?? 0)} m ${fmtNum(q[2] ?? 0)} ${fmtNum(q[3] ?? 0)} l ${fmtNum(q[6] ?? 0)} ${fmtNum(q[7] ?? 0)} l ${fmtNum(q[4] ?? 0)} ${fmtNum(q[5] ?? 0)} l h f`,
            )
            .join(' ');
      }
      const ap = sec.stream(
        sec.alloc(),
        new Map<string, PdfValue>([
          ['Type', N('XObject')],
          ['Subtype', N('Form')],
          ['BBox', rect],
          [
            'Resources',
            new Map<string, PdfValue>([
              [
                'ExtGState',
                new Map<string, PdfValue>([
                  [
                    'G0',
                    new Map<string, PdfValue>([
                      ['BM', N('Multiply')],
                      ['Type', N('ExtGState')],
                    ]),
                  ],
                ]),
              ],
            ]),
          ],
        ]),
        encodeLatin1(content),
      );
      const contents =
        m.kind === 'deleted'
          ? `Deleted: ${clip(m.old ?? '')}`
          : m.kind === 'replaced'
            ? `was: ${clip(m.old ?? '')}`
            : SUBJECT[m.kind];
      const d: PdfDict = new Map<string, PdfValue>([
        ['Type', N('Annot')],
        ['Subtype', N(m.kind === 'deleted' ? 'Caret' : 'Highlight')],
        ['Rect', rect],
        ['C', [r, g, b]],
        ['T', PdfString.of(AUTHOR)],
        ['Subj', PdfString.of(SUBJECT[m.kind])],
        ['Contents', PdfString.of(contents)],
        ['NM', PdfString.of(m.nm)],
        ['M', date],
        ['CreationDate', date],
        ['F', 4],
        ['P', new PdfRef(page.num, 0)],
        ['AP', new Map<string, PdfValue>([['N', ap]])],
      ]);
      if (m.kind === 'deleted') d.set('Sy', N('None'));
      else d.set('QuadPoints', m.quads.flat());
      refs.push(sec.value(sec.alloc(), d));
      written++;
    }
    const pd: PdfDict = new Map(page.dict);
    const existing = await sec.reader.resolve(pd.get('Annots'));
    const kept = (Array.isArray(existing) ? existing : []).filter(
      (r) => !(r instanceof PdfRef && drop.has(r.num)),
    );
    pd.set('Annots', [...kept, ...refs]);
    sec.value(page.num, pd);
  }
  return written;
}

/** /NM of every annotation of a page dict list (to tell marks from review comments). */
export async function annotNames(sec: Section): Promise<string[]> {
  const out: string[] = [];
  for (const p of await sec.reader.pages()) {
    const a = await sec.reader.resolve(p.dict.get('Annots'));
    for (const r of Array.isArray(a) ? a : []) {
      const d = await sec.reader.resolve(r);
      const nm = isDict(d) ? d.get('NM') : undefined;
      if (nm instanceof PdfString) out.push(nm.text());
    }
  }
  return out;
}
