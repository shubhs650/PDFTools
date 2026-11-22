// Spike S31 (M12-06, D-65): one incremental section written by the app's own
// object layer (src/model/pdf) on top of an existing file — the comparison
// file's attachments, its /PieceInfo tag, the change marks on Document B's
// pages. The section is appended with the save core's narrowTail in its
// "only our objects" mode (ADR-016 decision 2), so the base file's bytes are
// never touched and its xref form (table or stream) is kept. In an encrypted
// base every new string and stream is encrypted with the base's own key.
import { zlibSync } from 'fflate';
import {
  N,
  PdfRef,
  PdfString,
  isDict,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { md5 } from '../../src/model/pdf/security/md5';
import { concatBytes, encodeLatin1 } from '../../src/workers/render/save/bytes';
import { narrowTail, type ExtraObject } from '../../src/workers/render/save/narrowTail';
import { saveBaseOf } from '../../src/workers/render/save/xref';
import { PIECE_KEY, PRIVATE_TYPE, type Kind } from './format';

/** A text string: PDFDocEncoding-safe ASCII as is, anything else UTF-16BE with a BOM. */
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

const hex = (b: Uint8Array): PdfString => new PdfString(b, true);

export interface EmbedSpec {
  key: string;
  fileName: string;
  bytes: Uint8Array;
  mime: string;
  desc: string;
  relationship: 'Source' | 'Data' | 'Supplement';
  modified: Date;
}

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

  static async open(base: Uint8Array, password?: string): Promise<Section> {
    const reader = await PdfReader.open(
      base,
      undefined,
      password === undefined ? {} : { password },
    );
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

  /** Writes (or replaces) object `num` with `v`; strings are encrypted for the base's key. */
  value(num: number, v: PdfValue): PdfRef {
    const gen = this.genOf(num);
    const crypt = this.reader.crypt;
    const value = crypt ? crypt.mapStrings(v, num, gen, true) : v;
    this.objects.set(num, { num, gen, bytes: serializeIndirect(num, gen, value) });
    return new PdfRef(num, gen);
  }

  /** Writes object `num` from its text as is (unencrypted bases only: a signature placeholder). */
  raw(num: number, text: string): PdfRef {
    if (this.reader.crypt) throw new Error('raw objects need an unencrypted base');
    this.objects.set(num, {
      num,
      gen: 0,
      bytes: encodeLatin1(`${String(num)} 0 obj\r\n${text}\r\nendobj`),
    });
    return new PdfRef(num, 0);
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

  /** An embedded file stream and its file specification (ISO 32000-2 7.11.4, 14.13). */
  embed(e: EmbedSpec, filespecNum = this.alloc()): PdfRef {
    const streamNum = this.alloc();
    const params: PdfDict = new Map<string, PdfValue>([
      ['Size', e.bytes.length],
      ['CheckSum', hex(md5(e.bytes))],
      ['ModDate', PdfString.of(pdfDate(e.modified))],
    ]);
    const ef = this.stream(
      streamNum,
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

  /** Every [key, value] of a name tree, flattened (keys as raw bytes). */
  async nameTree(root: PdfValue | undefined): Promise<[PdfString, PdfValue][]> {
    const out: [PdfString, PdfValue][] = [];
    const seen = new Set<number>();
    const walk = async (ref: PdfValue | undefined, depth: number): Promise<void> => {
      if (depth > 32) throw new Error('name tree too deep');
      if (ref instanceof PdfRef) {
        if (seen.has(ref.num)) return;
        seen.add(ref.num);
      }
      const node = await this.reader.resolve(ref);
      if (!isDict(node)) return;
      const names = await this.reader.resolve(node.get('Names'));
      if (Array.isArray(names)) {
        for (let i = 0; i + 1 < names.length; i += 2) {
          const k = names[i];
          if (k instanceof PdfString) out.push([k, names[i + 1] ?? null]);
        }
      }
      const kids = await this.reader.resolve(node.get('Kids'));
      if (Array.isArray(kids)) for (const k of kids) await walk(k, depth + 1);
    };
    await walk(root, 0);
    return out;
  }

  async catalog(): Promise<{ num: number; dict: PdfDict }> {
    const ref = this.reader.trailer.get('Root');
    if (!(ref instanceof PdfRef)) throw new Error('no /Root');
    const dict = await this.reader.get(ref);
    if (!isDict(dict)) throw new Error('no catalog');
    return { num: ref.num, dict };
  }

  /**
   * Rewrites the catalog: our files merged into /Names /EmbeddedFiles (any of
   * the file's own attachments kept, keys sorted), added to /AF, and our
   * page-piece dictionary in /PieceInfo (others kept).
   */
  async tagCatalog(opts: {
    files: { key: string; ref: PdfRef }[];
    kind: Kind;
    version: number;
    data: PdfRef;
    modified: Date;
    pageMode?: string;
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
      ([k]) => !ours.has(new TextDecoder('latin1').decode(k.bytes)),
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
    if (opts.pageMode) d.set('PageMode', N(opts.pageMode));
    this.value(cat.num, d);
  }

  /** Appends the section: base bytes unchanged, then our objects, xref and trailer. */
  finish(): Uint8Array {
    const base = saveBaseOf(this.base);
    const r = narrowTail(base, this.base, this.base.length, [], {
      extra: [...this.objects.values()],
      onlyExtra: true,
    });
    return concatBytes([this.base, r.tail]);
  }

  get objectCount(): number {
    return this.objects.size;
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  return a.length - b.length;
}

/** `/F` must be ASCII-safe for old readers; `/UF` carries the real name. */
function asciiName(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '_');
}
