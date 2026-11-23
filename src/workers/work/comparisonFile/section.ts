// One incremental section written by our object layer (ADR-007) on top of an
// existing file (M12-20, D-65; spike S31): a comparison file's attachments,
// its /PieceInfo tag and a text comparison's change marks. The section is
// appended with the save core's narrowTail in its "only our objects" mode
// (ADR-016 decision 2): the base's bytes are never touched and its xref form
// (table or stream) is kept. In an encrypted base every new string and stream
// is encrypted with the base's own key, so the file keeps its password.
import { zlibSync } from 'fflate';
import {
  asciiName,
  PIECE_KEY,
  PRIVATE_TYPE,
  type FileKind,
} from '../../../model/compare/file/format';
import {
  N,
  PdfRef,
  PdfString,
  isDict,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../../model/pdf/objects';
import { PdfReader } from '../../../model/pdf/reader';
import { md5 } from '../../../model/pdf/security/md5';
import { concatBytes, encodeLatin1 } from '../../render/save/bytes';
import { narrowTail, type ExtraObject } from '../../render/save/narrowTail';
import { saveBaseOf } from '../../render/save/xref';

/** A text string: printable ASCII as is, anything else UTF-16BE with a BOM. */
export function textString(s: string): PdfString {
  if (/^[\x20-\x7e]*$/.test(s)) return PdfString.of(s);
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = c >> 8;
    out[3 + i * 2] = c & 0xff;
  }
  return new PdfString(out);
}

/** PDF date string for `d` in UTC. */
export function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${String(d.getUTCFullYear())}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export interface EmbedSpec {
  fileName: string;
  bytes: Uint8Array;
  /** The stream's /Subtype, e.g. "application/pdf". */
  mime: string;
  desc: string;
  relationship: 'Source' | 'Data' | 'Supplement';
  modified: Date;
}

export type Inflate = (b: Uint8Array) => Promise<Uint8Array>;

export class Section {
  readonly base: Uint8Array;
  readonly reader: PdfReader;
  private next: number;
  private readonly objects = new Map<number, ExtraObject>();

  private constructor(base: Uint8Array, reader: PdfReader) {
    this.base = base;
    this.reader = reader;
    this.next = Math.max(reader.maxObjNum(), ...[...reader.xref.keys()].map((k) => k + 1));
  }

  static async open(base: Uint8Array, password?: string, inflate?: Inflate): Promise<Section> {
    const reader = await PdfReader.open(base, inflate, password === undefined ? {} : { password });
    if (!reader.readable) throw new Error('the base file could not be decrypted');
    return new Section(base, reader);
  }

  alloc(): number {
    return this.next++;
  }

  private genOf(num: number): number {
    const e = this.reader.xref.get(num);
    return e?.type === 1 ? e.gen : 0;
  }

  /** Writes (or replaces) object `num`; strings are encrypted for the base's key. */
  value(num: number, v: PdfValue): PdfRef {
    const gen = this.genOf(num);
    const crypt = this.reader.crypt;
    const value = crypt ? crypt.mapStrings(v, num, gen, true) : v;
    this.objects.set(num, { num, gen, bytes: serializeIndirect(num, gen, value) });
    return new PdfRef(num, gen);
  }

  /** Writes a stream object; `compress` deflates `data` first. Encrypted for the base's key. */
  stream(num: number, dict: PdfDict, data: Uint8Array, compress = true): PdfRef {
    const gen = this.genOf(num);
    const crypt = this.reader.crypt;
    const d: PdfDict = new Map(crypt ? (crypt.mapStrings(dict, num, gen, true) as PdfDict) : dict);
    let body = data;
    if (compress) {
      body = zlibSync(data, { level: 6 });
      d.set('Filter', N('FlateDecode'));
    }
    if (crypt) body = crypt.encryptStream(num, gen, body);
    d.set('Length', body.length);
    this.objects.set(num, {
      num,
      gen,
      bytes: concatBytes([
        encodeLatin1(`${String(num)} ${String(gen)} obj\r\n${serialize(d)}\r\nstream\r\n`),
        body,
        encodeLatin1('\r\nendstream\r\nendobj'),
      ]),
    });
    return new PdfRef(num, gen);
  }

  /**
   * An embedded file stream and its file specification (ISO 32000-2 7.11.4,
   * 14.13); `filespecNum` replaces an existing file specification in place.
   */
  embed(e: EmbedSpec, filespecNum = this.alloc()): PdfRef {
    const params: PdfDict = new Map<string, PdfValue>([
      ['Size', e.bytes.length],
      ['CheckSum', new PdfString(md5(e.bytes), true)],
      ['ModDate', PdfString.of(pdfDate(e.modified))],
    ]);
    const ef = this.stream(
      this.alloc(),
      new Map<string, PdfValue>([
        ['Type', N('EmbeddedFile')],
        ['Subtype', N(e.mime)],
        ['Params', params],
      ]),
      e.bytes,
    );
    return this.value(
      filespecNum,
      new Map<string, PdfValue>([
        ['Type', N('Filespec')],
        ['F', PdfString.of(asciiName(e.fileName))],
        ['UF', textString(e.fileName)],
        ['Desc', textString(e.desc)],
        [
          'EF',
          new Map<string, PdfValue>([
            ['F', ef],
            ['UF', ef],
          ]),
        ],
        ['AFRelationship', N(e.relationship)],
      ]),
    );
  }

  /** Every [key, value] of a name tree, flattened. */
  async nameTree(root: PdfValue | undefined): Promise<[PdfString, PdfValue][]> {
    return nameTreeOf(this.reader, root);
  }

  async catalog(): Promise<{ num: number; dict: PdfDict }> {
    const ref = this.reader.trailer.get('Root');
    if (!(ref instanceof PdfRef)) throw new Error('no /Root');
    const dict = await this.reader.get(ref);
    if (!isDict(dict)) throw new Error('no catalog');
    return { num: ref.num, dict };
  }

  /**
   * Rewrites the catalog: our files merged into /Names /EmbeddedFiles (the
   * file's own attachments kept, keys sorted by byte value), added to /AF,
   * and our page-piece dictionary in /PieceInfo (others kept).
   */
  async tagCatalog(opts: {
    files: { key: string; ref: PdfRef }[];
    kind: FileKind;
    version: number;
    data: PdfRef;
    modified: Date;
    /** Further catalog changes made in the same rewrite. */
    edit?: (d: PdfDict) => void | Promise<void>;
  }): Promise<void> {
    const cat = await this.catalog();
    const d: PdfDict = new Map(cat.dict);
    await opts.edit?.(d);
    const namesVal = await this.reader.resolve(d.get('Names'));
    const names: PdfDict = new Map(isDict(namesVal) ? namesVal : []);
    const ours = new Set(opts.files.map((f) => f.key));
    const existing = (await this.nameTree(names.get('EmbeddedFiles'))).filter(
      ([k]) => !ours.has(k.text()),
    );
    const all: [PdfString, PdfValue][] = [
      ...existing,
      ...opts.files.map((f): [PdfString, PdfValue] => [PdfString.of(f.key), f.ref]),
    ];
    all.sort(([a], [b]) => compareBytes(a.bytes, b.bytes));
    const treeNum = this.alloc();
    this.value(treeNum, new Map<string, PdfValue>([['Names', all.flat()]]));
    names.set('EmbeddedFiles', new PdfRef(treeNum, 0));
    d.set('Names', names);

    const afVal = await this.reader.resolve(d.get('AF'));
    const ourNums = new Set(opts.files.map((f) => f.ref.num));
    const af = (Array.isArray(afVal) ? afVal : []).filter(
      (v) => !(v instanceof PdfRef && ourNums.has(v.num)),
    );
    d.set('AF', [...af, ...opts.files.map((f) => f.ref)]);

    const pieceVal = await this.reader.resolve(d.get('PieceInfo'));
    const piece: PdfDict = new Map(isDict(pieceVal) ? pieceVal : []);
    piece.set(
      PIECE_KEY,
      new Map<string, PdfValue>([
        ['LastModified', PdfString.of(pdfDate(opts.modified))],
        [
          'Private',
          new Map<string, PdfValue>([
            ['Type', N(PRIVATE_TYPE)],
            ['Kind', N(opts.kind === 'overlay' ? 'Overlay' : 'Text')],
            ['Version', opts.version],
            ['Data', opts.data],
          ]),
        ],
      ]),
    );
    d.set('PieceInfo', piece);
    this.value(cat.num, d);
  }

  /** The base's bytes unchanged, then our objects, xref and trailer. */
  finish(): Uint8Array {
    const r = narrowTail(saveBaseOf(this.base), this.base, this.base.length, [], {
      extra: [...this.objects.values()],
      onlyExtra: true,
    });
    return concatBytes([this.base, r.tail]);
  }
}

/** Every [key, value] of a name tree (cycles and depth guarded). */
export async function nameTreeOf(
  reader: PdfReader,
  root: PdfValue | undefined,
): Promise<[PdfString, PdfValue][]> {
  const out: [PdfString, PdfValue][] = [];
  const seen = new Set<number>();
  const walk = async (ref: PdfValue | undefined, depth: number): Promise<void> => {
    if (depth > 32) return;
    if (ref instanceof PdfRef) {
      if (seen.has(ref.num)) return;
      seen.add(ref.num);
    }
    const node = await reader.resolve(ref);
    if (!isDict(node)) return;
    const names = await reader.resolve(node.get('Names'));
    if (Array.isArray(names)) {
      for (let i = 0; i + 1 < names.length; i += 2) {
        const k = names[i];
        if (k instanceof PdfString) out.push([k, names[i + 1] ?? null]);
      }
    }
    const kids = await reader.resolve(node.get('Kids'));
    if (Array.isArray(kids)) for (const k of kids) await walk(k, depth + 1);
  };
  await walk(root, 0);
  return out;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return a.length - b.length;
}
