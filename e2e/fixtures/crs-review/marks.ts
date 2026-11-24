// Review comments of every kind a checker leaves, as standard PDF annotations
// with appearance streams (CLAUDE.md rule 6), for the CRS review corpus
// (M13-07, D-71). Positions are in millimetres from the page's bottom left;
// each builder writes its objects and returns the annotation's number.
// Self-made (rule 13); the clouds come from the comparison corpus.

import { cloud as corpusCloud } from '../comparison-corpus/annots.ts';
import type { Pt } from '../comparison-corpus/canvas.ts';
import { textWidth, winAnsi } from '../comparison-corpus/fonts.ts';
import { MM, num, pdfString, type PdfWriter } from '../comparison-corpus/pdf.ts';

export type Rgb = readonly [number, number, number];
export const RED: Rgb = [0.85, 0.1, 0.1];
export const BLUE: Rgb = [0.1, 0.3, 0.85];
export const GREEN: Rgb = [0.1, 0.55, 0.2];
export const YELLOW: Rgb = [1, 0.9, 0];
const rgb = (c: Rgb): string => c.map(num).join(' ');

export interface Who {
  /** Unique name (/NM): the Comment ID column. */
  name: string;
  /** Empty: no /T at all (a comment without an author). */
  author: string;
  subject: string;
  /** Empty: no /Contents. */
  contents: string;
  /** PDF date, e.g. D:20261103101500+05'30'. */
  date: string;
  /** Constant opacity (/CA); left out = 1. */
  opacity?: number;
}

type Rect = [number, number, number, number];
const pt = (mm: number): number => mm * MM;
const rectStr = (r: Rect): string => r.map(num).join(' ');

function common(a: Who, page: number): string {
  return [
    `/P ${String(page)} 0 R /NM ${pdfString(a.name)}`,
    a.author ? `/T ${pdfString(a.author)}` : '',
    `/Subj ${pdfString(a.subject)}`,
    a.contents ? `/Contents ${pdfString(a.contents)}` : '',
    `/M (${a.date}) /CreationDate (${a.date}) /F 4`,
    a.opacity === undefined ? '' : `/CA ${num(a.opacity)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** An appearance stream; `gs` adds graphics states (e.g. `/GM << /BM /Multiply >>`). */
function form(w: PdfWriter, bbox: Rect, body: string, a: Who, res = '', gs = ''): number {
  const states =
    (a.opacity === undefined
      ? ''
      : `/GS0 << /Type /ExtGState /CA ${num(a.opacity)} /ca ${num(a.opacity)} >>`) + gs;
  const all = `${res}${states ? ` /ExtGState << ${states} >>` : ''}`;
  const resources = all ? ` /Resources << ${all} >>` : '';
  return w.add({
    dict: `<< /Type /XObject /Subtype /Form /BBox [${rectStr(bbox)}]${resources} >>`,
    stream: `${a.opacity === undefined ? '' : '/GS0 gs '}${body}`,
  });
}

function bounds(pts: readonly (readonly [number, number])[], pad: number): Rect {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  ];
}

const toPt = (pts: readonly Pt[]): [number, number][] => pts.map(([x, y]) => [pt(x), pt(y)]);
const path = (pts: readonly (readonly [number, number])[]): string =>
  pts.map(([x, y], i) => `${num(x)} ${num(y)} ${i === 0 ? 'm' : 'l'}`).join(' ');

/** A box in millimetres. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle (Square) around a box. */
export function rectangle(
  w: PdfWriter,
  page: number,
  a: Who,
  b: Box,
  color: Rgb = RED,
  lw = 1.2,
): number {
  const r: Rect = [pt(b.x), pt(b.y), pt(b.x + b.w), pt(b.y + b.h)];
  const ap = form(
    w,
    r,
    `${rgb(color)} RG ${num(lw)} w ${num(r[0] + lw / 2)} ${num(r[1] + lw / 2)} ${num(r[2] - r[0] - lw)} ${num(r[3] - r[1] - lw)} re S`,
    a,
  );
  return w.add(
    `<< /Type /Annot /Subtype /Square ${common(a, page)} /Rect [${rectStr(r)}] /C [${rgb(color)}] /BS << /W ${num(lw)} >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A filled see-through area (Square with a fill) over a box: a check highlight. */
export function areaHighlight(w: PdfWriter, page: number, a: Who, b: Box): number {
  const r: Rect = [pt(b.x), pt(b.y), pt(b.x + b.w), pt(b.y + b.h)];
  const ap = form(
    w,
    r,
    `${rgb(YELLOW)} rg ${num(r[0])} ${num(r[1])} ${num(r[2] - r[0])} ${num(r[3] - r[1])} re f`,
    a,
  );
  return w.add(
    `<< /Type /Annot /Subtype /Square ${common(a, page)} /Rect [${rectStr(r)}] /C [${rgb(YELLOW)}] /IC [${rgb(YELLOW)}] /BS << /W 0 >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** An oval (Circle) inside a box. */
export function oval(
  w: PdfWriter,
  page: number,
  a: Who,
  b: Box,
  color: Rgb = RED,
  lw = 1.2,
): number {
  const r: Rect = [pt(b.x), pt(b.y), pt(b.x + b.w), pt(b.y + b.h)];
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  const rx = (r[2] - r[0] - lw) / 2;
  const ry = (r[3] - r[1] - lw) / 2;
  const k = 0.5523;
  const body = [
    `${num(cx + rx)} ${num(cy)} m`,
    `${num(cx + rx)} ${num(cy + ry * k)} ${num(cx + rx * k)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)} c`,
    `${num(cx - rx * k)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ry * k)} ${num(cx - rx)} ${num(cy)} c`,
    `${num(cx - rx)} ${num(cy - ry * k)} ${num(cx - rx * k)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)} c`,
    `${num(cx + rx * k)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ry * k)} ${num(cx + rx)} ${num(cy)} c`,
  ].join(' ');
  const ap = form(w, r, `${rgb(color)} RG ${num(lw)} w ${body} S`, a);
  return w.add(
    `<< /Type /Annot /Subtype /Circle ${common(a, page)} /Rect [${rectStr(r)}] /C [${rgb(color)}] /BS << /W ${num(lw)} >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A revision cloud around a box (Polygon, cloudy border). */
export function cloud(w: PdfWriter, page: number, a: Who, b: Box, color: Rgb = RED): number {
  return corpusCloud(
    w,
    page,
    { name: a.name, author: a.author, subject: a.subject, contents: a.contents, date: a.date },
    b,
    color,
  );
}

/** A plain closed polygon (no cloud), e.g. around an irregular zone. */
export function polygon(
  w: PdfWriter,
  page: number,
  a: Who,
  pts: Pt[],
  color: Rgb = BLUE,
  lw = 1.2,
): number {
  const pp = toPt(pts);
  const r = bounds(pp, lw);
  const ap = form(w, r, `${rgb(color)} RG ${num(lw)} w 1 j ${path(pp)} h S`, a);
  return w.add(
    `<< /Type /Annot /Subtype /Polygon ${common(a, page)} /Rect [${rectStr(r)}] /Vertices [${pp.flat().map(num).join(' ')}] /C [${rgb(color)}] /BS << /W ${num(lw)} >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** An open polyline. */
export function polyline(
  w: PdfWriter,
  page: number,
  a: Who,
  pts: Pt[],
  color: Rgb = BLUE,
  lw = 1.5,
): number {
  const pp = toPt(pts);
  const r = bounds(pp, lw);
  const ap = form(w, r, `${rgb(color)} RG ${num(lw)} w 1 J 1 j ${path(pp)} S`, a);
  return w.add(
    `<< /Type /Annot /Subtype /PolyLine ${common(a, page)} /Rect [${rectStr(r)}] /Vertices [${pp.flat().map(num).join(' ')}] /C [${rgb(color)}] /BS << /W ${num(lw)} >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** An open arrowhead's two wing ends at `tip`, pointing away from `from` (points). */
function arrowHead(
  from: readonly [number, number],
  tip: readonly [number, number],
  size: number,
): string {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (d: number) =>
    [tip[0] - size * Math.cos(ang + d), tip[1] - size * Math.sin(ang + d)] as const;
  const [l, rr] = [wing(0.45), wing(-0.45)];
  return `${num(l[0])} ${num(l[1])} m ${num(tip[0])} ${num(tip[1])} l ${num(rr[0])} ${num(rr[1])} l S`;
}

/** An arrow (Line with an open arrow at the end) from `from` to `to`. */
export function arrow(
  w: PdfWriter,
  page: number,
  a: Who,
  from: Pt,
  to: Pt,
  color: Rgb = RED,
  lw = 1.5,
): number {
  const [p0, p1] = toPt([from, to]) as [[number, number], [number, number]];
  const r = bounds([p0, p1], 10);
  const ap = form(
    w,
    r,
    `${rgb(color)} RG ${num(lw)} w 1 J 1 j ${path([p0, p1])} S ${arrowHead(p0, p1, 9)}`,
    a,
  );
  return w.add(
    `<< /Type /Annot /Subtype /Line ${common(a, page)} /Rect [${rectStr(r)}] /L [${[...p0, ...p1].map(num).join(' ')}] /LE [/None /OpenArrow] /C [${rgb(color)}] /BS << /W ${num(lw)} >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A distance measurement (Line, /IT /LineDimension) with its value as the caption. */
export function distance(
  w: PdfWriter,
  page: number,
  font: number,
  a: Who,
  from: Pt,
  to: Pt,
  label: string,
  scale: string,
): number {
  const [p0, p1] = toPt([from, to]) as [[number, number], [number, number]];
  const r = bounds([p0, p1], 14);
  const mx = (p0[0] + p1[0]) / 2;
  const my = (p0[1] + p1[1]) / 2;
  const tw = textWidth(label, 'F1', 8);
  const body = `${rgb(BLUE)} RG 0.8 w ${path([p0, p1])} S ${arrowHead(p1, p0, 6)} ${arrowHead(p0, p1, 6)} BT ${rgb(BLUE)} rg /Helv 8 Tf ${num(mx - tw / 2)} ${num(my + 3)} Td ${winAnsi(label)} Tj ET`;
  const ap = form(w, r, body, a, `/Font << /Helv ${String(font)} 0 R >>`);
  return w.add(
    `<< /Type /Annot /Subtype /Line ${common(a, page)} /Rect [${rectStr(r)}] /L [${[...p0, ...p1].map(num).join(' ')}] /LE [/OpenArrow /OpenArrow] /IT /LineDimension /Cap true /C [${rgb(BLUE)}] /BS << /W 0.8 >> /Measure << /Type /Measure /Subtype /RL /R (${scale}) /X [<< /Type /NumberFormat /U (mm) /C 0.352778 /D 1 >>] /D [<< /Type /NumberFormat /U (mm) /C 1 /D 1 >>] /A [<< /Type /NumberFormat /U (sq mm) /C 1 /D 1 >>] >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A freehand pen stroke (Ink) through the points. */
export function ink(
  w: PdfWriter,
  page: number,
  a: Who,
  pts: Pt[],
  color: Rgb = RED,
  lw = 1.5,
): number {
  const pp = toPt(pts);
  const r = bounds(pp, lw + 1);
  const ap = form(w, r, `${rgb(color)} RG ${num(lw)} w 1 J 1 j ${path(pp)} S`, a);
  return w.add(
    `<< /Type /Annot /Subtype /Ink ${common(a, page)} /Rect [${rectStr(r)}] /InkList [[${pp.flat().map(num).join(' ')}]] /C [${rgb(color)}] /BS << /W ${num(lw)} >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A loop drawn by hand around a centre (radii in mm), for ink. */
export function handLoop(cx: number, cy: number, rx: number, ry: number, steps = 28): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps + 3; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wob = 1 + 0.06 * Math.sin(i * 1.7);
    out.push([cx + rx * wob * Math.cos(t), cy + ry * wob * Math.sin(t)]);
  }
  return out;
}

/** Text lines in a box: 9 pt Helvetica, starting at the top left. */
function textBody(r: Rect, lines: string[], color: Rgb, size = 9): string {
  let body = `BT ${rgb(color)} rg /Helv ${num(size)} Tf ${num(size + 2)} TL ${num(r[0] + 4)} ${num(r[3] - size - 3)} Td`;
  lines.forEach((l, i) => {
    body += ` ${i === 0 ? '' : 'T* '}${winAnsi(l)} Tj`;
  });
  return `${body} ET`;
}

/** A text box (FreeText) with a border. */
export function textBox(
  w: PdfWriter,
  page: number,
  font: number,
  a: Who,
  b: Box,
  lines: string[],
  color: Rgb = RED,
): number {
  const r: Rect = [pt(b.x), pt(b.y), pt(b.x + b.w), pt(b.y + b.h)];
  const body = `1 1 1 rg ${num(r[0])} ${num(r[1])} ${num(r[2] - r[0])} ${num(r[3] - r[1])} re f ${rgb(color)} RG 1 w ${num(r[0] + 0.5)} ${num(r[1] + 0.5)} ${num(r[2] - r[0] - 1)} ${num(r[3] - r[1] - 1)} re S ${textBody(r, lines, color)}`;
  const ap = form(w, r, body, a, `/Font << /Helv ${String(font)} 0 R >>`);
  return w.add(
    `<< /Type /Annot /Subtype /FreeText ${common(a, page)} /Rect [${rectStr(r)}] /DA (${rgb(color)} rg /Helv 9 Tf) /Q 0 /C [1 1 1] /BS << /W 1 >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** Typed text on the drawing (FreeText, typewriter: no border, no fill). */
export function typewriter(
  w: PdfWriter,
  page: number,
  font: number,
  a: Who,
  at: Pt,
  text: string,
  color: Rgb = BLUE,
): number {
  const size = 10;
  const x = pt(at[0]);
  const y = pt(at[1]);
  const r: Rect = [x, y, x + textWidth(text, 'F1', size) + 8, y + size + 6];
  const ap = form(
    w,
    r,
    textBody(r, [text], color, size),
    a,
    `/Font << /Helv ${String(font)} 0 R >>`,
  );
  return w.add(
    `<< /Type /Annot /Subtype /FreeText ${common(a, page)} /IT /FreeTextTypeWriter /Rect [${rectStr(r)}] /DA (${rgb(color)} rg /Helv 10 Tf) /Q 0 /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/**
 * A callout (FreeText, /IT /FreeTextCallout): a text box with a leader line
 * from `tip` (the arrow end) to the box. The annotation's /Rect covers both.
 */
export function callout(
  w: PdfWriter,
  page: number,
  font: number,
  a: Who,
  b: Box,
  lines: string[],
  tip: Pt,
  color: Rgb = RED,
): number {
  const box: Rect = [pt(b.x), pt(b.y), pt(b.x + b.w), pt(b.y + b.h)];
  const [tx, ty] = [pt(tip[0]), pt(tip[1])];
  // The leader leaves the box side nearest the tip, with a short knee.
  const left = tx < box[0];
  const sx = left ? box[0] : box[2];
  const sy = (box[1] + box[3]) / 2;
  const kx = sx + (left ? -12 : 12);
  const r = bounds(
    [
      [box[0], box[1]],
      [box[2], box[3]],
      [tx, ty],
    ],
    6,
  );
  const leader = `${rgb(color)} RG 1 w ${path([
    [tx, ty],
    [kx, sy],
    [sx, sy],
  ])} S ${arrowHead([kx, sy], [tx, ty], 8)}`;
  const body = `${leader} 1 1 1 rg ${num(box[0])} ${num(box[1])} ${num(box[2] - box[0])} ${num(box[3] - box[1])} re f ${rgb(color)} RG 1 w ${num(box[0] + 0.5)} ${num(box[1] + 0.5)} ${num(box[2] - box[0] - 1)} ${num(box[3] - box[1] - 1)} re S ${textBody(box, lines, color)}`;
  const ap = form(w, r, body, a, `/Font << /Helv ${String(font)} 0 R >>`);
  const rd = [box[0] - r[0], box[1] - r[1], r[2] - box[2], r[3] - box[3]];
  return w.add(
    `<< /Type /Annot /Subtype /FreeText ${common(a, page)} /IT /FreeTextCallout /Rect [${rectStr(r)}] /RD [${rd.map(num).join(' ')}] /CL [${[tx, ty, kx, sy, sx, sy].map(num).join(' ')}] /LE /OpenArrow /DA (${rgb(color)} rg /Helv 9 Tf) /Q 0 /C [1 1 1] /BS << /W 1 >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A sticky note (Text) with its icon at a point; `ap: false` leaves out the appearance. */
export function note(
  w: PdfWriter,
  page: number,
  a: Who,
  at: Pt,
  o: {
    reply?: number;
    state?: 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'None';
    ap?: boolean;
    color?: Rgb;
  } = {},
): number {
  const x = pt(at[0]);
  const y = pt(at[1]);
  const r: Rect = [x, y, x + 20, y + 20];
  const color = o.color ?? ([1, 0.85, 0.2] as Rgb);
  const irt = o.reply === undefined ? '' : ` /IRT ${String(o.reply)} 0 R /RT /R`;
  const state = o.state ? ` /StateModel /Review /State /${o.state}` : '';
  // Replies and review states are not drawn on the page.
  const hidden = o.reply !== undefined;
  // Hidden (2): viewers list them in the thread, never on the page.
  const flags = hidden ? ' /F 30' : '';
  let apRef = '';
  if (!hidden && o.ap !== false) {
    const ap = form(
      w,
      r,
      `${rgb(color)} rg 0 G 0.6 w ${num(x + 1)} ${num(y + 3)} 18 16 re B ${[8, 12, 16].map((d) => `${num(x + 4)} ${num(y + d)} m ${num(x + 16)} ${num(y + d)} l`).join(' ')} S`,
      a,
    );
    apRef = ` /AP << /N ${String(ap)} 0 R >>`;
  }
  const dict = common(a, page).replace(' /F 4', flags || ' /F 28');
  return w.add(
    `<< /Type /Annot /Subtype /Text ${dict} /Rect [${rectStr(r)}] /Name /Comment /C [${rgb(color)}] /Open false${irt}${state}${apRef} >>`,
  );
}

/** A reply (and optionally a review state set by `a.author`) to annotation `to`. */
export function reply(w: PdfWriter, page: number, a: Who, to: number, at: Pt): number {
  return note(w, page, a, at, { reply: to });
}

export function setState(
  w: PdfWriter,
  page: number,
  a: Who,
  to: number,
  at: Pt,
  state: 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'None',
): number {
  return note(w, page, a, at, { reply: to, state });
}

/** Where a run of text sits: its baseline start (mm), font size (pt) and string. */
export interface TextRun {
  x: number;
  y: number;
  size: number;
  text: string;
}

/** The box (points) over characters [from, to) of a run of Helvetica text. */
export function wordBox(run: TextRun, word: string, nth = 0): Rect {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = run.text.indexOf(word, at + 1);
  if (at < 0) throw new Error(`"${word}" not in "${run.text}"`);
  const x0 = pt(run.x) + textWidth(run.text.slice(0, at), 'F1', run.size);
  const x1 = x0 + textWidth(word, 'F1', run.size);
  const y = pt(run.y);
  return [x0 - 0.5, y - run.size * 0.25, x1 + 0.5, y + run.size * 0.85];
}

type Markup = 'Highlight' | 'Underline' | 'StrikeOut' | 'Squiggly';

/** A text markup over the boxes (points), one quad each. */
export function textMarkup(
  w: PdfWriter,
  page: number,
  a: Who,
  kind: Markup,
  boxes: Rect[],
  color: Rgb,
): number {
  const r: Rect = [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])) - 2,
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
  const quads = boxes.flatMap(([x0, y0, x1, y1]) => [x0, y1, x1, y1, x0, y0, x1, y0]);
  const body = boxes
    .map(([x0, y0, x1, y1]) => {
      const h = y1 - y0;
      switch (kind) {
        case 'Highlight':
          return `${rgb(color)} rg ${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(h)} re f`;
        case 'Underline':
          return `${rgb(color)} RG 1 w ${num(x0)} ${num(y0 + 1)} m ${num(x1)} ${num(y0 + 1)} l S`;
        case 'StrikeOut':
          return `${rgb(color)} RG 1 w ${num(x0)} ${num(y0 + h * 0.45)} m ${num(x1)} ${num(y0 + h * 0.45)} l S`;
        case 'Squiggly': {
          const pts: [number, number][] = [];
          for (let x = x0, k = 0; x <= x1; x += 2, k++) pts.push([x, y0 + (k % 2 ? 1.6 : 0)]);
          return `${rgb(color)} RG 0.8 w ${path(pts)} S`;
        }
      }
    })
    .join(' ');
  const multiply = kind === 'Highlight' ? ' /GM << /BM /Multiply >>' : '';
  const ap = form(w, r, kind === 'Highlight' ? `/GM gs ${body}` : body, a, '', multiply);
  return w.add(
    `<< /Type /Annot /Subtype /${kind} ${common(a, page)} /Rect [${rectStr(r)}] /QuadPoints [${quads.map(num).join(' ')}] /C [${rgb(color)}] /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** An insertion mark (Caret) just before a character position; the contents say what to insert. */
export function caret(
  w: PdfWriter,
  page: number,
  a: Who,
  run: TextRun,
  before: string,
  color: Rgb = BLUE,
): number {
  const [x0, y0] = wordBox(run, before);
  const x = x0 - 3;
  const r: Rect = [x - 4, y0 - 3, x + 4, y0 + 6];
  const ap = form(
    w,
    r,
    `${rgb(color)} rg ${num(x - 4)} ${num(y0 - 3)} m ${num(x)} ${num(y0 + 6)} l ${num(x + 4)} ${num(y0 - 3)} l ${num(x)} ${num(y0 + 2)} l h f`,
    a,
  );
  return w.add(
    `<< /Type /Annot /Subtype /Caret ${common(a, page)} /Rect [${rectStr(r)}] /RD [0 0 0 0] /Sy /None /C [${rgb(color)}] /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A rubber stamp (Stamp) with a border and one or two lines of bold text. */
export function stamp(
  w: PdfWriter,
  page: number,
  boldFont: number,
  a: Who,
  b: Box,
  lines: string[],
  color: Rgb = GREEN,
  name = 'Approved',
): number {
  const r: Rect = [pt(b.x), pt(b.y), pt(b.x + b.w), pt(b.y + b.h)];
  const size = 11;
  let body = `${rgb(color)} RG 2 w ${num(r[0] + 2)} ${num(r[1] + 2)} ${num(r[2] - r[0] - 4)} ${num(r[3] - r[1] - 4)} re S BT ${rgb(color)} rg /HelvB ${String(size)} Tf`;
  const cx = (r[0] + r[2]) / 2;
  const top = (r[1] + r[3]) / 2 + ((lines.length - 1) * (size + 2)) / 2 - size * 0.35;
  lines.forEach((l, i) => {
    const tw = textWidth(l, 'F2', size);
    body += ` 1 0 0 1 ${num(cx - tw / 2)} ${num(top - i * (size + 2))} Tm ${winAnsi(l)} Tj`;
  });
  body += ' ET';
  const ap = form(w, r, body, a, `/Font << /HelvB ${String(boldFont)} 0 R >>`);
  return w.add(
    `<< /Type /Annot /Subtype /Stamp ${common(a, page)} /Name /${name} /Rect [${rectStr(r)}] /C [${rgb(color)}] /AP << /N ${String(ap)} 0 R >> >>`,
  );
}
