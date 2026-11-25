// Spike S34 (M14-01, D-74, D-79): the interop pack. One file with every
// measurement kind as one standard markup (and the alternatives where the
// standard choice is uncertain, plus a Distance as version 1.1.0 saved it),
// built on the measure corpus with the app's own engine and saved with Ctrl+S
// (incremental, the object layer's staged keys, the page's /PieceInfo).
//
// Pages: 1 floor plan 1:100 (Length ×2, Polylength, Perimeter, Area, Volume
// with cutouts, Count, the summary table); 2 pipe run 1:50 (Polylength, Angle
// ×2, Radius on an arc, Radius and Diameter on circles, Count in five more
// shapes); 3 three scales (Length per scale, a Cutout area, the alternatives:
// Angle and Count as Stamps, the bend Radius as a PolyLine, and the 1.1.0
// Distance: a Line plus a grouped FreeText).
/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/non-nullable-type-assertion-style -- corpus points and test pages known to exist (spike code) */
import {
  PdfAnnotationLineEnding,
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfDocumentObject,
} from '@embedpdf/models';
import {
  measureSheetBytes,
  measureManifest,
  type UserPt,
} from '../../e2e/fixtures/measure-corpus/index.ts';
import { dimensionGeometry, dimensionPoints, leaderFor } from '../../src/model/dimension.ts';
import { labelRect } from '../../src/model/measurement.ts';
import { PdfName, type PdfValue } from '../../src/model/pdf/objects.ts';
import { fromJson } from '../../src/model/pdf/wire.ts';
import { measureToPdf, unitsPerPoint, type Scale } from '../../src/model/scale.ts';
import { fixLineEndingAppearance } from '../../src/workers/render/lineEndingAppearance.ts';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium.ts';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';
import {
  drawMeasure,
  planDrawing,
  type Caption,
  type MeasureDrawing,
  type Rgb,
} from './appearance.ts';
import { open, save, type Engine } from './engine.ts';
import {
  angleArc,
  arcOps,
  areaLabelPoint,
  bounds,
  dist,
  fnum,
  insideAngle,
  lineCaption,
  longestSegment,
  netArea,
  openArrow,
  pathLength,
  pathOps,
  symbolOps,
  xy,
  type Box,
  type Pt,
  type Shape,
} from './geometry.ts';
import { geometryFingerprint, pageEntries, type TriyaEntry, type Tool } from './triyaData.ts';

export const RED = '#E44234';
const RED_RGB: Rgb = [0xe4 / 255, 0x42 / 255, 0x34 / 255];
const BLUE = '#1F5FBF';
const BLUE_RGB: Rgb = [0x1f / 255, 0x5f / 255, 0xbf / 255];
const AUTHOR = 'Triya PDF (spike S34)';
const MODIFIED = 'D:20261125120000Z';

/** What the pack holds, for the report and the owner's checklist. */
export interface PackItem {
  page: number;
  id: string;
  tool: Tool | 'Distance 1.1.0' | 'Distance 1.1.0 label';
  subtype: string;
  variant: 'proposal' | 'alternative' | 'v1.1.0';
  contents: string;
  where: string;
  rect: Box;
  fontBytes: number;
}

const P = (p: UserPt): Pt => ({ x: p[0], y: p[1] });

const nf = (n: number, d: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

class Pack {
  readonly items: PackItem[] = [];
  readonly entries = new Map<number, Map<string, TriyaEntry>>();
  private n = 0;
  readonly e: Engine;
  readonly doc: PdfDocumentObject;
  readonly heights: number[];
  constructor(e: Engine, doc: PdfDocumentObject, heights: number[]) {
    this.e = e;
    this.doc = doc;
    this.heights = heights;
  }

  id(prefix: string): string {
    return `s34-${prefix}-${String(++this.n).padStart(2, '0')}`;
  }

  /** User space → EmbedPDF's page points (top-left origin, y down; no crop box offset here). */
  ep(page: number, p: Pt): Pt {
    return { x: p.x, y: (this.heights[page] ?? 0) - p.y };
  }

  rectE(page: number, pts: Pt[], pad = 20) {
    const [x0, y0, x1, y1] = bounds(pts, pad);
    const a = this.ep(page, { x: x0, y: y1 });
    return { origin: a, size: { width: x1 - x0, height: y1 - y0 } };
  }

  async create(page: number, annot: Record<string, unknown>, context?: unknown): Promise<void> {
    const pg = this.doc.pages[page];
    if (!pg) throw new Error(`no page ${String(page)}`);
    const full = {
      pageIndex: page,
      flags: ['print'],
      opacity: 1,
      author: AUTHOR,
      created: new Date('2026-11-25T12:00:00Z'),
      ...annot,
    };
    const args: unknown[] = [this.doc, pg, full, ...(context ? [context] : [])];
    const fn = this.e.native.createPageAnnotation.bind(this.e.native) as (...a: unknown[]) => {
      toPromise(): Promise<unknown>;
    };
    await fn(...args).toPromise();
    this.e.tracker.recordMutation('createPageAnnotation', args);
  }

  stage(page: number, id: string, set: Record<string, PdfValue>): void {
    this.e.tracker.stagePatch(this.doc.id, { page, annot: id }, new Map(Object.entries(set)));
  }

  entry(page: number, id: string, e: TriyaEntry): void {
    const m = this.entries.get(page) ?? new Map<string, TriyaEntry>();
    m.set(id, e);
    this.entries.set(page, m);
  }

  async draw(page: number, id: string, d: MeasureDrawing) {
    const r = await drawMeasure(this.e, this.doc.id, page, id, d);
    if (!r.ok) throw new Error(`appearance not set on ${id}`);
    return r;
  }

  note(item: Omit<PackItem, 'rect' | 'fontBytes'>, r: { rect: Box; fontBytes: number }): void {
    this.items.push({ ...item, rect: r.rect, fontBytes: r.fontBytes });
  }
}

const measureOf = (s: Scale): PdfValue => fromJson(measureToPdf(s));
const lengthText = (pts: number, s: Scale): string =>
  `${nf(pts * unitsPerPoint(s), s.precision)} ${s.unit}`;
/** Square points → m² (scales in mm). */
const m2 = (sqPts: number, s: Scale): number => (sqPts * unitsPerPoint(s) ** 2) / 1e6;
const cap = (text: string, place: Caption['place'], color: Rgb = RED_RGB): Caption => ({
  text,
  place,
  color,
});
const labelled = (label: string | undefined, v: string): string => (label ? `${label}: ${v}` : v);

// ------------------------------------------------------------------ kinds

async function length(
  k: Pack,
  page: number,
  a: Pt,
  b: Pt,
  s: Scale,
  o: { offset?: number; where: 'above' | 'inline'; label?: string; along?: number },
): Promise<void> {
  const id = k.id('length');
  const leader = o.offset ? leaderFor(o.offset) : null;
  const g = dimensionGeometry(a, b, leader, false);
  const text = labelled(o.label, lengthText(dist(a, b), s));
  await k.create(page, {
    type: PdfAnnotationSubtype.LINE,
    id,
    rect: k.rectE(page, [a, b, ...dimensionPoints(g)]),
    linePoints: { start: k.ep(page, a), end: k.ep(page, b) },
    lineEndings: {
      start: PdfAnnotationLineEnding.OpenArrow,
      end: PdfAnnotationLineEnding.OpenArrow,
    },
    strokeColor: RED,
    strokeWidth: 1,
    color: 'transparent',
    intent: 'LineDimension',
    contents: text,
    subject: 'Length',
  });
  const r = await k.draw(page, id, {
    base: 'pdfium',
    leader,
    gap: o.where === 'inline',
    captions: [cap(text, (w, h) => lineCaption(g.start, g.end, o.where, w, h, 1.5, o.along))],
    extent: [a, b, ...dimensionPoints(g)],
    margin: 8,
  });
  k.stage(page, id, {
    IT: new PdfName('LineDimension'),
    Measure: measureOf(s),
    Cap: true,
    CP: new PdfName(o.where === 'inline' ? 'Inline' : 'Top'),
  });
  k.entry(page, id, {
    tool: 'Length',
    ...(o.label ? { label: o.label } : {}),
    fp: geometryFingerprint('Line', [a, b], r.rect),
  });
  k.note(
    {
      page,
      id,
      tool: 'Length',
      subtype: 'Line',
      variant: 'proposal',
      contents: text,
      where: o.where === 'inline' ? 'caption In line (/CP /Inline)' : 'caption Above (/CP /Top)',
    },
    r,
  );
}

async function path(
  k: Pack,
  page: number,
  pts: Pt[],
  closed: boolean,
  s: Scale,
  label?: string,
  along = 0.5,
): Promise<void> {
  const tool: Tool = closed ? 'Perimeter' : 'Polylength';
  const id = k.id(tool.toLowerCase());
  const first = pts[0] as Pt;
  const verts = closed ? [...pts, first] : pts;
  const text = labelled(label, lengthText(pathLength(pts, closed), s));
  const [sa, sb] = longestSegment(pts, closed);
  await k.create(page, {
    type: PdfAnnotationSubtype.POLYLINE,
    id,
    rect: k.rectE(page, verts),
    vertices: verts.map((p) => k.ep(page, p)),
    strokeColor: RED,
    strokeWidth: 1,
    color: 'transparent',
    intent: 'PolyLineDimension',
    contents: text,
    subject: tool,
  });
  const r = await k.draw(page, id, {
    base: 'pdfium',
    captions: [cap(text, (w, h) => lineCaption(sa, sb, 'above', w, h, 1.5, along))],
    extent: verts,
    margin: 2,
  });
  k.stage(page, id, { IT: new PdfName('PolyLineDimension'), Measure: measureOf(s) });
  k.entry(page, id, {
    tool,
    ...(label ? { label } : {}),
    fp: geometryFingerprint('PolyLine', verts, r.rect),
  });
  k.note(
    {
      page,
      id,
      tool,
      subtype: 'PolyLine',
      variant: 'proposal',
      contents: text,
      where: closed
        ? 'closed: the last vertex repeats the first; value on the longest side'
        : 'open path; value on the longest segment',
    },
    r,
  );
}

async function area(
  k: Pack,
  page: number,
  outer: Pt[],
  holes: Pt[][],
  s: Scale,
  o: { tool: 'Area' | 'Volume' | 'Cutout'; label?: string; depthMm?: number; decimals?: number },
): Promise<void> {
  const id = k.id(o.tool.toLowerCase());
  const a = m2(netArea(outer, holes), s);
  const d = o.decimals ?? 2;
  const value =
    o.tool === 'Volume' ? `${nf((a * (o.depthMm ?? 0)) / 1000, d)} m³` : `${nf(a, d)} m²`;
  const text = labelled(o.label, value);
  await k.create(page, {
    type: PdfAnnotationSubtype.POLYGON,
    id,
    rect: k.rectE(page, outer),
    vertices: outer.map((p) => k.ep(page, p)),
    strokeColor: RED,
    strokeWidth: 1,
    color: 'transparent',
    intent: 'PolygonDimension',
    contents: text,
    subject: o.tool === 'Cutout' ? 'Area' : o.tool,
  });
  const rings = [outer, ...holes].map((r) => pathOps(r, true)).join(' ');
  const ops = [
    `q /Fill gs ${RED_RGB.map((v) => v.toFixed(3)).join(' ')} rg ${rings} f* Q`,
    `${RED_RGB.map((v) => v.toFixed(3)).join(' ')} RG 1 w 1 j ${pathOps(outer, true)} S`,
    holes.length ? `[3 2] 0 d ${holes.map((h) => pathOps(h, true)).join(' ')} S [] 0 d` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const r = await k.draw(page, id, {
    base: 'own',
    ops,
    states: { Fill: { ca: 0.15 } },
    captions: [
      cap(text, (w, h) => ({
        at: areaLabelPoint(outer, holes, w, h),
        angle: 0,
        width: w,
        height: h,
      })),
    ],
    extent: outer,
    margin: 2,
  });
  k.stage(page, id, { IT: new PdfName('PolygonDimension'), Measure: measureOf(s) });
  k.entry(page, id, {
    tool: o.tool === 'Cutout' ? 'Area' : o.tool,
    ...(o.label ? { label: o.label } : {}),
    ...(o.depthMm !== undefined ? { depth: o.depthMm } : {}),
    unit: o.tool === 'Volume' ? 'm³' : 'm²',
    decimals: d,
    ...(holes.length ? { holes } : {}),
    fp: geometryFingerprint('Polygon', outer, r.rect),
  });
  k.note(
    {
      page,
      id,
      tool: o.tool,
      subtype: 'Polygon',
      variant: 'proposal',
      contents: text,
      where: holes.length
        ? `${String(holes.length)} holes cut by an even-odd fill; holes in /PieceInfo; no /IC`
        : 'see-through fill in the appearance only; no /IC',
    },
    r,
  );
}

/** A one-page PDF of `w` × `h` points with no resources: a Stamp's first appearance, replaced by ours. */
function blankPage(w: number, h: number): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(w)} ${String(h)}] /Resources << >> /Contents 4 0 R >>`,
    '<< /Length 13 >>\nstream\n0 0 m 0 0 l S\nendstream',
  ];
  let out = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

/** A Stamp whose appearance is entirely ours. */
async function stamp(
  k: Pack,
  page: number,
  id: string,
  d: MeasureDrawing,
  contents: string,
  subject: string,
) {
  const { rect } = await planDrawing(k.e, d);
  const [x0, y0, x1, y1] = rect;
  const tl = k.ep(page, { x: x0, y: y1 });
  await k.create(
    page,
    {
      type: PdfAnnotationSubtype.STAMP,
      id,
      rect: { origin: tl, size: { width: x1 - x0, height: y1 - y0 } },
      contents,
      subject,
    },
    { data: blankPage(x1 - x0, y1 - y0).slice().buffer },
  );
  return k.draw(page, id, { ...d, generate: false });
}

async function angle(
  k: Pack,
  page: number,
  [a, c, b]: [Pt, Pt, Pt],
  as: 'polyline' | 'stamp',
): Promise<void> {
  const id = k.id(as === 'stamp' ? 'angle-stamp' : 'angle');
  const deg = insideAngle(a, c, b);
  const text = `∠ ${nf(deg, 1)}°`;
  const arc = angleArc(a, c, b);
  const rad = Math.min(28, 0.35 * Math.min(dist(a, c), dist(c, b)));
  const col = RED_RGB.map((v) => v.toFixed(3)).join(' ');
  const arms = `${col} RG 1 w ${pathOps([a, c, b], false)} S`;
  const ops = `${col} RG 0.75 w ${arcOps(c, rad, arc.a0, arc.a1)} S`;
  const dir = { x: Math.cos(arc.mid), y: Math.sin(arc.mid) };
  const caption = cap(text, (w, h) => {
    const r = rad + 3 + Math.hypot(w * dir.x, h * dir.y) / 2;
    return { at: { x: c.x + dir.x * r, y: c.y + dir.y * r }, angle: 0, width: w, height: h };
  });
  const drawing: MeasureDrawing = {
    base: as === 'stamp' ? 'own' : 'pdfium',
    ops: as === 'stamp' ? `${arms}\n${ops}` : ops,
    captions: [caption],
    extent: [a, c, b],
    margin: 2,
  };
  let r;
  if (as === 'stamp') r = await stamp(k, page, id, drawing, text, 'Angle');
  else {
    await k.create(page, {
      type: PdfAnnotationSubtype.POLYLINE,
      id,
      rect: k.rectE(page, [a, c, b]),
      vertices: [a, c, b].map((p) => k.ep(page, p)),
      strokeColor: RED,
      strokeWidth: 1,
      color: 'transparent',
      contents: text,
      subject: 'Angle',
    });
    r = await k.draw(page, id, drawing);
  }
  k.entry(page, id, {
    tool: 'Angle',
    fp: geometryFingerprint(as === 'stamp' ? 'Stamp' : 'PolyLine', [a, c, b], r.rect),
  });
  k.note(
    {
      page,
      id,
      tool: 'Angle',
      subtype: as === 'stamp' ? 'Stamp' : 'PolyLine',
      variant: as === 'stamp' ? 'proposal' : 'alternative',
      contents: text,
      where:
        as === 'stamp'
          ? 'arms, arc and value all in a Stamp appearance; no viewer redraws it'
          : 'three-vertex PolyLine (no /IT, no /Measure); arc and value in its appearance',
    },
    r,
  );
}

async function round(
  k: Pack,
  page: number,
  tool: 'Radius' | 'Diameter',
  c: Pt,
  rPts: number,
  s: Scale,
  o: {
    arc?: [number, number];
    lineAt: number;
    as: 'stamp' | 'circle' | 'polyline';
    by: 'centre' | 'three';
  },
): Promise<void> {
  const id = k.id(`${tool.toLowerCase()}-${o.as}`);
  const real = (tool === 'Diameter' ? 2 : 1) * rPts * unitsPerPoint(s);
  const text = `${tool === 'Diameter' ? 'Ø' : 'R'} ${nf(real, s.precision)} ${s.unit}`;
  const col = RED_RGB.map((v) => v.toFixed(3)).join(' ');
  const [a0, a1] = o.arc ?? [0, 2 * Math.PI];
  const u = { x: Math.cos(o.lineAt), y: Math.sin(o.lineAt) };
  const edge = { x: c.x + u.x * rPts, y: c.y + u.y * rPts };
  const from = tool === 'Diameter' ? { x: c.x - u.x * rPts, y: c.y - u.y * rPts } : c;
  const curve = `${col} RG 1 w ${arcOps(c, rPts, a0, a1)}${o.arc ? '' : ' h'} S`;
  const head = Math.min(8, rPts * 0.4);
  const line = [
    `${col} RG 0.75 w ${xy(from)} m ${xy(edge)} l S`,
    openArrow(from, edge, head),
    tool === 'Diameter' ? openArrow(edge, from, head) : '',
    tool === 'Radius'
      ? `${xy({ x: c.x - 3, y: c.y })} m ${xy({ x: c.x + 3, y: c.y })} l ${xy({ x: c.x, y: c.y - 3 })} m ${xy({ x: c.x, y: c.y + 3 })} l S`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const circleBox: Box = [c.x - rPts, c.y - rPts, c.x + rPts, c.y + rPts];
  const samples: Pt[] = [];
  const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 36)));
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    samples.push({ x: c.x + rPts * Math.cos(t), y: c.y + rPts * Math.sin(t) });
  }
  const drawing: MeasureDrawing = {
    base: o.as === 'polyline' ? 'pdfium' : 'own',
    ops: o.as === 'polyline' ? line : `${curve}\n${line}`,
    // A Diameter's caption sits off the centre, where a drawing usually has its own label.
    captions: [
      cap(text, (w, h) =>
        lineCaption(from, edge, 'above', w, h, 1.5, tool === 'Diameter' ? 0.75 : 0.5),
      ),
    ],
    extent:
      o.as === 'circle'
        ? [
            { x: circleBox[0], y: circleBox[1] },
            { x: circleBox[2], y: circleBox[3] },
          ]
        : [...samples, c, from, edge],
    margin: 2,
    ...(o.as === 'circle' ? { inner: circleBox } : {}),
  };
  let r;
  if (o.as === 'stamp') r = await stamp(k, page, id, drawing, text, tool);
  else if (o.as === 'polyline')
    await k.create(page, {
      type: PdfAnnotationSubtype.POLYLINE,
      id,
      rect: k.rectE(page, samples),
      vertices: samples.map((p) => k.ep(page, p)),
      strokeColor: RED,
      strokeWidth: 1,
      color: 'transparent',
      contents: text,
      subject: tool,
    });
  else
    await k.create(page, {
      type: PdfAnnotationSubtype.CIRCLE,
      id,
      rect: k.rectE(
        page,
        [
          { x: circleBox[0], y: circleBox[1] },
          { x: circleBox[2], y: circleBox[3] },
        ],
        0,
      ),
      strokeColor: RED,
      strokeWidth: 1,
      color: 'transparent',
      contents: text,
      subject: tool,
    });
  r ??= await k.draw(page, id, drawing);
  const subtype = o.as === 'stamp' ? 'Stamp' : o.as === 'polyline' ? 'PolyLine' : 'Circle';
  k.entry(page, id, {
    tool,
    arc: { c, r: rPts, a0, a1, by: o.by },
    scale: { paper: s.paper, real: s.real, unit: s.unit },
    fp: geometryFingerprint(subtype, samples, r.rect),
  });
  k.note(
    {
      page,
      id,
      tool,
      subtype,
      variant: o.as === 'stamp' ? 'proposal' : 'alternative',
      contents: text,
      where:
        o.as === 'stamp'
          ? `${o.arc ? 'arc' : 'circle'}, ${tool === 'Radius' ? 'radius' : 'diameter'} line and value in a Stamp appearance; scale in /PieceInfo`
          : o.as === 'polyline'
            ? 'the arc as a PolyLine of 5° steps; radius line and value in its appearance'
            : `${o.arc ? 'only the arc drawn' : 'full circle'}; /RD insets /Rect to the circle; scale in /PieceInfo (a Circle has no /Measure)`,
    },
    r,
  );
}

async function count(
  k: Pack,
  page: number,
  p: Pt,
  group: string,
  n: number,
  shape: Shape,
  as: 'square' | 'stamp',
  color: Rgb = BLUE_RGB,
): Promise<void> {
  const id = k.id(as === 'stamp' ? 'count-stamp' : 'count');
  const size = 9;
  const text = `${group} ${String(n)}`;
  const col = color.map((v) => v.toFixed(3)).join(' ');
  const sym = symbolOps(shape, p, size);
  const ops = sym.filled
    ? `q /Fill gs ${col} rg ${sym.ops} f Q\n${col} RG 1 w ${sym.ops} S`
    : `${col} RG 1.4 w 1 J ${sym.ops} S`;
  const inner: Box = [p.x - size / 2, p.y - size / 2, p.x + size / 2, p.y + size / 2];
  const drawing: MeasureDrawing = {
    base: 'own',
    ops,
    states: { Fill: { ca: 0.35 } },
    captions: [
      {
        text,
        size: 8,
        color,
        place: (w, h) => ({
          at: { x: p.x + size / 2 + 1 + w / 2, y: p.y },
          angle: 0,
          width: w,
          height: h,
        }),
      },
    ],
    extent: [
      { x: inner[0], y: inner[1] },
      { x: inner[2], y: inner[3] },
    ],
    margin: 1,
    ...(as === 'square' ? { inner } : {}),
  };
  let r;
  if (as === 'stamp') r = await stamp(k, page, id, drawing, text, 'Count');
  else {
    await k.create(page, {
      type: PdfAnnotationSubtype.SQUARE,
      id,
      rect: k.rectE(
        page,
        [
          { x: inner[0], y: inner[1] },
          { x: inner[2], y: inner[3] },
        ],
        0,
      ),
      strokeColor: color === BLUE_RGB ? BLUE : RED,
      strokeWidth: 1,
      color: 'transparent',
      contents: text,
      subject: 'Count',
    });
    r = await k.draw(page, id, drawing);
  }
  k.entry(page, id, {
    tool: 'Count',
    group,
    number: n,
    shape,
    fp: geometryFingerprint(as === 'stamp' ? 'Stamp' : 'Square', [], r.rect),
  });
  k.note(
    {
      page,
      id,
      tool: 'Count',
      subtype: as === 'stamp' ? 'Stamp' : 'Square',
      variant: as === 'stamp' ? 'proposal' : 'alternative',
      contents: text,
      where: `${shape}; symbol and number in one ${as === 'square' ? 'Square appearance; /RD insets /Rect to the symbol' : 'Stamp appearance; no viewer redraws it'}`,
    },
    r,
  );
}

async function summary(
  k: Pack,
  page: number,
  topLeft: Pt,
  rows: [string, string][],
): Promise<void> {
  const id = k.id('summary');
  const cw = [118, 82];
  const rh = 14;
  const all: [string, string][] = [['Measurements', 'Total'], ...rows];
  const W = cw[0]! + cw[1]!;
  const H = rh * all.length;
  const x0 = topLeft.x;
  const y1 = topLeft.y;
  const text = all.map(([a, b]) => `${a}\t${b}`).join('\n');
  const col = '0.15 0.15 0.15';
  const grid = [
    `1 1 1 rg ${xy({ x: x0, y: y1 - H })} ${fnum(W)} ${fnum(H)} re f`,
    `0.93 0.93 0.93 rg ${xy({ x: x0, y: y1 - rh })} ${fnum(W)} ${fnum(rh)} re f`,
    `${col} RG 0.75 w ${xy({ x: x0, y: y1 - H })} ${fnum(W)} ${fnum(H)} re S`,
    `0.5 w ${all
      .slice(1)
      .map(
        (_, i) =>
          `${xy({ x: x0, y: y1 - rh * (i + 1) })} m ${xy({ x: x0 + W, y: y1 - rh * (i + 1) })} l`,
      )
      .join(' ')} ${xy({ x: x0 + cw[0]!, y: y1 })} m ${xy({ x: x0 + cw[0]!, y: y1 - H })} l S`,
  ].join('\n');
  const captions: Caption[] = all.flatMap(([a, b], i) => {
    const cy = y1 - rh * i - rh / 2;
    const ink: Rgb = [0.1, 0.1, 0.1];
    return [
      {
        text: a,
        size: 8.5,
        color: ink,
        align: 0 as const,
        place: (_w: number, h: number) => ({
          at: { x: x0 + cw[0]! / 2, y: cy },
          angle: 0,
          width: cw[0]! - 4,
          height: h,
        }),
      },
      {
        text: b,
        size: 8.5,
        color: ink,
        align: 2 as const,
        place: (_w: number, h: number) => ({
          at: { x: x0 + cw[0]! + cw[1]! / 2, y: cy },
          angle: 0,
          width: cw[1]! - 4,
          height: h,
        }),
      },
    ];
  });
  await k.create(page, {
    type: PdfAnnotationSubtype.FREETEXT,
    id,
    rect: k.rectE(page, [topLeft, { x: x0 + W, y: y1 - H }], 0),
    contents: text,
    fontFamily: PdfStandardFont.Helvetica,
    fontSize: 8.5,
    fontColor: '#1A1A1A',
    textAlign: PdfTextAlignment.Left,
    verticalAlign: PdfVerticalAlignment.Top,
    color: 'transparent',
    subject: 'Measurement summary',
  });
  const r = await k.draw(page, id, {
    base: 'own',
    ops: grid,
    captions,
    extent: [topLeft, { x: x0 + W, y: y1 - H }],
    margin: 1,
  });
  k.entry(page, id, { tool: 'Summary', fp: geometryFingerprint('FreeText', [], r.rect) });
  k.note(
    {
      page,
      id,
      tool: 'Summary',
      subtype: 'FreeText',
      variant: 'proposal',
      contents: text,
      where: 'table drawn in the appearance; /Contents holds the same rows as plain text',
    },
    r,
  );
}

/** A Distance as version 1.1.0 saved it: a Line, and a FreeText label grouped to it (/IRT, /RT /Group). */
async function distance110(k: Pack, page: number, a: Pt, b: Pt, s: Scale): Promise<void> {
  const id = k.id('distance110');
  const text = lengthText(dist(a, b), s);
  await k.create(page, {
    type: PdfAnnotationSubtype.LINE,
    id,
    rect: k.rectE(page, [a, b], 10),
    linePoints: { start: k.ep(page, a), end: k.ep(page, b) },
    lineEndings: {
      start: PdfAnnotationLineEnding.OpenArrow,
      end: PdfAnnotationLineEnding.OpenArrow,
    },
    strokeColor: RED,
    strokeWidth: 1,
    color: 'transparent',
    intent: 'LineDimension',
    contents: text,
  });
  fixLineEndingAppearance(k.e.mod, k.e.native, 'createPageAnnotation', [
    k.doc,
    k.doc.pages[page],
    {
      id,
      type: PdfAnnotationSubtype.LINE,
      lineEndings: {
        start: PdfAnnotationLineEnding.OpenArrow,
        end: PdfAnnotationLineEnding.OpenArrow,
      },
    },
  ]);
  k.stage(page, id, {
    IT: new PdfName('LineDimension'),
    Measure: measureOf(s),
    Cap: true,
    CP: new PdfName('Top'),
  });
  const pg = k.doc.pages[page];
  const rect = labelRect('distance', [k.ep(page, a), k.ep(page, b)], text, {
    width: pg?.size.width ?? 0,
    height: pg?.size.height ?? 0,
  });
  const lid = k.id('distance110-label');
  await k.create(page, {
    type: PdfAnnotationSubtype.FREETEXT,
    id: lid,
    rect,
    contents: text,
    fontFamily: PdfStandardFont.Helvetica,
    fontSize: 10,
    fontColor: RED,
    textAlign: PdfTextAlignment.Center,
    verticalAlign: PdfVerticalAlignment.Middle,
    color: 'transparent',
    inReplyToId: id,
    replyType: PdfAnnotationReplyType.Group,
  });
  const r = (x: { origin: Pt; size: { width: number; height: number } }): Box => [
    x.origin.x,
    x.origin.y,
    x.origin.x + x.size.width,
    x.origin.y + x.size.height,
  ];
  k.items.push(
    {
      page,
      id,
      tool: 'Distance 1.1.0',
      subtype: 'Line',
      variant: 'v1.1.0',
      contents: text,
      where: 'as version 1.1.0 saves it: the line, PDFium appearance, no caption',
      rect: r(k.rectE(page, [a, b], 10)),
      fontBytes: 0,
    },
    {
      page,
      id: lid,
      tool: 'Distance 1.1.0 label',
      subtype: 'FreeText',
      variant: 'v1.1.0',
      contents: text,
      where: 'its label: a FreeText grouped to the line (/IRT, /RT /Group)',
      rect: r(rect),
      fontBytes: 0,
    },
  );
}

// ------------------------------------------------------------------ the pack

/** Three corpus sheets in one document (PDFium import), as the pack's base. */
async function baseDocument(e: Engine): Promise<Uint8Array> {
  const files = [
    '01_floor_plan_1-100_mm.pdf',
    '02_pipe_run_1-50.pdf',
    '03_three_scales_1-50_1-5_1-10.pdf',
  ];
  const dest = rawCall(e.mod, 'FPDF_CreateNewDocument');
  try {
    for (const [i, f] of files.entries()) {
      const src = await open(e, measureSheetBytes(f));
      rawCall(e.mod, 'FPDF_ImportPages', dest, docPtrOf(e.native, src.id), '1', i);
      await e.native.closeDocument(src).toPromise();
      e.tracker.closed(src.id);
    }
    return saveWithFlags(e.mod, dest, FPDF_NO_INCREMENTAL);
  } finally {
    rawCall(e.mod, 'FPDF_CloseDocument', dest);
  }
}

export interface PackResult {
  base: Uint8Array;
  bytes: Uint8Array;
  tail: number;
  items: PackItem[];
  entries: Map<number, Map<string, TriyaEntry>>;
}

export async function buildPack(e: Engine): Promise<PackResult> {
  const base = await baseDocument(e);
  const doc = await open(e, base);
  const man = measureManifest();
  const item = (file: string, id: string) => {
    const s = man.sheets.find((x) => x.file === file);
    const i = s?.items.find((x) => x.id === id);
    if (!i) throw new Error(`no item ${file} ${id}`);
    return i;
  };
  const k = new Pack(
    e,
    doc,
    doc.pages.map((p) => p.size.height),
  );
  const mm = (real: number, precision = 0): Scale => ({ paper: 1, real, unit: 'mm', precision });
  const F1 = '01_floor_plan_1-100_mm.pdf';
  const F2 = '02_pipe_run_1-50.pdf';
  const F3 = '03_three_scales_1-50_1-5_1-10.pdf';

  // Page 1: floor plan, 1:100.
  const s1 = mm(100);
  const ov = item(F1, 'overall-length').points.map(P);
  await length(k, 0, ov[0]!, ov[1]!, s1, { offset: 62, where: 'above' });
  const dg = item(F1, 'office-diagonal').points.map(P);
  // Captions sit clear of the room label and the doors.
  await length(k, 0, dg[0]!, dg[1]!, s1, { where: 'inline', along: 0.75 });
  await path(k, 0, item(F1, 'wall-run').points.map(P), false, s1, undefined, 0.3);
  await path(k, 0, item(F1, 'office-perimeter').points.map(P), true, s1, 'Office', 0.72);
  await area(k, 0, item(F1, 'workshop-area').points.map(P), [], s1, {
    tool: 'Area',
    label: 'Workshop',
  });
  const slab = item(F1, 'slab-volume');
  await area(
    k,
    0,
    slab.points.map(P),
    (slab.holes ?? []).map((h) => h.map(P)),
    s1,
    {
      tool: 'Volume',
      label: 'Slab S1',
      depthMm: 250,
    },
  );
  const doors = item(F1, 'doors').points.map(P);
  for (const [i, p] of doors.entries()) await count(k, 0, p, 'Door', i + 1, 'circle', 'stamp');
  // Page 2: pipe run, 1:50.
  const s2 = mm(50);
  const run = item(F2, 'run-length').points.map(P);
  await path(k, 1, run, false, s2, 'Line 150-P-101');
  // The inside angle at the second bend (142.5°, as at the first), clear of the bend radius.
  await angle(k, 1, [run[1]!, run[2]!, run[3]!], 'stamp');
  await angle(k, 1, item(F2, 'deflection-B').points.map(P) as [Pt, Pt, Pt], 'stamp');
  const bend = item(F2, 'bend-radius-B');
  const bc = P(bend.center!);
  const bp = (bend.onCircle ?? []).map(P);
  const ang = (q: Pt): number => Math.atan2(q.y - bc.y, q.x - bc.x);
  const br = dist(bc, bp[0]!);
  await round(k, 1, 'Radius', bc, br, s2, {
    arc: [ang(bp[0]!), ang(bp[2]!)],
    lineAt: ang(bp[1]!),
    as: 'stamp',
    by: 'three',
  });
  const tank = item(F2, 'tank-diameter');
  const tc = P(tank.center!);
  await round(k, 1, 'Diameter', tc, dist(tc, P(tank.points[1]!)), s2, {
    lineAt: -Math.PI / 6,
    as: 'stamp',
    by: 'centre',
  });
  const fl = item(F2, 'flange-radius');
  const fc = P(fl.center!);
  await round(k, 1, 'Radius', fc, dist(fc, P(fl.points[1]!)), s2, {
    lineAt: Math.PI / 4,
    as: 'stamp',
    by: 'centre',
  });
  // Count in the other five shapes, along the run.
  const along = (t: number): Pt => {
    const total = pathLength(run, false);
    let left = t * total;
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!;
      const b = run[i]!;
      const d = dist(a, b);
      if (left <= d)
        return { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d - 22 };
      left -= d;
    }
    return run[run.length - 1]!;
  };
  const shapes: [string, Shape][] = [
    ['Support', 'square'],
    ['Valve', 'triangle'],
    ['Drain', 'diamond'],
    ['Weld', 'cross'],
    ['Checked', 'tick'],
  ];
  // Where along the run (0 to 1) each shape's first and second item go: clear of
  // the bends (at 0.40 and 0.73), their angle captions and the drawing's 6000.
  const firsts = [0.03, 0.12, 0.25, 0.33, 0.51];
  const seconds = [0.58, 0.66, 0.79, 0.86, 0.93];
  for (const [i, [g, sh]] of shapes.entries()) {
    await count(k, 1, along(firsts[i]!), g, 1, sh, 'stamp');
    await count(k, 1, along(seconds[i]!), g, 2, sh, 'stamp');
  }
  // Page 3: three scales, the alternatives, version 1.1.0.
  const beam = item(F3, 'beam-length').points.map(P);
  await length(k, 2, beam[0]!, beam[1]!, mm(50), { offset: -40, where: 'above', label: 'Beam B1' });
  const plate = item(F3, 'plate-width').points.map(P);
  await length(k, 2, plate[0]!, plate[1]!, mm(5), { offset: 38, where: 'inline' });
  const cleat = item(F3, 'cleat-length').points.map(P);
  await length(k, 2, cleat[0]!, cleat[1]!, mm(10), { offset: 30, where: 'above' });
  // The end plate with its four bolt holes (Ø 22 at 1:5), as 24-gons.
  const pa = item(F3, 'plate-area').points.map(P);
  const k5 = 72 / 25.4 / 5;
  const o = pa[0]!;
  const holes = [
    [60, 60],
    [340, 60],
    [60, 190],
    [340, 190],
  ].map(([x = 0, y = 0]) =>
    Array.from({ length: 24 }, (_, j) => {
      const t = (j / 24) * 2 * Math.PI;
      return { x: o.x + (x + 11 * Math.cos(t)) * k5 * 1, y: o.y + (y + 11 * Math.sin(t)) * k5 };
    }),
  );
  await area(k, 2, pa, holes, mm(5), { tool: 'Cutout', label: 'End plate', decimals: 4 });
  // Alternatives, in the empty top right of the sheet (mm on paper → points).
  const at = (x: number, y: number): Pt => ({ x: (x * 72) / 25.4, y: (y * 72) / 25.4 });
  await angle(k, 2, [at(262, 262), at(250, 232), at(300, 240)], 'polyline');
  await count(k, 2, at(318, 262), 'Door', 8, 'circle', 'square');
  await count(k, 2, at(318, 250), 'Valve', 3, 'triangle', 'square');
  await round(k, 2, 'Radius', at(350, 226), 40, mm(50), {
    arc: [Math.PI * 0.15, Math.PI * 0.85],
    lineAt: Math.PI / 2,
    as: 'circle',
    by: 'three',
  });
  await round(k, 2, 'Radius', at(390, 226), 40, mm(50), {
    arc: [Math.PI * 0.15, Math.PI * 0.85],
    lineAt: Math.PI / 2,
    as: 'polyline',
    by: 'three',
  });
  await round(k, 2, 'Diameter', at(395, 260), 30, mm(50), {
    lineAt: Math.PI / 6,
    as: 'circle',
    by: 'centre',
  });
  // A Distance as version 1.1.0 saved it.
  await distance110(k, 2, at(250, 205), at(360, 205), mm(50));
  // Page 1's summary table, from the values above.
  const p1 = k.items.filter((i) => i.page === 0 && i.variant === 'proposal');
  const rows: [string, string][] = [
    ['Length (2)', ''],
    ['Polylength (1)', ''],
    ['Perimeter: Office', ''],
    ['Area: Workshop', ''],
    ['Volume: Slab S1', ''],
    ['Count: Door', String(doors.length)],
  ];
  const val = (t: Tool, i = 0): string => {
    const x = p1.filter((q) => q.tool === t)[i]?.contents ?? '';
    return x.includes(': ') ? x.slice(x.indexOf(': ') + 2) : x;
  };
  const lengthsMm = p1
    .filter((q) => q.tool === 'Length')
    .reduce((sum, q) => sum + Number(q.contents.replace(/[^\d.]/gu, '')), 0);
  rows[0]![1] = `${nf(lengthsMm, 0)} mm`;
  rows[1]![1] = val('Polylength');
  rows[2]![1] = val('Perimeter');
  rows[3]![1] = val('Area');
  rows[4]![1] = val('Volume');
  await summary(k, 0, at(300, 278), rows);
  // The Triya data of each page, staged like /VP (object layer), saved in the same revision.
  for (const [page, m] of k.entries) {
    const set = pageEntries(m, MODIFIED);
    e.tracker.stagePatch(doc.id, { page }, set);
  }
  const saved = await save(e, doc, base);
  return { base, bytes: saved.bytes, tail: saved.tail, items: k.items, entries: k.entries };
}
