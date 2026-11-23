// The summary page of an overlay comparison file (M12-21, D-65): the file's
// first page(s), before the overlay sheets — file names, date, counts, legend
// and the settings used. The words come from the main thread (rule 11,
// model/compare/summary.ts); here they are laid out and drawn in the Work
// worker (rule 1) with a font shipped with the app (Noto Sans, and the
// library's fallbacks for symbols, Devanagari and Chinese in file names),
// embedded as subsets the same way as the comment fonts (M11-07, D-52):
// Type0/Identity-H, ToUnicode, each run with /ActualText, so the page's text
// can be searched and copied in any viewer. No system font is ever used.
import { libraryFamily } from '../../../model/fonts/library';
import type { SummaryBlock, SummarySpec } from '../../../model/compare/summary';
import { N, PdfRef, isDict, type PdfDict, type PdfValue } from '../../../model/pdf/objects';
import { encodeLatin1 } from '../../render/save/bytes';
import { content, fontObjects, type Usage } from '../../render/commentFonts/appearance';
import type { CommentFaces, FaceStore } from '../../render/commentFonts/faces';
import { layout, type Face, type Line } from '../../render/commentFonts/layout';
import type { Section } from './section';

/** The family the page is set in. */
export const SUMMARY_FAMILY = 'notosans';

/** A4 portrait, in points. */
export const SUMMARY_PAGE: readonly [number, number] = [595.28, 841.89];
const MARGIN = 56;
const LABEL_W = 150;
const GAP = 12;
const SWATCH = 11;
const LINE_HEIGHT = 1.3;

interface Style {
  size: number;
  bold: boolean;
  /** 0–1 grey of the text. */
  grey: number;
}

const TITLE: Style = { size: 18, bold: true, grey: 0 };
const HEADING: Style = { size: 12, bold: true, grey: 0 };
const LABEL: Style = { size: 10, bold: true, grey: 0.2 };
const VALUE: Style = { size: 10, bold: false, grey: 0 };
const NOTE: Style = { size: 9, bold: false, grey: 0.3 };

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

/** One laid-out page: its content and the font names it uses. */
export interface SummaryPage {
  ops: string;
  fonts: Set<string>;
}

export interface LaidOut {
  pages: SummaryPage[];
  /** Glyphs used per face, and each face's resource name (the same on every page). */
  usage: Usage;
  names: Map<Face, string>;
  faces: { regular: CommentFaces; bold: CommentFaces };
}

const textsOf = (blocks: readonly SummaryBlock[], bold: boolean): string =>
  blocks
    .flatMap((b): [string, boolean][] => {
      switch (b.kind) {
        case 'title':
        case 'heading':
          return [[b.text, true]];
        case 'row':
          return [
            [b.label, true],
            [b.value, false],
          ];
        case 'swatch':
        case 'note':
          return [[b.text, false]];
      }
    })
    .filter(([, isBold]) => isBold === bold)
    .map(([s]) => s)
    .join('\n');

/** Lays the blocks out on as many pages as they need (one, but for an endless list of zones). */
export async function layoutSummary(
  store: FaceStore,
  spec: SummarySpec,
  checkpoint: () => Promise<void> = () => Promise.resolve(),
): Promise<LaidOut> {
  const family = libraryFamily(SUMMARY_FAMILY);
  if (!family) throw new Error('the summary font is not in the library');
  const faces = {
    regular: await store.prepare(family, false, false, textsOf(spec.blocks, false)),
    bold: await store.prepare(family, true, false, textsOf(spec.blocks, true)),
  };
  await checkpoint();
  const [pw, ph] = SUMMARY_PAGE;
  const width = pw - 2 * MARGIN;
  const usage: Usage = new Map();
  const names = new Map<Face, string>();
  const synthetic = new Map([...faces.regular.synthetic, ...faces.bold.synthetic]);
  const pages: SummaryPage[] = [];
  let page: { ops: string[]; fonts: Set<string> } = { ops: [], fonts: new Set() };
  let y = ph - MARGIN;

  const lines = (text: string, st: Style, w: number): Line[] => {
    const f = st.bold ? faces.bold : faces.regular;
    return layout(text, f.primary, f.fallbacks, st.size, w);
  };
  const heightOf = (ls: Line[], st: Style): number => ls.length * st.size * LINE_HEIGHT;
  const newPage = (): void => {
    pages.push({ ops: page.ops.join('\n'), fonts: page.fonts });
    page = { ops: [], fonts: new Set() };
    y = ph - MARGIN;
  };
  /** Room for `h` more points, on a new page when this one is full. */
  const room = (h: number): void => {
    if (y - h < MARGIN && page.ops.length) newPage();
  };
  const draw = (ls: Line[], st: Style, x: number, top: number, w: number): void => {
    if (!ls.length) return;
    const f = st.bold ? faces.bold : faces.regular;
    const h = heightOf(ls, st);
    const c = content(ls, {
      textBox: [x, top - h, x + w, top],
      text: [st.grey, st.grey, st.grey],
      align: 0,
      valign: 0,
      size: st.size,
      lineHeight: LINE_HEIGHT,
      primary: f.primary,
      synthetic,
    });
    // Each call names its fonts F1, F2…: the page's names are the same for every block.
    const local = new Map([...c.names].map(([face, n]) => [n, face]));
    const ops = c.ops
      .replace(/^\/Tx BMC /u, '')
      .replace(/ EMC$/u, '')
      .replace(/\/(F\d+) ([\d.]+) Tf/gu, (_m, n: string, size: string) => {
        const face = local.get(n);
        if (!face) throw new Error('a font without a face');
        let name = names.get(face);
        if (!name) names.set(face, (name = `S${String(names.size + 1)}`));
        page.fonts.add(name);
        return `/${name} ${size} Tf`;
      });
    for (const [face, used] of c.usage) {
      const all = usage.get(face) ?? new Map<number, string>();
      usage.set(face, all);
      for (const [gid, t] of used) if (!all.get(gid)) all.set(gid, t);
    }
    page.ops.push(ops);
  };

  for (const b of spec.blocks) {
    switch (b.kind) {
      case 'title': {
        const ls = lines(b.text, TITLE, width);
        const h = heightOf(ls, TITLE);
        room(h + 14);
        draw(ls, TITLE, MARGIN, y, width);
        y -= h + 6;
        page.ops.push(
          `q 0.6 G 0.75 w ${r2(MARGIN)} ${r2(y)} m ${r2(MARGIN + width)} ${r2(y)} l S Q`,
        );
        y -= 8;
        break;
      }
      case 'heading': {
        const ls = lines(b.text, HEADING, width);
        const h = heightOf(ls, HEADING);
        // A heading is never left alone at the foot of a page.
        room(h + 14 + VALUE.size * LINE_HEIGHT * 2);
        y -= 14;
        draw(ls, HEADING, MARGIN, y, width);
        y -= h + 4;
        break;
      }
      case 'row': {
        const lw = LABEL_W;
        const vw = width - LABEL_W - GAP;
        const label = lines(b.label, LABEL, lw);
        const value = lines(b.value, VALUE, vw);
        const lineH = VALUE.size * LINE_HEIGHT;
        // A long value goes on over pages a line block at a time.
        let rest = value;
        let first = true;
        while (first || rest.length) {
          const fit = Math.max(1, Math.floor((y - MARGIN) / lineH));
          if (fit < Math.min(rest.length, 2) && page.ops.length) {
            newPage();
            continue;
          }
          const part = rest.slice(0, fit);
          rest = rest.slice(fit);
          const h = Math.max(heightOf(part, VALUE), first ? heightOf(label, LABEL) : 0);
          if (first) draw(label, LABEL, MARGIN, y, lw);
          draw(part, VALUE, MARGIN + lw + GAP, y, vw);
          y -= h + 3;
          first = false;
          if (rest.length) newPage();
        }
        break;
      }
      case 'swatch': {
        const tw = width - SWATCH - 8;
        const ls = lines(b.text, VALUE, tw);
        const h = Math.max(heightOf(ls, VALUE), SWATCH + 2);
        room(h);
        const [cr, cg, cb] = b.colour.map((v) => r2(v / 255));
        const sy = y - (VALUE.size * LINE_HEIGHT + SWATCH) / 2;
        page.ops.push(
          `q ${cr ?? '0'} ${cg ?? '0'} ${cb ?? '0'} rg 0.4 G 0.5 w ${r2(MARGIN)} ${r2(sy)} ${r2(SWATCH)} ${r2(SWATCH)} re B Q`,
        );
        draw(ls, VALUE, MARGIN + SWATCH + 8, y, tw);
        y -= h + 3;
        break;
      }
      case 'note': {
        const ls = lines(b.text, NOTE, width);
        const h = heightOf(ls, NOTE);
        room(h + 12);
        y -= 12;
        draw(ls, NOTE, MARGIN, y, width);
        y -= h;
        break;
      }
    }
    await checkpoint();
  }
  if (page.ops.length || !pages.length) newPage();
  return { pages, usage, names, faces };
}

/**
 * Writes the laid-out pages into `sec` (an unencrypted file) as its first
 * pages: the fonts once, a page object per page, put first in the page tree.
 * Returns how many pages were added.
 */
export async function writeSummary(sec: Section, laid: LaidOut): Promise<number> {
  const fonts = new Map<string, PdfRef>();
  for (const [face, used] of laid.usage) {
    const name = laid.names.get(face);
    if (!name || !used.size) continue;
    const first = sec.alloc();
    for (let i = 1; i < 5; i++) if (sec.alloc() !== first + i) throw new Error('font numbers');
    const sub = laid.faces.regular.sub;
    const f = fontObjects(face, used, first, sub, { italic: false });
    f.objects.forEach((bytes, i) => sec.raw(first + i, trimObject(bytes)));
    fonts.set(name, f.type0);
  }
  const cat = await sec.catalog();
  const pagesRef = cat.dict.get('Pages');
  if (!(pagesRef instanceof PdfRef)) throw new Error('no page tree');
  const tree = await sec.reader.get(pagesRef);
  if (!isDict(tree)) throw new Error('no page tree');
  const [pw, ph] = SUMMARY_PAGE;
  const refs: PdfRef[] = [];
  for (const p of laid.pages) {
    const contents = sec.stream(sec.alloc(), new Map(), encodeLatin1(p.ops));
    const font: PdfDict = new Map(
      [...p.fonts].flatMap((n): [string, PdfValue][] => {
        const r = fonts.get(n);
        return r ? [[n, r]] : [];
      }),
    );
    const num = sec.alloc();
    refs.push(
      sec.value(
        num,
        new Map<string, PdfValue>([
          ['Type', N('Page')],
          ['Parent', pagesRef],
          ['MediaBox', [0, 0, pw, ph]],
          ['Contents', contents],
          ['Resources', new Map<string, PdfValue>([['Font', font]])],
        ]),
      ),
    );
  }
  const kids = await sec.reader.resolve(tree.get('Kids'));
  const count = await sec.reader.resolve(tree.get('Count'));
  const t: PdfDict = new Map(tree);
  t.set('Kids', [...refs, ...(Array.isArray(kids) ? kids : [])]);
  t.set('Count', (typeof count === 'number' ? count : 0) + refs.length);
  sec.value(pagesRef.num, t);
  return refs.length;
}

/** fontObjects' bytes end with a line break; the section adds its own. */
function trimObject(b: Uint8Array): Uint8Array {
  let end = b.length;
  while (end > 0 && (b[end - 1] === 0x0a || b[end - 1] === 0x0d)) end--;
  return b.subarray(0, end);
}
