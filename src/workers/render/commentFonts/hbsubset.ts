// Comment fonts (M11-07, D-52; spike S26): a minimal wrapper over harfbuzzjs's `harfbuzz-subset.wasm`
// (MIT). The wasm has no imports and exports the plain C API, so it needs
// no Emscripten glue: instantiate, `_initialize`, call. The same bytes load
// in a worker (fetched from our own origin) as in Node.
//
// Two uses:
//  - build time: a variable font pinned to one instance (wght 400/700,
//    wdth 100, opsz default) and cut to the scripts we support, keeping the
//    layout tables so the face can still be shaped at runtime;
//  - per comment: the glyphs a comment draws, with their glyph ids kept
//    (RETAIN_GIDS, so CID = glyph id and /CIDToGIDMap is /Identity) and the
//    layout tables dropped (the text is already shaped).

export const FLAG_NO_HINTING = 0x1;
export const FLAG_RETAIN_GIDS = 0x2;
export const FLAG_DESUBROUTINIZE = 0x4;

const SETS_GLYPH_INDEX = 0;
const SETS_UNICODE = 1;
const SETS_DROP_TABLE_TAG = 3;

interface SubsetExports {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  _initialize?(): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_data(b: number, lenPtr: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(s: number, v: number): void;
  hb_set_clear(s: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_set(i: number, which: number): number;
  hb_subset_input_set_flags(i: number, flags: number): void;
  hb_subset_input_pin_axis_location(i: number, face: number, tag: number, value: number): number;
  hb_subset_input_pin_all_axes_to_default(i: number, face: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

export interface SubsetOptions {
  /** Glyph ids to keep (glyph 0 is always kept). */
  glyphs?: Iterable<number>;
  /** Code points to keep (their glyphs and the layout closure). */
  unicodes?: Iterable<number>;
  /** Axis locations, e.g. { wght: 700 }; every other axis is pinned to its default. */
  pin?: Record<string, number>;
  /** Pin variable axes at all (default true when `pin` is given). */
  instance?: boolean;
  flags?: number;
  /** Table tags to drop, e.g. GSUB. */
  drop?: string[];
}

const tag = (s: string): number =>
  ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>>
  0;

/** The tables a shaped, embedded subset never needs. */
export const EMBED_DROP = [
  'GSUB',
  'GPOS',
  'GDEF',
  'BASE',
  'JSTF',
  'MATH',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'CBDT',
  'CBLC',
  'EBDT',
  'EBLC',
  'kern',
  'morx',
  'kerx',
  'STAT',
  'DSIG',
  'vhea',
  'vmtx',
  'VORG',
  'meta',
  'gasp',
  'hdmx',
  'LTSH',
  'VDMX',
  'PCLT',
];

export class Subsetter {
  private readonly x: SubsetExports;
  private constructor(x: SubsetExports) {
    this.x = x;
  }

  static async load(wasm: BufferSource): Promise<Subsetter> {
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const x = instance.exports as unknown as SubsetExports;
    x._initialize?.();
    return new Subsetter(x);
  }

  /** The subset font's bytes, or null if HarfBuzz refuses. */
  subset(font: Uint8Array, o: SubsetOptions): Uint8Array | null {
    const x = this.x;
    const ptr = x.malloc(font.length);
    new Uint8Array(x.memory.buffer).set(font, ptr);
    const blob = x.hb_blob_create(ptr, font.length, 1 /* READONLY */, 0, 0);
    const face = x.hb_face_create(blob, 0);
    const input = x.hb_subset_input_create_or_fail();
    try {
      if (!input) return null;
      const gs = x.hb_subset_input_set(input, SETS_GLYPH_INDEX);
      for (const g of o.glyphs ?? []) x.hb_set_add(gs, g);
      x.hb_set_add(gs, 0);
      const us = x.hb_subset_input_set(input, SETS_UNICODE);
      for (const u of o.unicodes ?? []) x.hb_set_add(us, u);
      const drop = x.hb_subset_input_set(input, SETS_DROP_TABLE_TAG);
      for (const t of o.drop ?? []) x.hb_set_add(drop, tag(t));
      x.hb_subset_input_set_flags(input, o.flags ?? 0);
      if (o.instance ?? o.pin !== undefined) {
        x.hb_subset_input_pin_all_axes_to_default(input, face);
        for (const [axis, v] of Object.entries(o.pin ?? {}))
          x.hb_subset_input_pin_axis_location(input, face, tag(axis), v);
      }
      const out = x.hb_subset_or_fail(face, input);
      if (!out) return null;
      const ob = x.hb_face_reference_blob(out);
      const lenPtr = x.malloc(4);
      const data = x.hb_blob_get_data(ob, lenPtr);
      const len = new Uint32Array(x.memory.buffer, lenPtr, 1)[0] ?? 0;
      const bytes = new Uint8Array(x.memory.buffer, data, len).slice();
      x.free(lenPtr);
      x.hb_blob_destroy(ob);
      x.hb_face_destroy(out);
      return bytes.length ? bytes : null;
    } finally {
      if (input) x.hb_subset_input_destroy(input);
      x.hb_face_destroy(face);
      x.hb_blob_destroy(blob);
      x.free(ptr);
    }
  }
}
