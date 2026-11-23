// A text comparison file's change marks (M12-20, D-65, ADR-032 decision 2):
// standard markups with appearance streams (rule 6) on Document B's pages, in
// the section our object layer appends to B. Inserted, moved and replaced
// text is highlighted (Multiply), replaced text with the old text in its note
// ("was: 1,450.00"), deleted text gets a red caret at its place with the old
// text in its note, a changed figure a frame. The words of the notes come from
// the main thread (localized, rule 11). Every mark carries /NM triya-cmp-<n>,
// so Triya PDF never reads one back as a comment.
import { MARK_NM_PREFIX, type StoredMark } from '../../../model/compare/file/format';
import type { MarkSpec } from '../../../model/compare/file/textMarks';
import {
  N,
  PdfRef,
  PdfString,
  fmtNum,
  type PdfDict,
  type PdfValue,
} from '../../../model/pdf/objects';
import { encodeLatin1 } from '../../render/save/bytes';
import { apply, invert, pageBox, visual, type Mat } from '../transfer';
import { pdfDate, textString, type Section } from './section';

export type { MarkSpec };

/** Longest note text written (a whole deleted chapter stays readable in its data). */
const MAX_NOTE = 2000;
const clip = (s: string): string => (s.length > MAX_NOTE ? `${s.slice(0, MAX_NOTE - 1)}…` : s);

const n = (v: number): string => fmtNum(Math.round(v * 1000) / 1000);

/** The rectangle's quadrilateral in user space: top-left, top-right, bottom-left, bottom-right. */
function quadOf(r: readonly number[], toUser: Mat): number[] {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = r;
  return [
    ...apply(toUser, x0, y0),
    ...apply(toUser, x1, y0),
    ...apply(toUser, x0, y1),
    ...apply(toUser, x1, y1),
  ].map((v) => Math.round(v * 1000) / 1000);
}

function boundsOf(quads: readonly number[][], pad: number): [number, number, number, number] {
  const xs = quads.flatMap((q) => [q[0] ?? 0, q[2] ?? 0, q[4] ?? 0, q[6] ?? 0]);
  const ys = quads.flatMap((q) => [q[1] ?? 0, q[3] ?? 0, q[5] ?? 0, q[7] ?? 0]);
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
}

const multiply = (): PdfDict =>
  new Map<string, PdfValue>([
    [
      'ExtGState',
      new Map<string, PdfValue>([
        [
          'G0',
          new Map<string, PdfValue>([
            ['Type', N('ExtGState')],
            ['BM', N('Multiply')],
          ]),
        ],
      ]),
    ],
  ]);

/** The appearance's content: filled quads, a caret wedge or a frame, in user space. */
function contentOf(spec: MarkSpec, quads: number[][], rect: number[]): string {
  const [r, g, b] = spec.colour;
  const fill = `${n(r)} ${n(g)} ${n(b)} rg`;
  if (spec.shape === 'caret') {
    // A wedge pointing up at the place of the deletion (the caret's own rectangle).
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
    const mx = (x0 + x1) / 2;
    return `${fill} ${n(x0)} ${n(y0)} m ${n(mx)} ${n(y0 + (y1 - y0) * 0.7)} l ${n(x1)} ${n(y0)} l h f`;
  }
  if (spec.shape === 'frame') {
    const stroke = `${n(r)} ${n(g)} ${n(b)} RG 1.5 w`;
    return `${stroke} ${quads
      .map(
        (q) =>
          `${n(q[4] ?? 0)} ${n(q[5] ?? 0)} m ${n(q[6] ?? 0)} ${n(q[7] ?? 0)} l ${n(q[2] ?? 0)} ${n(q[3] ?? 0)} l ${n(q[0] ?? 0)} ${n(q[1] ?? 0)} l h S`,
      )
      .join(' ')}`;
  }
  return `/G0 gs ${fill} ${quads
    .map(
      (q) =>
        `${n(q[0] ?? 0)} ${n(q[1] ?? 0)} m ${n(q[2] ?? 0)} ${n(q[3] ?? 0)} l ${n(q[6] ?? 0)} ${n(q[7] ?? 0)} l ${n(q[4] ?? 0)} ${n(q[5] ?? 0)} l h f`,
    )
    .join(' ')}`;
}

export interface WrittenMarks {
  marks: StoredMark[];
  /** Page objects rewritten (their /Annots grew). */
  pages: number;
}

/**
 * Writes the marks as standard markups on B's pages in `sec` (an open section
 * on B). `drop`: annotation object numbers to take off the pages (the unsigned
 * copy's signature widgets); a page that only loses some is rewritten too.
 */
export async function writeMarks(
  sec: Section,
  specs: readonly MarkSpec[],
  opts: { when: Date; author: string; drop?: ReadonlySet<number> },
): Promise<WrittenMarks> {
  const drop = opts.drop ?? new Set<number>();
  const pages = await sec.reader.pages();
  const byPage = new Map<number, MarkSpec[]>();
  for (const m of specs) {
    if (!pages[m.page] || m.rects.length === 0) continue;
    const list = byPage.get(m.page) ?? [];
    list.push(m);
    byPage.set(m.page, list);
  }
  const touched = new Set(byPage.keys());
  if (drop.size > 0) {
    for (const [i, p] of pages.entries()) {
      const a = await sec.reader.resolve(p.dict.get('Annots'));
      if (Array.isArray(a) && a.some((r) => r instanceof PdfRef && drop.has(r.num))) touched.add(i);
    }
  }
  const date = PdfString.of(pdfDate(opts.when));
  const author = textString(opts.author);
  const out: StoredMark[] = [];
  let seq = 0;
  for (const i of [...touched].sort((x, y) => x - y)) {
    const page = pages[i];
    if (!page) continue;
    const toUser = invert(visual(await pageBox(sec.reader, page.dict)));
    const refs: PdfRef[] = [];
    for (const spec of byPage.get(i) ?? []) {
      const quads = spec.rects.map((r) => quadOf(r, toUser));
      const rect = boundsOf(quads, spec.shape === 'frame' ? 1.5 : 1);
      const ap = sec.stream(
        sec.alloc(),
        new Map<string, PdfValue>([
          ['Type', N('XObject')],
          ['Subtype', N('Form')],
          ['BBox', rect],
          ...(spec.shape === 'highlight' ? [['Resources', multiply()] as [string, PdfValue]] : []),
        ]),
        encodeLatin1(contentOf(spec, quads, rect)),
      );
      const nm = `${MARK_NM_PREFIX}${String(++seq)}`;
      const subtype =
        spec.shape === 'caret' ? 'Caret' : spec.shape === 'frame' ? 'Square' : 'Highlight';
      const d: PdfDict = new Map<string, PdfValue>([
        ['Type', N('Annot')],
        ['Subtype', N(subtype)],
        ['Rect', rect],
        ['C', [...spec.colour]],
        ['T', author],
        ['Subj', textString(spec.subject)],
        ['Contents', textString(clip(spec.contents))],
        ['NM', PdfString.of(nm)],
        ['M', date],
        ['CreationDate', date],
        ['F', 4],
        ['P', new PdfRef(page.num, 0)],
        ['AP', new Map<string, PdfValue>([['N', ap]])],
      ]);
      if (spec.shape === 'caret') d.set('Sy', N('None'));
      else if (spec.shape === 'highlight') d.set('QuadPoints', quads.flat());
      else d.set('BS', new Map<string, PdfValue>([['W', 1.5]]));
      refs.push(sec.value(sec.alloc(), d));
      const stored: StoredMark = { page: i + 1, kind: spec.kind, quads, nm };
      if (spec.old !== undefined) stored.old = spec.old;
      if (spec.new !== undefined) stored.new = spec.new;
      out.push(stored);
    }
    const pd: PdfDict = new Map(page.dict);
    const annots = pd.get('Annots');
    const existing = await sec.reader.resolve(annots);
    const kept = (Array.isArray(existing) ? existing : []).filter(
      (r) => !(r instanceof PdfRef && drop.has(r.num)),
    );
    if (annots instanceof PdfRef && drop.size === 0) {
      // An indirect /Annots array is rewritten in place (the page object stays).
      sec.value(annots.num, [...kept, ...refs]);
    } else {
      pd.set('Annots', [...kept, ...refs]);
      sec.value(page.num, pd);
    }
  }
  return { marks: out, pages: touched.size };
}
