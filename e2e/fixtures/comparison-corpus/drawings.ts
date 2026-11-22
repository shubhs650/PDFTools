// Overlay corpus pairs 14 to 19 (M12-01, Q37): self-made drawings, built
// from the plans in plans.ts. Each builder returns both revisions and the
// facts the manifest states (zones, scale, offsets), computed, not typed.

import { area, cloud, highlight, marker, note, textBox, type AnnotCommon } from './annots.ts';
import { Canvas } from './canvas.ts';
import { Doc, type DocInfo, type PageSpec } from './pdf.ts';
import {
  densePlotPlan,
  detailsSheet,
  framingPlan,
  gridOf,
  type DetailSpec,
  type FramingSpec,
} from './plans.ts';
import {
  frame,
  pagePt,
  SHEETS,
  titleBlock,
  titleBlockHeight,
  zoneOf,
  type Box,
  type Sheet,
  type TitleBlock,
} from './sheet.ts';

export interface PairFiles {
  old: Uint8Array;
  new: Uint8Array;
  /** Facts for the manifest's expected differences. */
  facts: Record<string, string>;
}

const PROJECT = 'RIVERSIDE PROCESS PLANT (SAMPLE)';
const DATE_A = 'D:20260901090000Z';
const DATE_B = 'D:20261015090000Z';

const info = (title: string, subject: string, date: string): DocInfo => ({
  title,
  author: 'Triya PDF corpus generator',
  subject,
  creationDate: date,
  modDate: date,
});

function tb(
  over: Partial<TitleBlock> & Pick<TitleBlock, 'title' | 'drawingNo' | 'rev'>,
): TitleBlock {
  return {
    project: PROJECT,
    date: '2026-09-01',
    scale: '1:100',
    status: 'FOR APPROVAL',
    drawn: 'S.K.',
    checked: 'R.M.',
    approved: 'A.N.',
    sheet: '1 OF 1',
    revisions: [{ rev: 'A', date: '2026-09-01', desc: 'ISSUED FOR APPROVAL', by: 'SK', chk: 'RM' }],
    ...over,
  };
}

const REV_B_ROW = { rev: 'B', date: '2026-10-15', desc: 'REVISED AS CLOUDED', by: 'SK', chk: 'RM' };

/** The drawing area above the title block, for plans. */
function planBox(inner: Box, t: TitleBlock): Box {
  const lift = titleBlockHeight(t) + 6;
  return { x: inner.x + 4, y: inner.y + lift, w: inner.w - 8, h: inner.h - lift - 4 };
}

function page(s: Sheet, content: string, annots?: PageSpec['annots']): PageSpec {
  return { ...pagePt(s), content, ...(annots ? { annots } : {}) };
}

function oneSheet(s: Sheet, draw: (c: Canvas, inner: Box) => void): string {
  const c = new Canvas();
  draw(c, frame(c, s));
  return c.toString();
}

// --- Pair 14: dense A1 ---------------------------------------------------

export function pair14(): PairFiles {
  const s = SHEETS.A1;
  const build = (rev: 'A' | 'B') => {
    const c = new Canvas();
    const inner = frame(c, s, true);
    const stats = densePlotPlan(
      c,
      { x: inner.x + 4, y: inner.y + 4, w: inner.w - 8, h: inner.h - 8 },
      {
        movePad: rev === 'B' ? 5 : 0,
        tag1204: rev === 'B' ? 'P-1204A' : 'P-1204',
        newBranch: rev === 'B',
        removeTankPad: rev === 'B',
      },
    );
    titleBlock(
      c,
      s,
      tb({
        title: ['AREA 200 PLOT PLAN', 'EQUIPMENT AND PIPE RACKS'],
        drawingNo: 'PP-200-001',
        rev,
        scale: '1:200',
        ...(rev === 'B'
          ? {
              date: '2026-10-15',
              revisions: [REV_B_ROW, ...tb({ title: ['', ''], drawingNo: '', rev }).revisions],
            }
          : {}),
      }),
      true,
    );
    const doc = new Doc();
    const content = c.toString();
    doc.addPage(page(s, content));
    const bytes = doc.finish(
      info(
        'Area 200 plot plan',
        'Comparison corpus pair 14, self-made',
        rev === 'A' ? DATE_A : DATE_B,
      ),
      `pair14-${rev}`,
    );
    const segments = (content.match(/ l\n/g) ?? []).length + (content.match(/ l$/gm) ?? []).length;
    return { bytes, stats, segments };
  };
  const a = build('A');
  const b = build('B');
  const z = (p: readonly [number, number]) => zoneOf(s, p[0], p[1]);
  return {
    old: a.bytes,
    new: b.bytes,
    facts: {
      pads: String(a.stats.pads),
      tags: String(a.stats.tags),
      segments: String(a.segments),
      padZone: z(b.stats.changeAt.pad),
      tagZone: z(b.stats.changeAt.tag),
      branchZone: z(b.stats.changeAt.branch),
      tankZone: z(a.stats.changeAt.tank),
    },
  };
}

// --- Framing plans shared by pairs 15, 16, 18 and 19 -----------------------

function framingA1(): FramingSpec {
  return {
    gridX: ['1', '2', '3', '4', '5', '6', '7', '8'],
    gridY: ['A', 'B', 'C', 'D', 'E', 'F'],
    bayX: [80, 80, 70, 80, 80, 70, 80],
    bayY: [65, 65, 70, 65, 65],
    scale: 100,
    beamX: (i, j) => (j === 0 || j === 5 ? 'W410x46' : i === 2 || i === 5 ? 'W310x39' : 'W360x51'),
    beamY: (i) => (i === 0 || i === 7 ? 'W310x39' : 'W250x33'),
    noColumn: ['C4', 'D4'],
    openings: [{ i: 3, j: 2, w: 24, h: 18, text: 'OPENING 2400x1800' }],
    hatched: [
      { i: 0, j: 4, angle: 45 },
      { i: 6, j: 0, angle: 135 },
    ],
    secondaries: 3,
    notes: [
      'ALL DIMENSIONS ARE IN MILLIMETRES UNLESS NOTED OTHERWISE.',
      'STEEL GRADE S355 TO EN 10025-2. BOLTS GRADE 8.8.',
      'TOP OF STEEL +6.000 UNLESS NOTED OTHERWISE.',
      'READ WITH DRAWINGS S-201 TO S-204.',
    ],
  };
}

/** `layout`: the title block the drawing area is laid out above (default `t`). */
function framingA1Sheet(c: Canvas, s: Sheet, t: TitleBlock, layout: TitleBlock = t): void {
  const inner = frame(c, s);
  const box = planBox(inner, layout);
  framingPlan(c, box, { ...framingA1(), notesAt: [inner.x + 6, inner.y + 6] });
  titleBlock(c, s, t);
}

// --- Pair 15: the same drawing at A1 and at A3 ----------------------------

export function pair15(): PairFiles {
  const t = tb({ title: ['FIRST FLOOR', 'FRAMING PLAN'], drawingNo: 'S-201', rev: 'A' });
  const a1 = SHEETS.A1;
  const a3 = SHEETS.A3;
  const ca = new Canvas();
  framingA1Sheet(ca, a1, t);
  // Rev B: the same sheet plotted on A3, fit to page and centred; pen widths
  // stay absolute (as a plotter keeps 0.25 mm at 0.25 mm), text scales.
  const pa = pagePt(a1);
  const pb = pagePt(a3);
  const k = Math.min(pb.width / pa.width, pb.height / pa.height);
  const tx = (pb.width - pa.width * k) / 2;
  const ty = (pb.height - pa.height * k) / 2;
  const cb = new Canvas();
  cb.lineScale = 1 / k;
  framingA1Sheet(cb, a1, t);
  const docA = new Doc();
  docA.addPage(page(a1, ca.toString()));
  const docB = new Doc();
  docB.addPage({
    ...pb,
    // Six decimals: `num` keeps three, which wrote 0.499 instead of 0.49941
    // (0.08 % off the manifest; found by spike S28).
    content: `q ${k.toFixed(6)} 0 0 ${k.toFixed(6)} ${tx.toFixed(6)} ${ty.toFixed(6)} cm\n${cb.toString()}\nQ`,
  });
  return {
    old: docA.finish(
      info('S-201 First floor framing plan', 'Comparison corpus pair 15, self-made', DATE_A),
      'pair15-A',
    ),
    new: docB.finish(
      info('S-201 First floor framing plan', 'Comparison corpus pair 15, self-made', DATE_A),
      'pair15-B',
    ),
    facts: { scale: k.toFixed(5), tx: tx.toFixed(2), ty: ty.toFixed(2) },
  };
}

// --- Pair 16: identical content, different files --------------------------

const DETAILS: DetailSpec = {
  bolts: [4, 6, 8],
  plate: ['200x15', '250x20', '300x20'],
  weld: '6',
  titles: ['DETAIL 1 BEAM TO COLUMN', 'DETAIL 2 BEAM SPLICE', 'DETAIL 3 BASE PLATE'],
};

export function pair16(): PairFiles {
  const s = SHEETS.A2;
  const t1 = tb({
    title: ['GROUND FLOOR', 'FRAMING PLAN'],
    drawingNo: 'S-101',
    rev: 'A',
    sheet: '1 OF 2',
  });
  const t2 = tb({
    title: ['STEEL CONNECTION', 'DETAILS'],
    drawingNo: 'S-101',
    rev: 'A',
    sheet: '2 OF 2',
    scale: '1:10',
  });
  const sheet1 = oneSheet(s, (c, inner) => {
    framingPlan(c, planBox(inner, t1), {
      ...framingA1(),
      bayX: [55, 55, 50, 55, 55, 50, 55],
      bayY: [45, 45, 50, 45, 45],
      scale: 150,
      notes: framingA1().notes.slice(0, 3),
      notesAt: [inner.x + 6, inner.y + 6],
    });
    // Zero-width lines: a fine reference grid in the notes area.
    c.save().width(0).stroke(0.5);
    for (let x = inner.x + 6; x < inner.x + 200; x += 5) c.line(x, inner.y + 26, x, inner.y + 40);
    c.strokePath().restore();
    titleBlock(c, s, t1);
  });
  const sheet2 = oneSheet(s, (c, inner) => {
    detailsSheet(c, planBox(inner, t2), DETAILS);
    titleBlock(c, s, t2);
  });
  const make = (rev: 'A' | 'B') => {
    const d = new Doc();
    d.addPage(page(s, sheet1));
    d.addPage(page(s, sheet2));
    // Only the file's metadata and identifier differ.
    return d.finish(
      info(
        'S-101 Ground floor framing',
        'Comparison corpus pair 16, self-made',
        rev === 'A' ? DATE_A : DATE_B,
      ),
      `pair16-${rev}`,
    );
  };
  return { old: make('A'), new: make('B'), facts: {} };
}

// --- Pair 17: a set with one sheet removed and two swapped ----------------

interface SetSheet {
  no: string;
  title: [string, string];
  draw: (c: Canvas, box: Box) => void;
}

function setSheets(rev: 'A' | 'B'): SetSheet[] {
  const base = framingA1();
  const a3 = (o: Partial<FramingSpec>): FramingSpec => ({
    ...base,
    bayX: [45, 45, 40, 45, 45],
    bayY: [38, 38, 38],
    gridX: ['1', '2', '3', '4', '5', '6'],
    gridY: ['A', 'B', 'C', 'D'],
    noColumn: [],
    openings: [],
    hatched: [],
    notes: base.notes.slice(0, 2),
    ...o,
  });
  return [
    {
      no: 'S-101',
      title: ['FOUNDATION PLAN', 'PAD FOOTINGS AND GROUND BEAMS'],
      draw: (c, box) => {
        framingPlan(c, box, {
          ...a3({ beamX: () => 'GB1 400x600', beamY: () => 'GB2 300x500', secondaries: 0 }),
          hatched: [0, 1, 2, 3, 4].flatMap((i) => [0, 1, 2].map((j) => ({ i, j, angle: 45 }))),
        });
      },
    },
    {
      no: 'S-102',
      title: ['GROUND FLOOR', 'FRAMING PLAN'],
      draw: (c, box) => {
        framingPlan(c, box, a3({ noColumn: ['B3'], secondaries: 2 }));
      },
    },
    {
      no: 'S-103',
      title: ['FIRST FLOOR', 'FRAMING PLAN'],
      draw: (c, box) => {
        framingPlan(
          c,
          box,
          a3({ openings: [{ i: 2, j: 1, w: 14, h: 10, text: 'STAIR OPENING' }], secondaries: 3 }),
        );
      },
    },
    {
      no: 'S-104',
      title: ['ROOF', 'FRAMING PLAN'],
      draw: (c, box) => {
        framingPlan(
          c,
          box,
          a3({
            beamX: (i, j) => (rev === 'B' && j === 2 && i === 3 ? 'W410x60' : 'W310x39'),
            beamY: () => 'W200x27',
            secondaries: 4,
            hatched: rev === 'B' ? [{ i: 4, j: 0, angle: 135 }] : [],
          }),
        );
      },
    },
    {
      no: 'S-105',
      title: ['STEEL CONNECTION', 'DETAILS SHEET 1'],
      draw: (c, box) => {
        detailsSheet(c, box, DETAILS);
      },
    },
    {
      no: 'S-106',
      title: ['STEEL CONNECTION', 'DETAILS SHEET 2'],
      draw: (c, box) => {
        detailsSheet(c, box, {
          bolts: [2, 4, 10],
          plate: ['150x10', '180x12', '350x25'],
          weld: '8',
          titles: ['DETAIL 4 CLEAT', 'DETAIL 5 FIN PLATE', 'DETAIL 6 MOMENT END PLATE'],
        });
      },
    },
  ];
}

export function pair17(): PairFiles {
  const s = SHEETS.A3;
  const render = (rev: 'A' | 'B', sh: SetSheet): string =>
    oneSheet(s, (c, inner) => {
      const changed = rev === 'B' && sh.no === 'S-104';
      const t = tb({
        title: sh.title,
        drawingNo: sh.no,
        rev: changed ? 'B' : 'A',
        ...(changed
          ? {
              date: '2026-10-15',
              revisions: [REV_B_ROW, ...tb({ title: ['', ''], drawingNo: '', rev: 'A' }).revisions],
            }
          : {}),
      });
      sh.draw(c, planBox(inner, t));
      titleBlock(c, s, t);
    });
  const a = setSheets('A');
  const b = setSheets('B');
  const docA = new Doc();
  for (const sh of a) docA.addPage(page(s, render('A', sh)));
  // Rev B: S-103 removed; S-105 and S-106 swapped.
  const order = ['S-101', 'S-102', 'S-104', 'S-106', 'S-105'];
  const docB = new Doc();
  for (const no of order) {
    const sh = b.find((x) => x.no === no);
    if (sh) docB.addPage(page(s, render('B', sh)));
  }
  return {
    old: docA.finish(
      info('S-100 series structural set', 'Comparison corpus pair 17, self-made', DATE_A),
      'pair17-A',
    ),
    new: docB.finish(
      info('S-100 series structural set', 'Comparison corpus pair 17, self-made', DATE_B),
      'pair17-B',
    ),
    facts: {},
  };
}

// --- Pair 18: only the title block changes ---------------------------------

export function pair18(): PairFiles {
  const s = SHEETS.A1;
  const revC = { rev: 'C', date: '2026-09-20', desc: 'ISSUED FOR APPROVAL', by: 'SK', chk: 'RM' };
  const revB = {
    rev: 'B',
    date: '2026-08-30',
    desc: 'ISSUED FOR COORDINATION',
    by: 'SK',
    chk: 'RM',
  };
  const revA = { rev: 'A', date: '2026-08-02', desc: 'PRELIMINARY', by: 'SK', chk: '-' };
  const ta = tb({
    title: ['FIRST FLOOR', 'FRAMING PLAN'],
    drawingNo: 'S-201',
    rev: 'C',
    date: '2026-09-20',
    approved: '-',
    revisions: [revC, revB, revA],
  });
  const tbB = tb({
    title: ['FIRST FLOOR', 'FRAMING PLAN'],
    drawingNo: 'S-201',
    rev: 'D',
    date: '2026-10-15',
    status: 'FOR CONSTRUCTION',
    approved: 'A.N.',
    revisions: [
      { rev: 'D', date: '2026-10-15', desc: 'ISSUED FOR CONSTRUCTION', by: 'SK', chk: 'RM' },
      revC,
      revB,
      revA,
    ],
  });
  const make = (t: TitleBlock, rev: string, date: string) => {
    const c = new Canvas();
    // Both revisions keep the drawing area where the larger title block
    // leaves it: laid out above each sheet's own title block, the plan moved
    // 7.09 pt when the revision table grew (found by spike S28).
    framingA1Sheet(c, s, t, tbB);
    const d = new Doc();
    d.addPage(page(s, c.toString()));
    return d.finish(
      info('S-201 First floor framing plan', 'Comparison corpus pair 18, self-made', date),
      `pair18-${rev}`,
    );
  };
  const tbBox = { x: s.w - 10 - 180, y: 10 };
  return {
    old: make(ta, 'C', DATE_A),
    new: make(tbB, 'D', DATE_B),
    facts: {
      tbZone: `${zoneOf(s, tbBox.x + 1, tbBox.y + 1)} to ${zoneOf(s, s.w - 11, tbBox.y + titleBlockHeight(tbB) - 1)}`,
    },
  };
}

// --- Pair 19: review comments on Rev A, Rev B addresses some ---------------

function reviewSpec(rev: 'A' | 'B'): FramingSpec {
  return {
    gridX: ['1', '2', '3', '4', '5', '6'],
    gridY: ['A', 'B', 'C', 'D'],
    bayX: [50, 50, 50, 50, 50],
    bayY: [38, 38, 38],
    scale: 100,
    beamX: (i, j) => (rev === 'B' && i === 1 && j === 1 ? 'W360x51' : 'W310x39'),
    beamY: () => 'W250x33',
    openings: [
      {
        i: 3,
        j: 1,
        w: rev === 'B' ? 12 : 9,
        h: 6,
        text: rev === 'B' ? 'OPENING 1200x600' : 'OPENING 900x600',
      },
    ],
    hatched: rev === 'B' ? [{ i: 0, j: 2, angle: 45 }] : [],
    secondaries: 2,
    notes: [
      'ALL DIMENSIONS IN MILLIMETRES.',
      'STEEL GRADE S355. BOLTS GRADE 8.8.',
      'TOP OF STEEL +4.500.',
    ],
  };
}

export function pair19(): PairFiles {
  const s = SHEETS.A3;
  const tA = tb({ title: ['MEZZANINE', 'FRAMING PLAN'], drawingNo: 'S-301', rev: 'A' });
  const tB = tb({
    title: ['MEZZANINE', 'FRAMING PLAN'],
    drawingNo: 'S-301',
    rev: 'B',
    date: '2026-10-15',
    revisions: [{ ...REV_B_ROW, desc: 'CHECK COMMENTS INCORPORATED' }, ...tA.revisions],
  });
  const draw = (rev: 'A' | 'B', t: TitleBlock) => {
    const c = new Canvas();
    const inner = frame(c, s);
    const box = planBox(inner, t);
    const spec = { ...reviewSpec(rev), notesAt: [inner.x + 6, inner.y + 6] as const };
    framingPlan(c, box, spec);
    titleBlock(c, s, t);
    return { content: c.toString(), grid: gridOf(box, spec), inner };
  };
  const a = draw('A', tA);
  const b = draw('B', tB);
  const { xs, ys } = a.grid;
  const X = (i: number) => xs[i] ?? 0;
  const Y = (j: number) => ys[j] ?? 0;
  const checker = 'R. Mehta';
  const c = (
    name: string,
    subject: string,
    contents: string,
    date = 'D:20260910141500Z',
    author = checker,
  ): AnnotCommon => ({
    name,
    author,
    subject,
    contents,
    date,
  });
  const docA = new Doc();
  const helv = docA.fontRefs.F1;
  docA.addPage(
    page(s, a.content, (w, pg) => {
      const out: number[] = [];
      // C1: beam B/2-3 overstressed. Addressed in Rev B (W360x51).
      out.push(
        cloud(
          w,
          pg,
          c('C1-cloud', 'Cloud', 'C1: Beam B/2-3 W310x39 is overstressed (UR 1.12). Use W360x51.'),
          {
            x: X(1) + 6,
            y: Y(1) - 4,
            w: X(2) - X(1) - 12,
            h: 9,
          },
        ),
        textBox(
          w,
          pg,
          helv,
          c('C1-text', 'Callout', 'C1: Beam B/2-3 overstressed, use W360x51'),
          { x: X(1) + 4, y: Y(1) + 14, w: 62, h: 9 },
          ['C1: Beam B/2-3 overstressed,', 'use W360x51'],
        ),
      );
      // C2: opening 900x600 to become 1200x900. Rev B made it 1200x600 (changed differently).
      out.push(
        cloud(
          w,
          pg,
          c('C2-cloud', 'Cloud', 'C2: Opening in bay 4-5/B-C: increase to 1200x900 for the duct.'),
          {
            x: (X(3) + X(4)) / 2 - 9,
            y: (Y(1) + Y(2)) / 2 - 8,
            w: 18,
            h: 14,
          },
        ),
      );
      // C3: bay 2-3 dimension. Not changed in Rev B (carried over).
      out.push(
        note(
          w,
          pg,
          c(
            'C3-note',
            'Note',
            'C3: Bay 2-3 is 5000 here but 5200 on the architectural grid. Confirm.',
          ),
          [(X(1) + X(2)) / 2 + 4, (ys[3] ?? 0) + 12],
        ),
      );
      // C4: question with the designer's reply. No drawing change needed (carried over).
      const c4 = note(
        w,
        pg,
        c('C4-note', 'Note', 'C4: Confirm secondary beam spacing in bay 5-6.'),
        [X(4) + 30, Y(0) + 20],
      );
      out.push(
        c4,
        note(
          w,
          pg,
          c(
            'C4-reply',
            'Note',
            'Spacing is 1667 c/c, as shown. No change.',
            'D:20260911093000Z',
            'S. Kulkarni',
          ),
          [X(4) + 30, Y(0) + 20],
          { to: c4 },
        ),
      );
      // Check highlights (see-through): row A beams and line 1 checked, a title-block field and the notes.
      out.push(
        marker(w, pg, c('K1', 'Highlight', 'Checked'), [
          [X(0), Y(0)],
          [X(5), Y(0)],
        ]),
        marker(w, pg, c('K2', 'Highlight', 'Checked'), [
          [X(0), Y(0)],
          [X(0), Y(3)],
        ]),
        highlight(w, pg, c('K3', 'Highlight', 'Checked'), {
          x: s.w - 10 - 180 + 1,
          y: 10 + 2,
          w: 30,
          h: 5,
        }),
        area(w, pg, c('K4', 'Highlight', 'Notes checked'), {
          x: a.inner.x + 4,
          y: a.inner.y + 4,
          w: 70,
          h: 20,
        }),
      );
      return out;
    }),
  );
  const docB = new Doc();
  docB.addPage(page(s, b.content));
  const z = (x: number, y: number) => zoneOf(s, x, y);
  return {
    old: docA.finish(
      info(
        'S-301 Mezzanine framing plan (checked)',
        'Comparison corpus pair 19, self-made',
        DATE_A,
      ),
      'pair19-A',
    ),
    new: docB.finish(
      info('S-301 Mezzanine framing plan', 'Comparison corpus pair 19, self-made', DATE_B),
      'pair19-B',
    ),
    facts: {
      c1: z((X(1) + X(2)) / 2, Y(1)),
      c2: z((X(3) + X(4)) / 2, (Y(1) + Y(2)) / 2),
      c3: z((X(1) + X(2)) / 2, (ys[3] ?? 0) + 12),
      c4: z(X(4) + 30, Y(0) + 20),
      stair: z((X(0) + X(1)) / 2, (Y(2) + Y(3)) / 2),
    },
  };
}
