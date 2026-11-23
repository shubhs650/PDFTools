// The vector overlay's recolouring (M12-16, D-59; ADR-032: spike S29 route 2,
// with route 1's one-object luminosity masks). A copy of a page form is made
// with every colour instruction rewritten to the tint of the same lightness
// (L = 0.3 R + 0.59 G + 0.11 B, paper stays white, full ink is the full tint).
// What has no colour instruction to rewrite (images, inline images, shadings,
// pattern fills, spot, DeviceN and indexed paints) is painted as route 1 does
// it: the tint through a luminosity mask that draws that one object in its own
// colours, in place, inside the current clip and marked content, so optional
// content (layers) still governs it (S29 finding 1). Nested forms are copied
// the same way, once per side.
//
// A form we cannot rewrite faithfully (a filter we don't read, a content
// stream we can't tokenize, or Type 3 glyphs, which may set their own colours)
// is drawn as a whole through route 1's mask: always the right shape, though
// PDFium then draws every layer inside it (S29 finding 1). A form with layers
// is still rewritten in that case (S29 risk 1, decided here: layers matter
// more than a Type 3 glyph's own colour).
//
// Pure: reads through the object layer, writes through an ObjectSink.
import {
  D,
  N,
  PdfRef,
  PdfStream,
  isDict,
  nameOf,
  numOf,
  type PdfDict,
  type PdfValue,
} from '../../pdf/objects';
import type { PdfReader } from '../../pdf/reader';
import { invertAffine, thenAffine, type Affine } from '../material';
import type { Rgb } from '../overlay';
import { ascii85, fromLatin1, latin1, tokenize, type Instr } from './content';

/** Where new objects go (the builder's incremental section). */
export interface ObjectSink {
  /** A new object number. */
  alloc(): number;
  put(num: number, value: PdfValue): void;
  /** A stream object; the data is compressed by the sink. */
  putStream(num: number, dict: PdfDict, data: Uint8Array): Promise<void>;
}

export type Side = 'a' | 'b';

export interface RecolourStats {
  /** Colour instructions rewritten. */
  colours: number;
  images: number;
  inlineImages: number;
  shadings: number;
  patterns: number;
  /** Paths painted through their own mask (pattern, spot, DeviceN, indexed). */
  objectMasks: number;
  /** Forms copied (page forms and nested ones). */
  forms: number;
  /** Forms drawn whole through a mask (unreadable, or Type 3 text). */
  wholeMasks: number;
}

/** A number as a content stream writes it (six decimals at most). */
export const fmt = (n: number): string => {
  const s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};

export const matrixText = (m: Affine): string => m.map(fmt).join(' ');

/** The tint of lightness `L` (0 ink … 1 paper) in colour `col`, as three numbers. */
export function tintOf(col: Rgb, L: number): [number, number, number] {
  const l = Math.min(1, Math.max(0, L));
  return col.map((c) => l + (1 - l) * (c / 255)) as [number, number, number];
}

const tintText = (col: Rgb, L: number): string => tintOf(col, L).map(fmt).join(' ');

type SpaceKind = 'gray' | 'rgb' | 'cmyk' | 'lab' | 'sep' | 'devn' | 'indexed' | 'pattern';

/** A colour's lightness in its space (0 ink … 1 paper); 0.5 where unknown. */
export function lightness(kind: SpaceKind, v: readonly number[]): number {
  const [a = 0, b = 0, c = 0, d = 0] = v;
  switch (kind) {
    case 'gray':
      return a;
    case 'rgb':
      return 0.3 * a + 0.59 * b + 0.11 * c;
    case 'cmyk':
      return (0.3 * (1 - a) + 0.59 * (1 - b) + 0.11 * (1 - c)) * (1 - d);
    case 'lab':
      return a / 100;
    case 'sep':
      return 1 - a;
    case 'devn':
      return 1 - Math.max(0, ...v);
    default:
      return 0.5;
  }
}

/** Plain colours are rewritten; the rest is painted through a mask. */
const exact = (k: SpaceKind): boolean => k === 'gray' || k === 'rgb' || k === 'cmyk' || k === 'lab';

const DIRECT: Record<string, SpaceKind> = {
  DeviceGray: 'gray',
  G: 'gray',
  DeviceRGB: 'rgb',
  RGB: 'rgb',
  DeviceCMYK: 'cmyk',
  CMYK: 'cmyk',
  Pattern: 'pattern',
};

const FAMILY: Record<string, SpaceKind> = {
  CalGray: 'gray',
  CalRGB: 'rgb',
  Lab: 'lab',
  Separation: 'sep',
  DeviceN: 'devn',
  Indexed: 'indexed',
  Pattern: 'pattern',
  DeviceGray: 'gray',
  DeviceRGB: 'rgb',
  DeviceCMYK: 'cmyk',
};

/** The mask group's reach: larger than any page (A0 at 200 % is 6,700 pt). */
const BIG = 20000;
const BIG_RECT = `${String(-BIG)} ${String(-BIG)} ${String(2 * BIG)} ${String(2 * BIG)}`;

const FILLS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const STROKES = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);
const PAINTS = new Set([...FILLS, ...STROKES, 'n']);
const PATH = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're', 'W', 'W*']);
const LINE = new Set(['w', 'J', 'j', 'M', 'd']);

/** Instructions between two cooperative pauses (a dense A1 sheet has ~100,000). */
const PAUSE_EVERY = 4000;

interface State {
  fill: SpaceKind;
  stroke: SpaceKind;
  /** The raw instructions that set the fill / stroke colour (replayed inside masks). */
  fillRaw: string[];
  strokeRaw: string[];
  lineRaw: Map<string, string>;
  /** The CTM relative to the start of this stream (patterns are anchored there). */
  ctm: Affine;
}

export class Recolourer {
  readonly stats: RecolourStats = {
    colours: 0,
    images: 0,
    inlineImages: 0,
    shadings: 0,
    patterns: 0,
    objectMasks: 0,
    forms: 0,
    wholeMasks: 0,
  };
  private readonly done = new Map<string, number>();
  private invertNum = 0;
  private sincePause = 0;

  private readonly reader: PdfReader;
  private readonly sink: ObjectSink;
  private readonly pause: () => Promise<void>;
  private readonly remap: (num: number) => number | undefined;

  /**
   * `pause` is called every few thousand instructions (the job's checkpoint:
   * cancel, fairness). `remap` gives another object for an optional content
   * group or membership dictionary (the builder keeps one copy of each source
   * layer across sheets).
   */
  constructor(
    reader: PdfReader,
    sink: ObjectSink,
    pause: () => Promise<void> = () => Promise.resolve(),
    remap: (num: number) => number | undefined = () => undefined,
  ) {
    this.reader = reader;
    this.sink = sink;
    this.pause = pause;
    this.remap = remap;
  }

  private remapped(v: PdfValue | undefined): PdfValue | undefined {
    if (!(v instanceof PdfRef)) return v;
    const n = this.remap(v.num);
    return n === undefined ? v : new PdfRef(n);
  }

  /**
   * A recoloured copy of the form `ref` in `col`. `top`: a page form, which
   * becomes an isolated transparency group (S29 finding 3) and starts with the
   * full tint as its colour (text that never sets a colour is tinted too).
   * Copies are made once per form, side and colour.
   */
  async form(ref: PdfRef, col: Rgb, side: Side, top = false): Promise<PdfRef> {
    const key = `${side}:${col.join(',')}:${String(ref.num)}:${top ? 'top' : 'in'}`;
    const hit = this.done.get(key);
    if (hit) return new PdfRef(hit);
    const s = await this.reader.get(ref);
    if (!(s instanceof PdfStream)) return ref;
    const num = this.sink.alloc();
    this.done.set(key, num);
    this.stats.forms++;
    const dict: PdfDict = new Map(s.dict);
    for (const k of ['Filter', 'DecodeParms', 'Length']) dict.delete(k);
    // Both sides are isolated groups: B's own white fills cover only B, then the
    // group is multiplied onto A (Poppler drew green fringes with B alone, S29).
    if (top) dict.set('Group', D({ S: N('Transparency'), I: true, CS: N('DeviceRGB') }));
    const oc = this.remapped(s.dict.get('OC'));
    if (oc !== undefined) dict.set('OC', oc);
    const res = await this.reader.resolve(s.dict.get('Resources'));
    const resDict: PdfDict = isDict(res) ? new Map(res) : new Map<string, PdfValue>();
    const props = await this.reader.resolve(resDict.get('Properties'));
    if (isDict(props))
      resDict.set(
        'Properties',
        new Map([...props].map(([k, v]): [string, PdfValue] => [k, this.remapped(v) ?? v])),
      );
    const data = await this.decode(s);
    let text: string | null = null;
    if (data !== null && !(top && (await this.whole(resDict)))) {
      try {
        text = await this.content(tokenize(latin1(data)), resDict, col, side, top);
      } catch {
        text = null; // unreadable content: drawn whole through a mask below
      }
    }
    if (text === null) {
      text = await this.wholeMask(ref, s, col, resDict);
      this.stats.wholeMasks++;
    }
    dict.set('Resources', resDict);
    await this.sink.putStream(num, dict, fromLatin1(text));
    return new PdfRef(num);
  }

  /** Decoded stream data: Flate and ASCII85 in any order, else null. */
  private async decode(s: PdfStream): Promise<Uint8Array | null> {
    const f = s.dict.get('Filter');
    const filters = Array.isArray(f) ? f.map(nameOf) : f ? [nameOf(f)] : [];
    if (filters.every((x) => x === 'FlateDecode')) {
      try {
        return await this.reader.decode(s);
      } catch {
        return null;
      }
    }
    if (s.dict.has('DecodeParms')) return null;
    let data = s.raw;
    try {
      for (const x of filters) {
        if (x === 'ASCII85Decode') data = ascii85(data);
        else if (x === 'FlateDecode')
          data = await this.reader.decode(
            new PdfStream(new Map([['Filter', N('FlateDecode')]]), data),
          );
        else return null;
      }
    } catch {
      return null;
    }
    return data;
  }

  /**
   * Whether a page form is drawn whole through a mask: it shows Type 3 text
   * (its glyphs may set their own colours) and holds no optional content.
   */
  private async whole(res: PdfDict): Promise<boolean> {
    // Set inside the walk (a closure).
    const found = { type3: false, layers: false };
    const seen = new Set<number>();
    const walk = async (r: PdfValue | undefined, depth: number): Promise<void> => {
      if (depth > 16 || (found.type3 && found.layers)) return;
      const d = await this.reader.resolve(r);
      if (!isDict(d)) return;
      const fonts = await this.reader.resolve(d.get('Font'));
      if (isDict(fonts))
        for (const f of fonts.values()) {
          const fd = await this.reader.resolve(f);
          if (isDict(fd) && nameOf(fd.get('Subtype')) === 'Type3') found.type3 = true;
        }
      const props = await this.reader.resolve(d.get('Properties'));
      if (isDict(props) && props.size > 0) found.layers = true;
      const xo = await this.reader.resolve(d.get('XObject'));
      if (!isDict(xo)) return;
      for (const v of xo.values()) {
        if (!(v instanceof PdfRef) || seen.has(v.num)) continue;
        seen.add(v.num);
        const x = await this.reader.get(v);
        if (x instanceof PdfStream && nameOf(x.dict.get('Subtype')) === 'Form') {
          if (x.dict.has('OC')) found.layers = true;
          await walk(x.dict.get('Resources'), depth + 1);
        }
      }
    };
    await walk(res, 0);
    return found.type3 && !found.layers;
  }

  /** The shared transfer function of every mask: ink → opaque, paper → clear. */
  private invert(): PdfRef {
    if (!this.invertNum) {
      this.invertNum = this.sink.alloc();
      this.sink.put(this.invertNum, D({ FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 }));
    }
    return new PdfRef(this.invertNum);
  }

  /** A luminosity soft mask whose group draws `draw` over white. */
  private async mask(
    bbox: readonly number[],
    draw: string,
    res: PdfDict,
    matrix?: Affine,
  ): Promise<PdfRef> {
    const groupNum = this.sink.alloc();
    const maskNum = this.sink.alloc();
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = bbox;
    await this.sink.putStream(
      groupNum,
      D({
        Type: N('XObject'),
        Subtype: N('Form'),
        BBox: [...bbox],
        ...(matrix ? { Matrix: [...matrix] } : {}),
        Group: D({ S: N('Transparency'), CS: N('DeviceGray') }),
        Resources: res,
      }),
      fromLatin1(`q 1 g ${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re f Q\n${draw}\n`),
    );
    this.sink.put(
      maskNum,
      D({
        Type: N('Mask'),
        S: N('Luminosity'),
        G: new PdfRef(groupNum),
        BC: [1],
        TR: this.invert(),
      }),
    );
    return new PdfRef(maskNum);
  }

  /** Route 1 for a whole form: the tint through a mask that draws the form itself. */
  private async wholeMask(ref: PdfRef, s: PdfStream, col: Rgb, res: PdfDict): Promise<string> {
    const raw = await this.reader.resolve(s.dict.get('BBox'));
    const bbox = Array.isArray(raw) && raw.length === 4 ? raw.map((v) => Number(v)) : [0, 0, 1, 1];
    const [x0 = 0, y0 = 0, x1 = 1, y1 = 1] = bbox;
    // The mask draws the original form in its own space (its own /Matrix undone).
    const m = await this.reader.resolve(s.dict.get('Matrix'));
    const own: Affine | undefined =
      Array.isArray(m) && m.length === 6 ? (m.map((v) => Number(v)) as Affine) : undefined;
    const mask = await this.mask(
      [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
      `${own ? `${matrixText(invertAffine(own))} cm ` : ''}/F Do`,
      D({ XObject: D({ F: ref }) }),
    );
    res.clear();
    res.set('ExtGState', D({ TintMask: D({ SMask: mask }) }));
    return `q /TintMask gs ${tintText(col, 0)} rg ${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)} re f Q`;
  }

  private async content(
    ins: readonly Instr[],
    res: PdfDict,
    col: Rgb,
    side: Side,
    top: boolean,
  ): Promise<string> {
    const reader = this.reader;
    const csRes = await reader.resolve(res.get('ColorSpace'));
    const xoRes = await reader.resolve(res.get('XObject'));
    const newXo: PdfDict = isDict(xoRes) ? new Map(xoRes) : new Map<string, PdfValue>();
    const gsRes = await reader.resolve(res.get('ExtGState'));
    const newGs: PdfDict = isDict(gsRes) ? new Map(gsRes) : new Map<string, PdfValue>();
    // The masks draw with the form's original resources.
    const maskRes: PdfDict = new Map(res);
    const spaceOf = async (name: string): Promise<SpaceKind> => {
      const d = DIRECT[name];
      if (d) return d;
      const v = isDict(csRes) ? await reader.resolve(csRes.get(name)) : undefined;
      const arr = Array.isArray(v) ? v : [v];
      const fam = nameOf(arr[0]) ?? '';
      if (fam === 'ICCBased') {
        const st = await reader.resolve(arr[1]);
        const n = st instanceof PdfStream ? numOf(st.dict.get('N')) : 3;
        return n === 1 ? 'gray' : n === 4 ? 'cmyk' : 'rgb';
      }
      return FAMILY[fam] ?? 'indexed';
    };
    const stack: State[] = [];
    let cur: State = {
      fill: 'gray',
      stroke: 'gray',
      fillRaw: [],
      strokeRaw: [],
      lineRaw: new Map(),
      ctm: [1, 0, 0, 1, 0, 0],
    };
    // A page starts with black fill and stroke: set to the full tint here (a
    // nested form inherits its caller's colour, already tinted).
    const out: string[] = top ? [`${tintText(col, 0)} rg ${tintText(col, 0)} RG`] : [];
    let seq = 0;
    let path: string[] = [];
    /** Paints the tint through a mask drawn by `draw` in the current space. */
    const masked = async (draw: string, rect: string, inv?: Affine): Promise<void> => {
      const mask = await this.mask([-BIG, -BIG, BIG, BIG], draw, maskRes, inv);
      let name = `TintMask${String(++seq)}`;
      while (newGs.has(name)) name = `TintMask${String(++seq)}`;
      newGs.set(name, D({ SMask: mask }));
      out.push(`q /${name} gs ${tintText(col, 0)} rg ${rect} re f Q`);
    };
    for (const it of ins) {
      if (++this.sincePause >= PAUSE_EVERY) {
        this.sincePause = 0;
        await this.pause();
      }
      const nums: number[] = [];
      let name: string | undefined;
      for (const o of it.operands) {
        if (o.kind === 'num') nums.push(o.value);
        else if (o.kind === 'name' && name === undefined) name = o.value;
      }
      const op = it.op;
      if (PATH.has(op)) {
        path.push(it.raw);
        continue;
      }
      if (PAINTS.has(op)) {
        const needs =
          (FILLS.has(op) && !exact(cur.fill)) || (STROKES.has(op) && !exact(cur.stroke));
        if (!needs) out.push(...path, it.raw);
        else {
          // A pattern, spot, indexed or DeviceN paint: route 1 for this one object.
          // The clip (if any) is set first, then the tint is painted through a
          // mask that draws the original paint in its own colours.
          const clip = path.filter((x) => x === 'W' || x === 'W*');
          const shape = path.filter((x) => x !== 'W' && x !== 'W*');
          if (clip.length) out.push(...shape, clip[0] ?? 'W', 'n');
          const draw = [
            `${matrixText(cur.ctm)} cm`,
            ...cur.lineRaw.values(),
            ...cur.fillRaw,
            ...cur.strokeRaw,
            ...shape,
            it.raw,
          ].join('\n');
          await masked(draw, BIG_RECT, invertAffine(cur.ctm));
          this.stats.objectMasks++;
        }
        path = [];
        continue;
      }
      if (LINE.has(op)) {
        cur.lineRaw.set(op, it.raw);
        out.push(it.raw);
        continue;
      }
      switch (op) {
        case 'q':
          stack.push({ ...cur, lineRaw: new Map(cur.lineRaw) });
          out.push('q');
          break;
        case 'Q':
          cur = stack.pop() ?? cur;
          out.push('Q');
          break;
        case 'cm': {
          const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = nums;
          cur = { ...cur, ctm: thenAffine([a, b, c, d, e, f], cur.ctm) };
          out.push(it.raw);
          break;
        }
        case 'g':
        case 'rg':
        case 'k': {
          const k: SpaceKind = op === 'g' ? 'gray' : op === 'rg' ? 'rgb' : 'cmyk';
          cur = { ...cur, fill: k, fillRaw: [it.raw] };
          out.push(`${tintText(col, lightness(k, nums))} rg`);
          this.stats.colours++;
          break;
        }
        case 'G':
        case 'RG':
        case 'K': {
          const k: SpaceKind = op === 'G' ? 'gray' : op === 'RG' ? 'rgb' : 'cmyk';
          cur = { ...cur, stroke: k, strokeRaw: [it.raw] };
          out.push(`${tintText(col, lightness(k, nums))} RG`);
          this.stats.colours++;
          break;
        }
        case 'cs':
        case 'CS': {
          const k = await spaceOf(name ?? 'DeviceGray');
          if (op === 'cs') cur = { ...cur, fill: k, fillRaw: [it.raw] };
          else cur = { ...cur, stroke: k, strokeRaw: [it.raw] };
          // A space's initial colour is its darkest (black, full tint).
          out.push(`${tintText(col, k === 'pattern' ? 0.5 : 0)} ${op === 'cs' ? 'rg' : 'RG'}`);
          this.stats.colours++;
          break;
        }
        case 'sc':
        case 'scn':
        case 'SC':
        case 'SCN': {
          const fill = op === 'sc' || op === 'scn';
          const k = fill ? cur.fill : cur.stroke;
          if (k === 'pattern' || name !== undefined) this.stats.patterns++;
          if (fill) cur = { ...cur, fillRaw: [...cur.fillRaw.slice(0, 1), it.raw] };
          else cur = { ...cur, strokeRaw: [...cur.strokeRaw.slice(0, 1), it.raw] };
          // Close enough for text in a spot colour; paths in such a colour are masked.
          out.push(`${tintText(col, lightness(k, nums))} ${fill ? 'rg' : 'RG'}`);
          this.stats.colours++;
          break;
        }
        case 'Do': {
          const ref = isDict(xoRes) && name !== undefined ? xoRes.get(name) : undefined;
          const xo = await reader.resolve(ref);
          const sub = xo instanceof PdfStream ? nameOf(xo.dict.get('Subtype')) : undefined;
          if (sub === 'Form' && ref instanceof PdfRef && name !== undefined) {
            newXo.set(name, await this.form(ref, col, side));
            out.push(it.raw);
          } else if (
            sub === 'Image' &&
            xo instanceof PdfStream &&
            xo.dict.get('ImageMask') !== true
          ) {
            // An image: the tint through a mask made of the image (the unit square).
            await masked(it.raw, '0 0 1 1');
            this.stats.images++;
          } else out.push(it.raw); // an image mask paints in the (tinted) fill colour
          break;
        }
        case 'sh':
          await masked(it.raw, BIG_RECT);
          this.stats.shadings++;
          break;
        case 'BI':
          if (/\/(IM|ImageMask)\s+true/.test(it.raw)) out.push(it.raw);
          else await masked(it.raw, '0 0 1 1');
          this.stats.inlineImages++;
          break;
        default:
          out.push(it.raw);
      }
    }
    if (path.length) out.push(...path);
    if (newXo.size) res.set('XObject', newXo);
    if (newGs.size) res.set('ExtGState', newGs);
    return out.join('\n');
  }
}
