// Standard review annotations with appearance streams (CLAUDE.md rule 6), as a
// checker leaves them on a drawing: clouds, callouts, sticky notes with a
// reply, and see-through check highlights (marker strokes, highlight, area).

import { MM, num, pdfString, type PdfWriter } from './pdf.ts';
import type { Pt } from './canvas.ts';

export interface AnnotCommon {
  /** Unique name (/NM). */
  name: string;
  author: string;
  subject: string;
  contents: string;
  date: string;
}

type Rgb = readonly [number, number, number];
const rgb = (c: Rgb): string => c.map(num).join(' ');

function common(a: AnnotCommon, page: number): string {
  return `/P ${String(page)} 0 R /NM ${pdfString(a.name)} /T ${pdfString(a.author)} /Subj ${pdfString(a.subject)} /Contents ${pdfString(a.contents)} /M (${a.date}) /CreationDate (${a.date}) /F 4`;
}

function form(
  w: PdfWriter,
  bbox: [number, number, number, number],
  body: string,
  res = '',
): number {
  return w.add({
    dict: `<< /Type /XObject /Subtype /Form /BBox [${bbox.map(num).join(' ')}]${res ? ` /Resources ${res}` : ''} >>`,
    stream: body,
  });
}

const MULTIPLY = '<< /ExtGState << /GS0 << /Type /ExtGState /BM /Multiply /CA 1 /ca 1 >> >> >>';

/** The scalloped outline of a cloud around a polygon (points in points). */
function cloudPath(pts: Pt[], r: number): string {
  // Orientation: positive area = counter-clockwise; bulges point outwards.
  let area = 0;
  pts.forEach(([x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length] ?? [0, 0];
    area += x * ny - nx * y;
  });
  const out = area > 0 ? 1 : -1;
  const ops: string[] = [];
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length] ?? [0, 0];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / (2 * r)));
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    // Outward normal.
    const nx = uy * out;
    const ny = -ux * out;
    for (let k = 0; k < n; k++) {
      const ax = x0 + ((x1 - x0) * k) / n;
      const ay = y0 + ((y1 - y0) * k) / n;
      const bx = x0 + ((x1 - x0) * (k + 1)) / n;
      const by = y0 + ((y1 - y0) * (k + 1)) / n;
      const h = (Math.hypot(bx - ax, by - ay) / 2) * (4 / 3);
      if (i === 0 && k === 0) ops.push(`${num(ax)} ${num(ay)} m`);
      ops.push(
        `${num(ax + nx * h)} ${num(ay + ny * h)} ${num(bx + nx * h)} ${num(by + ny * h)} ${num(bx)} ${num(by)} c`,
      );
    }
  });
  return `${ops.join(' ')} h`;
}

/** A red revision cloud (Polygon with a cloudy border effect) around a box in mm. */
export function cloud(
  w: PdfWriter,
  page: number,
  a: AnnotCommon,
  box: { x: number; y: number; w: number; h: number },
  color: Rgb = [1, 0, 0],
): number {
  const pts: Pt[] = [
    [box.x * MM, box.y * MM],
    [(box.x + box.w) * MM, box.y * MM],
    [(box.x + box.w) * MM, (box.y + box.h) * MM],
    [box.x * MM, (box.y + box.h) * MM],
  ];
  const r = 3 * MM;
  const pad = r * 1.6;
  const rect: [number, number, number, number] = [
    box.x * MM - pad,
    box.y * MM - pad,
    (box.x + box.w) * MM + pad,
    (box.y + box.h) * MM + pad,
  ];
  const ap = form(w, rect, `${rgb(color)} RG 1 w 1 J 1 j ${cloudPath(pts, r)} S`);
  return w.add(
    `<< /Type /Annot /Subtype /Polygon ${common(a, page)} /Rect [${rect.map(num).join(' ')}] /Vertices [${pts
      .flat()
      .map(num)
      .join(
        ' ',
      )}] /C [${rgb(color)}] /BS << /W 1 /S /S >> /BE << /S /C /I 1 >> /IT /PolygonCloud /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A callout text box (FreeText) with a red border, 9 pt Helvetica. */
export function textBox(
  w: PdfWriter,
  page: number,
  helv: number,
  a: AnnotCommon,
  box: { x: number; y: number; w: number; h: number },
  lines: string[],
): number {
  const rect: [number, number, number, number] = [
    box.x * MM,
    box.y * MM,
    (box.x + box.w) * MM,
    (box.y + box.h) * MM,
  ];
  const [x0, y0, x1, y1] = rect;
  let body = `1 1 1 rg ${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)} re f 1 0 0 RG 1 w ${num(x0 + 0.5)} ${num(y0 + 0.5)} ${num(x1 - x0 - 1)} ${num(y1 - y0 - 1)} re S BT 1 0 0 rg /Helv 9 Tf 11 TL ${num(x0 + 4)} ${num(y1 - 12)} Td`;
  lines.forEach((l, i) => {
    body += ` ${i === 0 ? '' : 'T* '}${pdfString(l)} Tj`;
  });
  body += ' ET';
  const ap = form(w, rect, body, `<< /Font << /Helv ${String(helv)} 0 R >> >>`);
  return w.add(
    `<< /Type /Annot /Subtype /FreeText ${common(a, page)} /Rect [${rect.map(num).join(' ')}] /DA (1 0 0 rg /Helv 9 Tf) /DS (font: Helvetica 9pt; color: #FF0000) /Q 0 /C [1 1 1] /BS << /W 1 >> /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A sticky note (Text annotation) at a point in mm; returns its object number. */
export function note(
  w: PdfWriter,
  page: number,
  a: AnnotCommon,
  at: Pt,
  reply?: { to: number },
): number {
  const x = at[0] * MM;
  const y = at[1] * MM;
  const rect: [number, number, number, number] = [x, y, x + 20, y + 20];
  const ap = form(
    w,
    rect,
    `1 0.92 0.3 rg 0 G 0.6 w ${num(x + 1)} ${num(y + 3)} 18 16 re B ${[8, 12, 16].map((d) => `${num(x + 4)} ${num(y + d)} m ${num(x + 16)} ${num(y + d)} l`).join(' ')} S`,
  );
  const irt = reply ? ` /IRT ${String(reply.to)} 0 R /RT /R` : '';
  return w.add(
    `<< /Type /Annot /Subtype /Text ${common(a, page)} /Rect [${rect.map(num).join(' ')}] /Name /Comment /C [1 0.92 0.3] /Open false${irt} /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

const YELLOW: Rgb = [1, 0.93, 0];

/** A see-through highlighter stroke (Ink, multiply) along a polyline in mm. */
export function marker(w: PdfWriter, page: number, a: AnnotCommon, pts: Pt[], widthMm = 3): number {
  const pp = pts.map(([x, y]) => [x * MM, y * MM] as const);
  const half = (widthMm * MM) / 2;
  const xs = pp.map((q) => q[0]);
  const ys = pp.map((q) => q[1]);
  const rect: [number, number, number, number] = [
    Math.min(...xs) - half,
    Math.min(...ys) - half,
    Math.max(...xs) + half,
    Math.max(...ys) + half,
  ];
  const path = pp.map(([x, y], i) => `${num(x)} ${num(y)} ${i === 0 ? 'm' : 'l'}`).join(' ');
  const ap = form(
    w,
    rect,
    `/GS0 gs ${rgb(YELLOW)} RG ${num(widthMm * MM)} w 1 J 1 j ${path} S`,
    MULTIPLY,
  );
  return w.add(
    `<< /Type /Annot /Subtype /Ink ${common(a, page)} /Rect [${rect.map(num).join(' ')}] /InkList [[${pp
      .flat()
      .map(num)
      .join(
        ' ',
      )}]] /C [${rgb(YELLOW)}] /BS << /W ${num(widthMm * MM)} >> /BM /Multiply /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A text highlight (multiply) over a box in mm. */
export function highlight(
  w: PdfWriter,
  page: number,
  a: AnnotCommon,
  box: { x: number; y: number; w: number; h: number },
): number {
  const x0 = box.x * MM;
  const y0 = box.y * MM;
  const x1 = (box.x + box.w) * MM;
  const y1 = (box.y + box.h) * MM;
  const ap = form(
    w,
    [x0, y0, x1, y1],
    `/GS0 gs ${rgb(YELLOW)} rg ${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)} re f`,
    MULTIPLY,
  );
  return w.add(
    `<< /Type /Annot /Subtype /Highlight ${common(a, page)} /Rect [${[x0, y0, x1, y1].map(num).join(' ')}] /QuadPoints [${[x0, y1, x1, y1, x0, y0, x1, y0].map(num).join(' ')}] /C [${rgb(YELLOW)}] /BM /Multiply /AP << /N ${String(ap)} 0 R >> >>`,
  );
}

/** A filled see-through area (Square, multiply) over a box in mm. */
export function area(
  w: PdfWriter,
  page: number,
  a: AnnotCommon,
  box: { x: number; y: number; w: number; h: number },
): number {
  const x0 = box.x * MM;
  const y0 = box.y * MM;
  const x1 = (box.x + box.w) * MM;
  const y1 = (box.y + box.h) * MM;
  const ap = form(
    w,
    [x0, y0, x1, y1],
    `/GS0 gs ${rgb(YELLOW)} rg ${rgb(YELLOW)} RG 1 w ${num(x0 + 0.5)} ${num(y0 + 0.5)} ${num(x1 - x0 - 1)} ${num(y1 - y0 - 1)} re B`,
    MULTIPLY,
  );
  return w.add(
    `<< /Type /Annot /Subtype /Square ${common(a, page)} /Rect [${[x0, y0, x1, y1].map(num).join(' ')}] /C [${rgb(YELLOW)}] /IC [${rgb(YELLOW)}] /BS << /W 1 >> /BM /Multiply /AP << /N ${String(ap)} 0 R >> >>`,
  );
}
