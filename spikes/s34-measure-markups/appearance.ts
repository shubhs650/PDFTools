// Spike S34 (M14-01, D-74): a measurement's value drawn inside the markup's
// own appearance, by the Render worker, as the comment fonts (D-52) and the
// dimension leader lines (D-72) already are. One route for every kind:
//
//  1. /Rect grows to hold the geometry, the arrows and every caption (the
//     caption is measured with HarfBuzz in the app's own font, Inter, before
//     anything is drawn), and PDFium draws its own appearance for that /Rect
//     (a Length with an offset: the app's drawDimension, M13-10).
//  2. PDFium's appearance is exported; our content is either PDFium's ops
//     (line, arrow heads, colour, width, dashes; numbers made plain) or our own
//     geometry (arcs, holes, symbols, see-through fills), then each caption: the
//     text shaped in Inter (fallbacks for ∠, Ø, ², ³ from the font library),
//     turned to read along its line, inside a clip of its own box.
//  3. In line captions break the line: PDFium's ops are drawn under an even-odd
//     clip of the box minus the caption.
//  4. `assemble` (commentFonts/appearance.ts) wraps it as one form with
//     PDFium's resources, our see-through states and the font subsets, and
//     EPDFAnnot_SetAppearanceFromPage puts it on the annotation.
import type { Rgb } from '../../src/workers/render/commentFonts/appearance.ts';
import { assemble, content } from '../../src/workers/render/commentFonts/appearance.ts';
import { layout, type Face, type Line } from '../../src/workers/render/commentFonts/layout.ts';
import { drawDimension } from '../../src/workers/render/dimensionAppearance.ts';
import { exportAppearance } from '../../src/workers/render/freeTextColors.ts';
import { rawCall } from '../../src/workers/render/pdfium.ts';
import { latin1 } from '../../src/workers/render/save/bytes.ts';
import { libraryFamily } from '../../src/model/fonts/library.ts';
import { plainNumbers } from '../../src/model/pdf/plainNumbers.ts';
import { PdfName, type PdfDict, type PdfValue } from '../../src/model/pdf/objects.ts';
import type { Leader } from '../../src/model/dimension.ts';
import { withAnnot, type Engine } from './engine.ts';
import {
  bounds,
  corners,
  fnum,
  unionBox,
  xy,
  type Box,
  type CaptionBox,
  type Pt,
} from './geometry.ts';

export type { Rgb };

/** Caption font size (Q40: 10 pt in the app's own font). */
export const CAPTION_SIZE = 10;
const LINE_HEIGHT = 1.18;
/** Space around a caption inside its box. */
const PAD = 1;

export interface Caption {
  text: string;
  /** Where the caption box goes, once its size is known. */
  place: (width: number, height: number) => CaptionBox;
  size?: number;
  color: Rgb;
  /** A white box behind the text. */
  backdrop?: boolean;
  /** 0 left, 1 centre (default), 2 right, inside the placed box. */
  align?: 0 | 1 | 2;
}

export interface MeasureDrawing {
  /** Keep PDFium's appearance (line, endings) or draw only `ops`. */
  base: 'pdfium' | 'own';
  /** A Length's offset: PDFium's line drawn as a dimension (M13-10) first. */
  leader?: Leader | null;
  /** Our geometry, in user space, drawn after PDFium's. */
  ops?: string;
  /** Break PDFium's drawing around the first caption (/CP /Inline). */
  gap?: boolean;
  captions: Caption[];
  /** See-through states our ops use by name (`/Fill gs`). */
  states?: Record<string, { ca?: number; CA?: number }>;
  /** Points the geometry reaches (with line width and arrows). */
  extent: Pt[];
  /** Room around the extent (half the line width, arrow heads). */
  margin: number;
  /** Circle and Square: the shape's own box, written as /RD (the rest of /Rect holds the caption). */
  inner?: Box;
  /** false: keep the appearance the annotation has (a Stamp's), only replace its content. */
  generate?: boolean;
}

export interface Drawn {
  ok: boolean;
  rect: Box;
  boxes: CaptionBox[];
  fontBytes: number;
  /** The appearance content we set (for the tests). */
  ops: string;
}

interface Placed {
  c: Caption;
  lines: Line[];
  box: CaptionBox;
}

const c3 = (c: Rgb): string => c.map((v) => fnum(v)).join(' ');

function setRect(e: Engine, annot: number, r: Box): boolean {
  const heap = e.mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    setValue(ptr: number, v: number, t: 'float'): void;
  };
  const p = heap.wasmExports.malloc(16);
  try {
    // FS_RECTF: left, top, right, bottom.
    heap.setValue(p, r[0], 'float');
    heap.setValue(p + 4, r[3], 'float');
    heap.setValue(p + 8, r[2], 'float');
    heap.setValue(p + 12, r[1], 'float');
    return !!rawCall(e.mod, 'FPDFAnnot_SetRect', annot, p);
  } finally {
    heap.wasmExports.free(p);
  }
}

function setAppearanceFile(e: Engine, annot: number, file: Uint8Array): boolean {
  const heap = e.mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    HEAPU8: Uint8Array;
  };
  const ptr = heap.wasmExports.malloc(file.length);
  try {
    heap.HEAPU8.set(file, ptr);
    const tmp = rawCall(e.mod, 'FPDF_LoadMemDocument', ptr, file.length, '');
    if (!tmp) return false;
    try {
      return !!rawCall(e.mod, 'EPDFAnnot_SetAppearanceFromPage', annot, tmp, 0);
    } finally {
      rawCall(e.mod, 'FPDF_CloseDocument', tmp);
    }
  } finally {
    heap.wasmExports.free(ptr);
  }
}

/** Step 1 alone: the captions measured and placed, and the /Rect that holds everything. */
export async function planDrawing(
  e: Engine,
  d: MeasureDrawing,
): Promise<{
  rect: Box;
  placed: Placed[];
  faces: Awaited<ReturnType<Engine['faces']['prepare']>>;
}> {
  const inter = libraryFamily('inter');
  if (!inter) throw new Error('Inter is not in the font library');
  const all = d.captions.map((c) => c.text).join('\n');
  const faces = await e.faces.prepare(inter, false, false, all || ' ');
  // 1. Measure each caption, place it, and grow /Rect to hold everything.
  const placed: Placed[] = d.captions.map((c) => {
    const size = c.size ?? CAPTION_SIZE;
    const lines = c.text
      .split('\n')
      .flatMap((p) => layout(p, faces.primary, faces.fallbacks, size, 100_000));
    const w = Math.max(0, ...lines.map((l) => l.width)) + 2 * PAD;
    const h = lines.length * size * LINE_HEIGHT + 2 * PAD;
    return { c, lines, box: c.place(w, h) };
  });
  let rect = bounds(d.extent, d.margin);
  for (const p of placed) rect = unionBox(rect, bounds(corners(p.box), 1));
  rect = rect.map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v))) as Box;
  return { rect, placed, faces };
}

/** Draws a measurement's appearance (the steps above) on the annotation named `id`. */
export async function drawMeasure(
  e: Engine,
  docId: string,
  pageIndex: number,
  id: string,
  d: MeasureDrawing,
): Promise<Drawn> {
  const { rect, placed, faces } = await planDrawing(e, d);
  const out = withAnnot(e, docId, pageIndex, id, (annot) => {
    if (!setRect(e, annot, rect)) return null;
    if (d.inner) {
      const [x0, y0, x1, y1] = d.inner;
      rawCall(
        e.mod,
        'EPDFAnnot_SetRectangleDifferences',
        annot,
        x0 - rect[0],
        y0 - rect[1],
        rect[2] - x1,
        rect[3] - y1,
      );
    }
    if (d.leader) drawDimension(e.mod, annot, d.leader);
    else if (d.generate !== false) rawCall(e.mod, 'EPDFAnnot_GenerateAppearance', annot);
    // 2. PDFium's appearance and ours.
    const exported = exportAppearance(e.mod, annot);
    if (!exported) return null;
    const base = d.base === 'pdfium' ? plainNumbers(latin1(exported.ex.data)).content.trim() : '';
    // PDFium's ops are in the exported form's own space; ours are in user space. When the form's
    // box does not start at /Rect's corner (an appearance PDFium already wrapped, a Stamp's own
    // page), ours are moved there and PDFium's are left where they are.
    const [bx0, by0] = exported.ex.bbox;
    const dx = bx0 - rect[0];
    const dy = by0 - rect[1];
    const moved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
    const toForm = moved ? `1 0 0 1 ${fnum(dx)} ${fnum(dy)} cm\n` : '';
    const back = moved ? `1 0 0 1 ${fnum(-dx)} ${fnum(-dy)} cm\n` : '';
    const parts: string[] = [];
    const first = placed[0];
    if (base && d.gap && first) {
      // 3. The line broken for an In line caption: an even-odd clip of /Rect minus the caption.
      const quad = corners(first.box)
        .map((p, i) => `${xy(p)} ${i ? 'l' : 'm'}`)
        .join(' ');
      parts.push(
        `q ${toForm}${fnum(rect[0])} ${fnum(rect[1])} ${fnum(rect[2] - rect[0])} ${fnum(rect[3] - rect[1])} re ${quad} h W* n\n${back}${base}\nQ`,
      );
    } else if (base) parts.push(`q\n${base}\nQ`);
    const ours: string[] = [];
    if (d.ops) ours.push(`q\n${d.ops}\nQ`);
    // Captions: one font name per face across all of them.
    const names = new Map<Face, string>();
    const usage = new Map<Face, Map<number, string>>();
    for (const p of placed) {
      const { width: w, height: h, at, angle } = p.box;
      const size = p.c.size ?? CAPTION_SIZE;
      const t = content(p.lines, {
        textBox: [-w / 2 + PAD, -h / 2 + PAD, w / 2 - PAD, h / 2 - PAD],
        text: p.c.color,
        align: p.c.align ?? 1,
        valign: 1,
        size,
        lineHeight: LINE_HEIGHT,
        primary: faces.primary,
        synthetic: faces.synthetic,
      });
      const local = new Map<string, Face>();
      for (const [face, n] of t.names) {
        local.set(n, face);
        if (!names.has(face)) names.set(face, `F${String(names.size + 1)}`);
      }
      for (const [face, used] of t.usage) {
        const u = usage.get(face) ?? new Map<number, string>();
        for (const [gid, txt] of used) if (!u.has(gid) || (!u.get(gid) && txt)) u.set(gid, txt);
        usage.set(face, u);
      }
      const ops = t.ops.replace(/\/(F\d+) (\S+ Tf)/gu, (_m, n: string, rest: string) => {
        const face = local.get(n);
        return `/${(face && names.get(face)) ?? n} ${rest}`;
      });
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const backdrop = p.c.backdrop
        ? `1 1 1 rg ${fnum(-w / 2)} ${fnum(-h / 2)} ${fnum(w)} ${fnum(h)} re f\n`
        : '';
      ours.push(
        `q ${fnum(cos)} ${fnum(sin)} ${fnum(-sin)} ${fnum(cos)} ${xy(at)} cm\n${backdrop}${ops}\nQ`,
      );
    }
    if (ours.length) parts.push(`q ${toForm}${ours.join('\n')}\nQ`);
    const all = parts.join('\n');
    // 4. One form: PDFium's resources, our states, the font subsets.
    const res: PdfDict =
      exported.ex.resources instanceof Map
        ? new Map(exported.ex.resources)
        : new Map<string, PdfValue>();
    if (d.states) {
      const gs: PdfDict =
        res.get('ExtGState') instanceof Map
          ? new Map(res.get('ExtGState') as PdfDict)
          : new Map<string, PdfValue>();
      for (const [n, s] of Object.entries(d.states)) {
        const st: PdfDict = new Map<string, PdfValue>([['Type', new PdfName('ExtGState')]]);
        if (s.ca !== undefined) st.set('ca', s.ca);
        if (s.CA !== undefined) st.set('CA', s.CA);
        gs.set(n, st);
      }
      res.set('ExtGState', gs);
    }
    const { file, fontBytes } = assemble(
      exported.bytes,
      { ...exported.ex.page, bbox: exported.ex.bbox, matrix: exported.ex.matrix },
      res,
      all,
      usage,
      names,
      faces.sub,
      { italic: false },
    );
    return { ok: setAppearanceFile(e, annot, file), fontBytes, ops: all };
  });
  return {
    ok: out?.ok ?? false,
    rect,
    boxes: placed.map((p) => p.box),
    fontBytes: out?.fontBytes ?? 0,
    ops: out?.ops ?? '',
  };
}

export { c3 as rgbOps };
