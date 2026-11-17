// Comment fonts (M11-07, D-52): the library's faces in the Render worker,
// loaded on first use. HarfBuzz (shaping, `harfbuzz.wasm`) and its subsetter
// (`harfbuzz-subset.wasm`) are loaded once, the font files one by one from our
// own origin (rule 4; the service worker serves them offline). Nothing is
// loaded until a comment uses a library font.
import {
  FALLBACK_CHAIN,
  fontLibraryPath,
  libraryFamily,
  resolveFace,
  type LibraryFace,
  type LibraryFamily,
} from '../../../model/fonts/library';
import { Subsetter } from './hbsubset';
import { loadFace, type Face, type Harfbuzz } from './layout';

/** Where the bytes come from: fetch in the worker, files in Node tests. */
export interface FontSource {
  harfbuzz(): Promise<Harfbuzz>;
  subsetWasm(): Promise<BufferSource>;
  fontFile(file: string): Promise<Uint8Array>;
}

/** What a comment is drawn with: its primary face and the fallbacks its text needs, loaded. */
export interface CommentFaces {
  primary: Face;
  fallbacks: Face[];
  /** Faces drawn bold with a stroke or italic with a slant. */
  synthetic: Map<Face, { bold: boolean; italic: boolean }>;
  sub: Subsetter;
}

export class FaceStore {
  private readonly source: FontSource;
  private hb: Promise<Harfbuzz> | null = null;
  private sub: Promise<Subsetter> | null = null;
  private readonly faces = new Map<string, Promise<Face>>();

  constructor(source: FontSource) {
    this.source = source;
  }

  private harfbuzz(): Promise<Harfbuzz> {
    this.hb ??= this.source.harfbuzz().catch((err: unknown) => {
      this.hb = null;
      throw err;
    });
    return this.hb;
  }

  private subsetter(): Promise<Subsetter> {
    this.sub ??= this.source
      .subsetWasm()
      .then((w) => Subsetter.load(w))
      .catch((err: unknown) => {
        this.sub = null;
        throw err;
      });
    return this.sub;
  }

  /** One Face per file and `wght` (an unmodified variable file draws Regular and Bold). */
  face(f: LibraryFace): Promise<Face> {
    const key = `${f.file}@${String(f.wght ?? '')}`;
    let p = this.faces.get(key);
    if (!p) {
      p = Promise.all([this.harfbuzz(), this.source.fontFile(f.file)]).then(([hb, bytes]) =>
        loadFace(hb, key, bytes, f.wght),
      );
      p.catch(() => this.faces.delete(key));
      this.faces.set(key, p);
    }
    return p;
  }

  /**
   * The faces `text` needs in `family` (bold, italic): the primary face, then
   * the fallbacks in order (S26: symbols, Devanagari, Chinese) until every
   * character has a glyph or the chain ends. A fallback is loaded only when
   * the text has a character the faces before it lack.
   */
  async prepare(
    family: LibraryFamily,
    bold: boolean,
    italic: boolean,
    text: string,
  ): Promise<CommentFaces> {
    const synthetic = new Map<Face, { bold: boolean; italic: boolean }>();
    const r = resolveFace(family, bold, italic);
    const [primary, sub] = await Promise.all([this.face(r.face), this.subsetter()]);
    synthetic.set(primary, { bold: r.fakeBold, italic: r.fakeItalic });
    let missing = missingIn(text, [primary]);
    const fallbacks: Face[] = [];
    for (const id of FALLBACK_CHAIN) {
      if (!missing.size) break;
      const fb = libraryFamily(id);
      if (!fb || fb.id === family.id) continue;
      const rf = resolveFace(fb, bold, italic);
      const face = await this.face(rf.face);
      if (![...missing].some((c) => face.unicodes.has(c))) continue;
      fallbacks.push(face);
      synthetic.set(face, { bold: rf.fakeBold, italic: rf.fakeItalic });
      missing = missingIn(text, [primary, ...fallbacks]);
    }
    return { primary, fallbacks, synthetic, sub };
  }
}

const isLayoutOnly = (c: number): boolean =>
  c < 0x20 || c === 0x200b || c === 0x200c || c === 0x200d || c === 0x3000 || c === 0xfeff;

/** Characters of `text` none of `faces` can draw (line breaks and joiners aside). */
export function missingIn(text: string, faces: readonly Face[]): Set<number> {
  const out = new Set<number>();
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (isLayoutOnly(c) || c === 0x20) continue;
    if (!faces.some((f) => f.unicodes.has(c))) out.add(c);
  }
  return out;
}

/** In the Render worker: HarfBuzz and the font files from our own origin. */
export function workerFontSource(origin: string, subsetUrl: string): FontSource {
  return {
    harfbuzz: () => import('./harfbuzz'),
    subsetWasm: async () => {
      const res = await fetch(subsetUrl);
      if (!res.ok) throw new Error(`subset wasm: HTTP ${String(res.status)}`);
      return res.arrayBuffer();
    },
    fontFile: async (file) => {
      const res = await fetch(new URL(fontLibraryPath(file), origin).href);
      if (!res.ok) throw new Error(`font: HTTP ${String(res.status)}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
