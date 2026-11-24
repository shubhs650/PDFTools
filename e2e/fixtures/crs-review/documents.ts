// The CRS review corpus (M13-07, D-71): self-made documents carrying review
// comments of every kind, as a checking engineer leaves them, to check the
// Comment Resolution Sheet exports (Standard and project templates) against.
// Rule 13: everything here is drawn by this script.
//
//   crs_01: a four-sheet A3 steel drawing set, sheets labelled S-101…S-104
//           (PDF page labels). Sheet S-103 has no comments; S-104 is stored
//           portrait with /Rotate 90.
//   crs_02: a three-page A4 pump specification with text markups.

import { Canvas, type Pt } from '../comparison-corpus/canvas.ts';
import { textWidth, winAnsi } from '../comparison-corpus/fonts.ts';
import { Doc, MM, num, type DocInfo } from '../comparison-corpus/pdf.ts';
import { framingPlan, gridOf, type FramingSpec } from '../comparison-corpus/plans.ts';
import {
  frame,
  pagePt,
  SHEETS,
  titleBlock,
  titleBlockHeight,
  type Box,
  type TitleBlock,
} from '../comparison-corpus/sheet.ts';
import {
  areaHighlight,
  arrow,
  BLUE,
  callout,
  caret,
  cloud,
  distance,
  GREEN,
  handLoop,
  ink,
  note,
  oval,
  polygon,
  polyline,
  rectangle,
  reply,
  setState,
  stamp,
  textBox,
  textMarkup,
  typewriter,
  wordBox,
  YELLOW,
  type TextRun,
  type Who,
} from './marks.ts';

export interface ReviewDoc {
  file: string;
  bytes: Uint8Array;
  /** What the document holds, for the README. */
  summary: string;
  /** Every top-level comment as the CRS lists it (replies and states not counted). */
  comments: number;
  /** Of those, the see-through ones (opacity under 70 %) that "Ignore highlights" leaves out. */
  seeThrough: number;
}

const info = (title: string, subject: string, date: string): DocInfo => ({
  title,
  author: 'Triya PDF corpus generator',
  subject,
  creationDate: date,
  modDate: date,
});

const IST = "+05'30'";
const day = (d: number, hh = 10, mm = 0): string =>
  `D:202611${String(d).padStart(2, '0')}${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}00${IST}`;

const CHECKER = 'R. Mehta';
const LEAD = 'A. Iyer';
const DESIGNER = 'S. Kulkarni';
const VENDOR = 'Vendor (P. Rao)';

const who = (
  name: string,
  subject: string,
  contents: string,
  date: string,
  author = CHECKER,
  opacity?: number,
): Who => ({
  name,
  author,
  subject,
  contents,
  date,
  ...(opacity === undefined ? {} : { opacity }),
});

// --- crs_01: steel drawing set ---------------------------------------------

function tb(sheet: number, title: [string, string]): TitleBlock {
  return {
    project: 'RIVERSIDE PUMP HOUSE (SAMPLE)',
    title,
    drawingNo: `S-10${String(sheet)}`,
    rev: 'B',
    date: '2026-10-28',
    scale: '1:100',
    status: 'FOR REVIEW',
    drawn: 'S.K.',
    checked: '-',
    approved: '-',
    sheet: `${String(sheet)} OF 4`,
    revisions: [
      { rev: 'B', date: '2026-10-28', desc: 'ISSUED FOR REVIEW', by: 'SK', chk: '-' },
      { rev: 'A', date: '2026-09-30', desc: 'PRELIMINARY', by: 'SK', chk: 'RM' },
    ],
  };
}

function spec(level: string): FramingSpec {
  return {
    gridX: ['1', '2', '3', '4', '5', '6'],
    gridY: ['A', 'B', 'C', 'D'],
    bayX: [50, 50, 50, 50, 50],
    bayY: [38, 38, 38],
    scale: 100,
    beamX: (i, j) => (j === 1 && i === 1 ? 'W310x39' : 'W250x33'),
    beamY: () => 'W200x27',
    noColumn: level === 'roof' ? [] : ['C4'],
    openings: [{ i: 3, j: 1, w: 9, h: 6, text: 'OPENING 900x600' }],
    hatched: level === 'ground' ? [{ i: 0, j: 2, angle: 45 }] : [],
    secondaries: 2,
    notes: [
      'ALL DIMENSIONS IN MILLIMETRES.',
      'STEEL GRADE S355. BOLTS GRADE 8.8.',
      level === 'roof' ? 'TOP OF STEEL +9.000.' : 'TOP OF STEEL +4.500.',
    ],
  };
}

/** One drawing sheet's content and its grid (mm). */
function drawing(sheet: number, title: [string, string], level: string) {
  const s = SHEETS.A3;
  const c = new Canvas();
  const inner = frame(c, s);
  const t = tb(sheet, title);
  const lift = titleBlockHeight(t) + 6;
  const box: Box = { x: inner.x + 4, y: inner.y + lift, w: inner.w - 8, h: inner.h - lift - 4 };
  const sp = { ...spec(level), notesAt: [inner.x + 6, inner.y + 6] as const };
  framingPlan(c, box, sp);
  const tbBox = titleBlock(c, s, t);
  return { content: c.toString(), grid: gridOf(box, sp), inner, tbBox };
}

export function drawingSet(): ReviewDoc {
  const s = SHEETS.A3;
  const doc = new Doc();
  const helv = doc.fontRefs.F1;
  const bold = doc.fontRefs.F2;
  let comments = 0;
  let seeThrough = 0;
  const top = (n: number, see = 0) => {
    comments += n;
    seeThrough += see;
  };

  // S-101: ground floor. Most kinds of comment, replies and every status.
  const g = drawing(1, ['GROUND FLOOR', 'FRAMING PLAN'], 'ground');
  const X = (i: number) => g.grid.xs[i] ?? 0;
  const Y = (j: number) => g.grid.ys[j] ?? 0;
  doc.addPage({
    ...pagePt(s),
    content: g.content,
    annots: (w, pg) => {
      const out: number[] = [];
      // 1. Cloud + callout on beam B/2-3; designer replies, checker accepts.
      const c1 = cloud(
        w,
        pg,
        who(
          'S101-C1',
          'Cloud',
          'Beam B/2-3 W310x39 overstressed (UR 1.12). Use W360x51.',
          day(3, 10, 15),
        ),
        {
          x: X(1) + 6,
          y: Y(1) - 4,
          w: X(2) - X(1) - 12,
          h: 9,
        },
      );
      const c1r = reply(
        w,
        pg,
        who(
          'S101-C1-r1',
          'Reply',
          'Agreed. Revised to W360x51 in Rev C.',
          day(5, 16, 40),
          DESIGNER,
        ),
        c1,
        [X(1), Y(1)],
      );
      const c1s = setState(
        w,
        pg,
        who('S101-C1-s', 'Status', 'Accepted set by R. Mehta', day(6, 9, 5)),
        c1,
        [X(1), Y(1)],
        'Accepted',
      );
      const c1t = callout(
        w,
        pg,
        helv,
        who(
          'S101-C1-callout',
          'Callout',
          'Check connection B/2 for the heavier beam (end reaction 185 kN).',
          day(3, 10, 18),
        ),
        { x: X(1) + 10, y: Y(1) + 22, w: 64, h: 12 },
        ['Check connection B/2 for the heavier', 'beam (end reaction 185 kN).'],
        [X(1) + 1, Y(1) + 1],
      );
      out.push(c1, c1r, c1s, c1t);
      top(2);
      // 2. Arrow at the missing column C4; designer rejects with a reason.
      const a2 = arrow(
        w,
        pg,
        who(
          'S101-A2',
          'Arrow',
          'Column missing at C/4? Architectural grid shows a column here.',
          day(3, 11, 2),
        ),
        [X(3) + 22, Y(2) + 20],
        [X(3) + 2, Y(2) + 2],
      );
      out.push(
        a2,
        reply(
          w,
          pg,
          who(
            'S101-A2-r1',
            'Reply',
            'Column omitted on purpose: transfer beam at level 2 (see S-102).',
            day(5, 17, 0),
            DESIGNER,
          ),
          a2,
          [X(3), Y(2)],
        ),
        setState(
          w,
          pg,
          who('S101-A2-s', 'Status', 'Rejected set by S. Kulkarni', day(5, 17, 1), DESIGNER),
          a2,
          [X(3), Y(2)],
          'Rejected',
        ),
      );
      top(1);
      // 3. Rectangle on the title block's title; completed.
      const r3 = rectangle(
        w,
        pg,
        who(
          'S101-R3',
          'Rectangle',
          'Title should read GROUND FLOOR STEEL FRAMING PLAN.',
          day(3, 11, 30),
        ),
        {
          x: g.tbBox.x + 1,
          y: g.tbBox.y + 34.5,
          w: 70,
          h: 12,
        },
      );
      out.push(
        r3,
        setState(
          w,
          pg,
          who('S101-R3-s', 'Status', 'Completed set by S. Kulkarni', day(7, 12, 0), DESIGNER),
          r3,
          [g.tbBox.x, g.tbBox.y],
          'Completed',
        ),
      );
      top(1);
      // 4. Oval round a beam size; no status.
      out.push(
        oval(
          w,
          pg,
          who(
            'S101-O4',
            'Oval',
            'Section size illegible at A3 print scale; use 2.5 mm text.',
            day(3, 12, 10),
          ),
          { x: X(3) + 12, y: Y(3) - 2, w: 28, h: 8 },
        ),
      );
      top(1);
      // 5. Sticky note with special characters and a line break; a thread with a nested reply.
      const n5 = note(
        w,
        pg,
        who(
          'S101-N5',
          'Note',
          'Base plate: Ø24 holes, tolerance ±2 mm, grout 50 mm.\nConfirm anchor bolt projection (min. 120 mm) with civil.',
          day(4, 9, 45),
        ),
        [X(0) - 12, Y(0) + 6],
      );
      const n5r = reply(
        w,
        pg,
        who('S101-N5-r1', 'Reply', 'Civil confirms 120 mm projection.', day(6, 14, 20), DESIGNER),
        n5,
        [X(0), Y(0)],
      );
      out.push(
        n5,
        n5r,
        reply(
          w,
          pg,
          who('S101-N5-r2', 'Reply', 'Thanks, please add it to note 2.', day(6, 15, 0), LEAD),
          n5r,
          [X(0), Y(0)],
        ),
      );
      top(1);
      // 6. Typed text on the drawing (typewriter).
      out.push(
        typewriter(
          w,
          pg,
          helv,
          who('S101-T6', 'Typewriter', 'TYP. ALL BAYS', day(4, 10, 5), LEAD),
          [X(4) + 6, Y(3) + 3],
          'TYP. ALL BAYS',
        ),
      );
      top(1);
      // 7. Polyline tracing a load path.
      out.push(
        polyline(
          w,
          pg,
          who(
            'S101-P7',
            'Polyline',
            'Load path not continuous down to the foundation at grid 5.',
            day(4, 10, 40),
          ),
          [
            [X(4) + 2, Y(3) - 4],
            [X(4) + 2, Y(2) + 3],
            [X(4) + 12, Y(1) + 6],
            [X(4) + 12, Y(0) + 4],
          ],
        ),
      );
      top(1);
      // 8. Freehand loop (pen).
      out.push(
        ink(
          w,
          pg,
          who(
            'S101-I8',
            'Pencil',
            'Clash with the 600x400 duct (see M-201).',
            day(4, 11, 15),
            LEAD,
          ),
          handLoop((X(2) + X(3)) / 2, Y(2) + 8, 14, 7),
        ),
      );
      top(1);
      // 9. Stamp without text in the comment.
      out.push(
        stamp(
          w,
          pg,
          bold,
          who('S101-ST9', 'Stamp', '', day(8, 9, 0), LEAD),
          { x: g.inner.x + 110, y: g.inner.y + 10, w: 58, h: 16 },
          ['REVIEWED WITH', 'COMMENTS'],
        ),
      );
      top(1);
      // 10. Distance measurement.
      out.push(
        distance(
          w,
          pg,
          helv,
          who('S101-M10', 'Distance', '5000 mm', day(4, 12, 0)),
          [X(1), Y(3) + 6],
          [X(2), Y(3) + 6],
          '5000 mm',
          '1 mm = 100 mm',
        ),
      );
      top(1);
      // 11. Cloud with no comment text.
      out.push(
        cloud(w, pg, who('S101-C11', 'Cloud', '', day(4, 12, 30)), {
          x: X(3) + 3,
          y: Y(1) + 6,
          w: 30,
          h: 16,
        }),
      );
      top(1);
      // 12. A plain polygon round the hatched bay; cancelled.
      const p12 = polygon(
        w,
        pg,
        who(
          'S101-PG12',
          'Polygon',
          'Slab infill in this bay to be checked for the 10 kPa plant load.',
          day(4, 14, 0),
        ),
        [
          [X(0) - 2, Y(2) - 2],
          [X(1) + 2, Y(2) - 2],
          [X(1) + 2, Y(3) + 2],
          [X(0) + 12, Y(3) + 2],
          [X(0) - 2, Y(3) - 8],
        ],
      );
      out.push(
        p12,
        setState(
          w,
          pg,
          who('S101-PG12-s', 'Status', 'Cancelled set by R. Mehta', day(9, 10, 0)),
          p12,
          [X(0), Y(2)],
          'Cancelled',
        ),
      );
      top(1);
      // 13. A note with no author.
      out.push(
        note(
          w,
          pg,
          who('S101-N13', 'Note', 'Who approved the bolt grade change?', day(4, 15, 0), ''),
          [X(5) + 8, Y(1)],
        ),
      );
      top(1);
      // 14. A note without an appearance stream (as some editors write).
      out.push(
        note(
          w,
          pg,
          who('S101-N14', 'Note', 'Note written without an appearance stream.', day(4, 15, 30)),
          [X(5) + 8, Y(2) + 6],
          { ap: false },
        ),
      );
      top(1);
      // 15-17. See-through check highlights (40 % and 30 % opacity): left out by "Ignore highlights".
      out.push(
        rectangle(
          w,
          pg,
          who('S101-K15', 'Highlight', 'Checked', day(8, 16, 0), CHECKER, 0.4),
          { x: X(0) - 3, y: Y(0) - 3, w: X(5) - X(0) + 6, h: 6 },
          YELLOW,
          6,
        ),
        areaHighlight(
          w,
          pg,
          who('S101-K16', 'Highlight', 'Notes checked', day(8, 16, 2), CHECKER, 0.3),
          { x: g.inner.x + 4, y: g.inner.y + 4, w: 70, h: 20 },
        ),
        ink(
          w,
          pg,
          who('S101-K17', 'Highlight', 'Checked', day(8, 16, 4), CHECKER, 0.35),
          [
            [X(0), Y(0) - 1],
            [X(0), Y(3) + 1],
          ],
          YELLOW,
          8,
        ),
      );
      top(3, 3);
      return out;
    },
  });

  // S-102: first floor. A few comments, one long.
  const f = drawing(2, ['FIRST FLOOR', 'FRAMING PLAN'], 'first');
  const FX = (i: number) => f.grid.xs[i] ?? 0;
  const FY = (j: number) => f.grid.ys[j] ?? 0;
  doc.addPage({
    ...pagePt(s),
    content: f.content,
    annots: (w, pg) => {
      const long = [
        'Transfer beam at C/4 supports the column from level 3. Please provide:',
        '1) design calculation for the transfer beam including the point load from the column above;',
        '2) web stiffeners under the point load;',
        '3) deflection check against span/500 for the brittle finishes below.',
        'Without these the drawing cannot be approved for construction.',
      ].join('\n');
      const c = cloud(w, pg, who('S102-C1', 'Cloud', long, day(10, 9, 30)), {
        x: FX(2) + 6,
        y: FY(2) - 5,
        w: FX(4) - FX(2) - 12,
        h: 10,
      });
      const out: number[] = [];
      const r = reply(
        w,
        pg,
        who(
          'S102-C1-r1',
          'Reply',
          'Calculation CAL-S-014 attached to transmittal T-88.',
          day(12, 11, 0),
          DESIGNER,
        ),
        c,
        [FX(2), FY(2)],
      );
      out.push(c, r);
      out.push(
        textBox(
          w,
          pg,
          helv,
          who('S102-TB2', 'Text box', 'Add camber 15 mm to beams on grid B.', day(10, 10, 0), LEAD),
          { x: FX(0) + 4, y: FY(1) + 8, w: 55, h: 9 },
          ['Add camber 15 mm to beams on grid B.'],
          BLUE,
        ),
      );
      out.push(
        rectangle(
          w,
          pg,
          who(
            'S102-R3',
            'Rectangle',
            'Opening size does not match the mechanical layout (1200x900 needed).',
            day(10, 10, 30),
          ),
          { x: (FX(3) + FX(4)) / 2 - 8, y: (FY(1) + FY(2)) / 2 - 8, w: 16, h: 14 },
          BLUE,
        ),
      );
      out.push(
        arrow(
          w,
          pg,
          who('S102-A4', 'Arrow', 'Grid bubble 6 missing on this sheet.', day(10, 11, 0)),
          [FX(5) - 20, FY(3) + 30],
          [FX(5) - 2, FY(3) + 20],
        ),
      );
      top(4);
      return out;
    },
  });

  // S-103: roof. No comments (no sheet in the export).
  const r = drawing(3, ['ROOF', 'FRAMING PLAN'], 'roof');
  doc.addPage({ ...pagePt(s), content: r.content });

  // S-104: stored portrait with /Rotate 90, shown landscape.
  const d = drawing(4, ['MEZZANINE', 'FRAMING PLAN'], 'mezz');
  const portrait = { width: pagePt(s).height, height: pagePt(s).width };
  // Landscape (x, y) mm → portrait points: x' = H - y, y' = x.
  const rot = (x: number, y: number): Pt => [s.h - y, x];
  const DX = (i: number) => d.grid.xs[i] ?? 0;
  const DY = (j: number) => d.grid.ys[j] ?? 0;
  doc.addPage({
    ...portrait,
    rotate: 90,
    content: `q 0 1 -1 0 ${num(portrait.width)} 0 cm ${d.content} Q`,
    annots: (w, pg) => {
      const box = (x: number, y: number, ww: number, hh: number) => {
        const [px, py] = rot(x + ww, y);
        return { x: px, y: py, w: hh, h: ww };
      };
      const out: number[] = [
        rectangle(
          w,
          pg,
          who(
            'S104-R1',
            'Rectangle',
            'Mezzanine edge beam: add a toe plate detail.',
            day(14, 9, 0),
          ),
          box(DX(0) + 5, DY(3) - 4, 40, 8),
        ),
        cloud(
          w,
          pg,
          who('S104-C2', 'Cloud', 'Stair opening missing from this plan.', day(14, 9, 20)),
          box(DX(2) + 8, DY(1) + 8, 30, 20),
        ),
        oval(
          w,
          pg,
          who('S104-O3', 'Oval', 'Check bracing in this bay.', day(14, 9, 40), LEAD),
          box(DX(4) + 10, DY(0) + 8, 28, 20),
        ),
        note(
          w,
          pg,
          who(
            'S104-N4',
            'Note',
            'Sheet stored rotated: comments must still point at the right place.',
            day(14, 10, 0),
          ),
          rot(DX(5) + 10, DY(2)),
        ),
      ];
      top(4);
      return out;
    },
  });

  const bytes = doc.finish(
    info(
      'S-101 to S-104 Pump house steel (review copy)',
      'CRS review corpus 01, self-made',
      day(15),
    ),
    'crs-review-01',
    '/PageLabels << /Nums [0 << /S /D /P (S-10) /St 1 >>] >>',
  );
  return {
    file: 'crs_01_steel_drawing_set_review.pdf',
    bytes,
    summary:
      'A3 steel drawing set, 4 sheets with page labels S-101 to S-104. S-101 carries most comment kinds (cloud, callout, arrow, rectangle, oval, note with special characters and a reply thread, typewriter text, polyline, pencil, stamp with no text, distance measurement, cloud with no text, polygon, a note with no author, a note without an appearance stream) and three see-through check highlights. Statuses: Accepted, Rejected, Completed, Cancelled, and none. S-102 has a long multi-line comment and blue markups; S-103 has no comments; S-104 is stored portrait with /Rotate 90.',
    comments,
    seeThrough,
  };
}

// --- crs_02: pump specification ---------------------------------------------

/** Text pages: a run per line, so markups can find their words. */
class Page {
  readonly runs: TextRun[] = [];
  private readonly ops: string[] = [];
  private y = 270;

  heading(s: string): TextRun {
    this.y -= 4;
    const run = this.put('F2', 11, 20, s);
    this.y -= 2;
    return run;
  }

  /** A paragraph wrapped to 170 mm; returns its lines. */
  para(s: string, size = 10): TextRun[] {
    const words = s.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (textWidth(next, 'F1', size) / MM > 170 && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    const out = lines.map((l) => this.put('F1', size, 20, l));
    this.y -= 2.5;
    return out;
  }

  /** A two-column table row with borders. */
  row(a: string, b: string, head = false): TextRun {
    const h = 7;
    if (head) this.y -= 3;
    this.ops.push(
      `0 G 0.4 w ${num(20 * MM)} ${num((this.y - h + 2) * MM)} ${num(80 * MM)} ${num(h * MM)} re ${num(100 * MM)} ${num((this.y - h + 2) * MM)} ${num(90 * MM)} ${num(h * MM)} re S`,
    );
    this.y -= 3;
    const font = head ? 'F2' : 'F1';
    this.ops.push(
      `BT /${font} 9.5 Tf 1 0 0 1 ${num(22 * MM)} ${num(this.y * MM)} Tm ${winAnsi(a)} Tj ET`,
    );
    const run = { x: 102, y: this.y, size: 9.5, text: b };
    this.ops.push(
      `BT /${font} 9.5 Tf 1 0 0 1 ${num(102 * MM)} ${num(this.y * MM)} Tm ${winAnsi(b)} Tj ET`,
    );
    this.y -= 4;
    this.runs.push(run);
    return run;
  }

  private put(font: 'F1' | 'F2', size: number, x: number, s: string): TextRun {
    this.y -= size * 0.5;
    const run = { x, y: this.y, size, text: s };
    this.ops.push(
      `BT /${font} ${num(size)} Tf 1 0 0 1 ${num(x * MM)} ${num(this.y * MM)} Tm ${winAnsi(s)} Tj ET`,
    );
    this.runs.push(run);
    return run;
  }

  content(header: string, pageNo: number, of: number): string {
    return [
      `BT /F1 8 Tf 1 0 0 1 ${num(20 * MM)} ${num(285 * MM)} Tm ${winAnsi(header)} Tj ET`,
      `0.5 G 0.4 w ${num(20 * MM)} ${num(282 * MM)} m ${num(190 * MM)} ${num(282 * MM)} l S`,
      ...this.ops,
      `BT /F1 8 Tf 1 0 0 1 ${num(175 * MM)} ${num(12 * MM)} Tm ${winAnsi(`Page ${String(pageNo)} of ${String(of)}`)} Tj ET`,
    ].join('\n');
  }
}

const find = (runs: TextRun[], word: string): TextRun => {
  const r = runs.find((x) => x.text.includes(word));
  if (!r) throw new Error(`no line with "${word}"`);
  return r;
};

export function pumpSpec(): ReviewDoc {
  const doc = new Doc();
  const helv = doc.fontRefs.F1;
  const bold = doc.fontRefs.F2;
  const A4 = { width: 210 * MM, height: 297 * MM };
  const header = 'PS-1200-ME-SPC-0007  Rev B  Centrifugal pump specification';
  let comments = 0;
  let seeThrough = 0;

  // Page 1: scope and codes.
  const p1 = new Page();
  p1.heading('1 SCOPE');
  p1.para(
    'This specification covers the minimum requirements for the design, materials, fabrication, inspection, testing and supply of horizontal centrifugal pumps for the Riverside pump house (sample project).',
  );
  p1.heading('2 CODES AND STANDARDS');
  p1.para(
    'Pumps shall comply with API 610 12th Edition, Centrifugal Pumps for Petroleum, Petrochemical and Natural Gas Industries, and with the project data sheets. Where this specification and the data sheet differ, the data sheet governs.',
  );
  p1.heading('3 DESIGN REQUIREMENTS');
  p1.para(
    '3.1 Each pump shall operate continuously between the minimum continuous stable flow and 120 % of the rated flow without damage or excessive vibration.',
  );
  p1.para(
    '3.2 Pumps shall be fitted with a cartridge seal to API 682. Seal flush plan 11 shall be provided unless noted otherwise on the data sheet.',
  );
  p1.para(
    '3.3 The vendor shal supply a performance curve for the impeller diameter offered and for the maximum and minimum impellers.',
  );
  p1.para(
    '3.5 Bearings shall be rolling element type with an L10 life of at least 25,000 hours. Make: SKF or equal.',
  );
  doc.addPage({
    ...A4,
    content: p1.content(header, 1, 3),
    annots: (w, pg) => {
      const runs = p1.runs;
      const api = find(runs, 'API 610 12th');
      const h1 = textMarkup(
        w,
        pg,
        who(
          'SPC-H1',
          'Highlight',
          'Confirm the edition: the project basis is API 610 11th Edition.',
          day(17, 9, 10),
          LEAD,
        ),
        'Highlight',
        [wordBox(api, 'API 610 12th Edition')],
        YELLOW,
      );
      const u2run = find(runs, 'minimum continuous stable flow');
      const u2 = textMarkup(
        w,
        pg,
        who(
          'SPC-U2',
          'Underline',
          'State the minimum continuous stable flow in m³/h on the data sheet.',
          day(17, 9, 30),
          LEAD,
        ),
        'Underline',
        [wordBox(u2run, 'minimum continuous stable flow')],
        BLUE,
      );
      const s3run = find(runs, 'or equal');
      const s3 = textMarkup(
        w,
        pg,
        who(
          'SPC-S3',
          'Strikeout',
          "Delete 'or equal': only the listed makes are acceptable.",
          day(17, 9, 45),
          LEAD,
        ),
        'StrikeOut',
        [wordBox(s3run, 'or equal')],
        [0.85, 0.1, 0.1],
      );
      const c4run = find(runs, 'cartridge seal');
      const c4 = caret(
        w,
        pg,
        who('SPC-C4', 'Inserted text', 'dual ', day(17, 10, 0), LEAD),
        c4run,
        'cartridge',
      );
      const q5run = find(runs, 'shal ');
      const q5 = textMarkup(
        w,
        pg,
        who('SPC-Q5', 'Squiggly', 'Spelling: shall.', day(17, 10, 5), LEAD),
        'Squiggly',
        [wordBox(q5run, 'shal')],
        [0.1, 0.6, 0.1],
      );
      const n6 = note(
        w,
        pg,
        who('SPC-N6', 'Note', 'Clause numbering skips 3.4.', day(17, 10, 20), LEAD),
        [192, find(runs, '3.5 Bearings').y - 2],
      );
      // Two-line highlight over a whole sentence.
      const two = runs.filter(
        (r) => r.text.includes('Where this') || r.text.includes('data sheet governs'),
      );
      const h7 = textMarkup(
        w,
        pg,
        who(
          'SPC-H7',
          'Highlight',
          'Order of precedence conflicts with the contract (contract > data sheet > specification).',
          day(17, 10, 40),
          CHECKER,
        ),
        'Highlight',
        two.map((r) => {
          const i = r.text.indexOf('Where this');
          const from = i >= 0 ? r.text.slice(i) : r.text.slice(0, r.text.indexOf('governs.') + 8);
          return wordBox(r, from);
        }),
        YELLOW,
      );
      const out = [
        h1,
        reply(
          w,
          pg,
          who(
            'SPC-H1-r1',
            'Reply',
            'Vendor offers 12th Edition; 11th Edition deviations listed in VD-03.',
            day(19, 15, 0),
            VENDOR,
          ),
          h1,
          [20, 200],
        ),
        setState(
          w,
          pg,
          who('SPC-H1-s', 'Status', 'Accepted set by A. Iyer', day(20, 9, 0), LEAD),
          h1,
          [20, 200],
          'Accepted',
        ),
        u2,
        s3,
        setState(
          w,
          pg,
          who('SPC-S3-s', 'Status', 'Completed set by A. Iyer', day(21, 9, 0), LEAD),
          s3,
          [20, 200],
          'Completed',
        ),
        c4,
        q5,
        n6,
        h7,
      ];
      comments += 7;
      return out;
    },
  });

  // Page 2: data sheet table.
  const p2 = new Page();
  p2.heading('4 PUMP DATA');
  p2.row('Item', 'Value', true);
  const rows: [string, string][] = [
    ['Tag numbers', 'P-1201 A/B'],
    ['Service', 'Raw water transfer'],
    ['Rated flow', '180 m3/h'],
    ['Differential head', '62 m'],
    ['Design pressure', '16 bar(g)'],
    ['Design temperature', '65 °C'],
    ['NPSH required', ''],
    ['Casing material', 'ASTM A216 WCB'],
    ['Impeller material', 'ASTM A743 CA6NM'],
    ['Driver', 'Electric motor, 415 V, 50 Hz'],
  ];
  const tRuns = rows.map(([a, b]) => ({ label: a, run: p2.row(a, b) }));
  p2.para('');
  p2.heading('5 INSPECTION AND TESTING');
  p2.para(
    '5.1 Hydrostatic test at 1.5 times the maximum allowable working pressure for 30 minutes minimum.',
  );
  p2.para(
    '5.2 Performance test witnessed by the purchaser at the vendor works, five points including shut-off.',
  );
  doc.addPage({
    ...A4,
    content: p2.content(header, 2, 3),
    annots: (w, pg) => {
      const at = (label: string) => {
        const run = tRuns.find((t) => t.label === label)?.run;
        if (!run) throw new Error(`no row ${label}`);
        return run;
      };
      const press = at('Design pressure');
      const pBox = wordBox(press, '16 bar(g)');
      const npsh = at('NPSH required');
      const out = [
        callout(
          w,
          pg,
          helv,
          who(
            'SPC-CO8',
            'Callout',
            'Design pressure to be 20 bar(g) per process data sheet Rev C.',
            day(18, 11, 0),
            CHECKER,
          ),
          { x: 140, y: press.y + 12, w: 52, h: 12 },
          ['Design pressure to be 20 bar(g)', 'per process data sheet Rev C.'],
          [pBox[2] / MM + 1, (pBox[1] + pBox[3]) / 2 / MM],
        ),
        rectangle(
          w,
          pg,
          who('SPC-R9', 'Rectangle', 'NPSH required value missing.', day(18, 11, 20), CHECKER),
          { x: 18.5, y: npsh.y - 3.2, w: 173, h: 8.4 },
          [0.85, 0.1, 0.1],
          1,
        ),
        textBox(
          w,
          pg,
          helv,
          who(
            'SPC-TB10',
            'Text box',
            'Add rows for motor rating (kW) and seal plan.',
            day(18, 11, 40),
            LEAD,
          ),
          { x: 120, y: 120, w: 70, h: 9 },
          ['Add rows for motor rating (kW) and seal plan.'],
          BLUE,
        ),
        // Check highlight (35 %): left out by "Ignore highlights".
        textMarkup(
          w,
          pg,
          who('SPC-K11', 'Highlight', 'Checked', day(18, 12, 0), CHECKER, 0.35),
          'Highlight',
          [wordBox(at('Casing material'), 'ASTM A216 WCB')],
          YELLOW,
        ),
      ];
      comments += 4;
      seeThrough += 1;
      return out;
    },
  });

  // Page 3: documents; a note without author, a cancelled one, a stamp.
  const p3 = new Page();
  p3.heading('6 VENDOR DOCUMENTS');
  p3.para(
    '6.1 The vendor shall submit general arrangement drawings, cross-sectional drawings with parts lists, performance curves, seal and flush plan drawings and the inspection and test plan within four weeks of the purchase order.',
  );
  p3.para('6.2 Final documents shall be submitted as searchable PDF files with bookmarks.');
  doc.addPage({
    ...A4,
    content: p3.content(header, 3, 3),
    annots: (w, pg) => {
      const n = note(
        w,
        pg,
        who('SPC-N12', 'Note', 'Two weeks is the project standard, not four.', day(19, 9, 0), ''),
        [192, 240],
      );
      const n2 = note(
        w,
        pg,
        who('SPC-N13', 'Note', 'Ask for native CAD files as well.', day(19, 9, 30), CHECKER),
        [192, 220],
      );
      const out = [
        n,
        n2,
        reply(
          w,
          pg,
          who('SPC-N13-r1', 'Reply', 'Not needed for this package.', day(20, 10, 0), LEAD),
          n2,
          [192, 220],
        ),
        setState(
          w,
          pg,
          who('SPC-N13-s', 'Status', 'Cancelled set by R. Mehta', day(20, 10, 30), CHECKER),
          n2,
          [192, 220],
          'Cancelled',
        ),
        stamp(
          w,
          pg,
          bold,
          who('SPC-ST14', 'Stamp', 'Approved as noted', day(21, 16, 0), LEAD),
          { x: 120, y: 150, w: 65, h: 18 },
          ['APPROVED AS NOTED'],
          GREEN,
        ),
      ];
      comments += 3;
      return out;
    },
  });

  return {
    file: 'crs_02_pump_specification_review.pdf',
    bytes: doc.finish(
      info(
        'PS-1200-ME-SPC-0007 Pump specification (review copy)',
        'CRS review corpus 02, self-made',
        day(22),
      ),
      'crs-review-02',
    ),
    summary:
      'A4 pump specification, 3 pages, no page labels. Text markups on the words they comment on: highlights (one over two lines), underline, strikeout, inserted text (caret), squiggly; a margin note; on page 2 a callout pointing at a table cell, a rectangle round an empty table row, a text box and one see-through check highlight; on page 3 a note with no author, a cancelled note with a reply, and a stamp. Statuses: Accepted, Completed, Cancelled, and none.',
    comments,
    seeThrough,
  };
}

export const REVIEW_DOCS = [drawingSet, pumpSpec];
