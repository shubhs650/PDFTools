// Spike S31 (M12-06, D-65): Save review in a reopened comparison file. The
// reviewer's new comments go into the copies of Document A and B inside it,
// each by an incremental section (rule 7: the copy's own bytes are kept, so a
// signature in it stays valid), and the comparison file is then brought up
// to date:
// - overlay: "incremental" appends new attachment streams for the changed
//   copies (the file grows by each changed copy every time), "compact" then
//   rewrites the whole file with PDFium (only the newest copies are kept);
// - text: the file is rebuilt as the new B plus a fresh section (B is the
//   prefix, so B's own new section must come before ours).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  N,
  PdfRef,
  PdfString,
  isDict,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { encodeLatin1 } from '../../src/workers/render/save/bytes';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer';
import { openDoc } from '../s29-overlay/pdfiumKit';
import { buildTextFile, type Input } from './build';
import {
  DATA_FILE_NAME,
  KEY_DATA,
  encodeData,
  sha256Hex,
  type ComparisonData,
  type StoredFile,
} from './format';
import { openComparison } from './read';
import { Section, pdfDate } from './section';

/** A sticky note on page `index` (0-based) of `bytes`, appended as one incremental section. */
export async function addNote(
  bytes: Uint8Array,
  index: number,
  text: string,
  opts: { when: Date; password?: string; nm: string },
): Promise<Uint8Array> {
  const sec = await Section.open(bytes, opts.password);
  const pages = await sec.reader.pages();
  const page = pages[index];
  if (!page) throw new Error('no such page');
  const box = await sec.reader.resolve(page.dict.get('CropBox') ?? page.dict.get('MediaBox'));
  const [x0, , , y1] = (Array.isArray(box) ? box : [0, 0, 612, 792]) as number[];
  const rect = [(x0 ?? 0) + 36, (y1 ?? 792) - 60, (x0 ?? 0) + 56, (y1 ?? 792) - 40];
  const ap = sec.stream(
    sec.alloc(),
    new Map<string, PdfValue>([
      ['Type', N('XObject')],
      ['Subtype', N('Form')],
      ['BBox', rect],
    ]),
    encodeLatin1(`1 0.9 0.2 rg 0 G 0.5 w ${String(rect[0])} ${String(rect[1])} 20 20 re b`),
  );
  const date = PdfString.of(pdfDate(opts.when));
  const note = sec.value(
    sec.alloc(),
    new Map<string, PdfValue>([
      ['Type', N('Annot')],
      ['Subtype', N('Text')],
      ['Rect', rect],
      ['Contents', PdfString.of(text)],
      ['T', PdfString.of('Reviewer')],
      ['NM', PdfString.of(opts.nm)],
      ['M', date],
      ['CreationDate', date],
      ['C', [1, 0.9, 0.2]],
      ['Name', N('Comment')],
      ['F', 4],
      ['P', new PdfRef(page.num, 0)],
      ['AP', new Map<string, PdfValue>([['N', ap]])],
    ]),
  );
  const pd: PdfDict = new Map(page.dict);
  const existing = await sec.reader.resolve(pd.get('Annots'));
  pd.set('Annots', [...(Array.isArray(existing) ? existing : []), note]);
  sec.value(page.num, pd);
  return sec.finish();
}

async function restored(f: StoredFile, bytes: Uint8Array): Promise<StoredFile> {
  return { ...f, size: bytes.length, sha256: await sha256Hex(bytes) };
}

/**
 * Overlay file: replaces the changed copies (`next` maps an attachment key to
 * its new bytes) and the data; `compact` rewrites the result with PDFium.
 */
export async function updateOverlayFile(
  mod: WrappedPdfiumModule,
  file: Uint8Array,
  next: ReadonlyMap<string, Uint8Array>,
  opts: { when: Date; compact: boolean; password?: string },
): Promise<Uint8Array> {
  const opened = await openComparison(file, opts.password);
  const sec = await Section.open(file, opts.password);
  const cat = await sec.catalog();
  const names = await sec.reader.resolve(cat.dict.get('Names'));
  const tree = await sec.nameTree(isDict(names) ? names.get('EmbeddedFiles') : undefined);
  const refOf = new Map(
    tree.map(([k, v]) => [new TextDecoder('latin1').decode(k.bytes), v] as const),
  );
  const replace = (key: string, bytes: Uint8Array, mime: string, name: string, desc: string) => {
    const ref = refOf.get(key);
    if (!(ref instanceof PdfRef)) throw new Error(`no attachment ${key}`);
    // Same file specification object, new stream: every reference stays valid.
    sec.embed(
      {
        key,
        fileName: name,
        bytes,
        mime,
        desc,
        relationship: key === KEY_DATA ? 'Data' : 'Source',
        modified: opts.when,
      },
      ref.num,
    );
  };
  const data: ComparisonData = structuredClone(opened.data);
  for (const side of ['A', 'B'] as const) {
    data.documents[side] = await Promise.all(
      data.documents[side].map(async (f) => {
        const key = 'attachment' in f.storage ? f.storage.attachment : '';
        const b = next.get(key);
        if (!b) return f;
        replace(key, b, 'application/pdf', f.name, `Document ${side}, with review comments`);
        return restored(f, b);
      }),
    );
  }
  data.modified = opts.when.toISOString();
  replace(
    KEY_DATA,
    encodeData(data),
    'application/json',
    DATA_FILE_NAME,
    'Triya PDF comparison data',
  );
  let out = sec.finish();
  if (opts.compact) {
    const d = openDoc(mod, out, opts.password);
    try {
      out = saveWithFlags(mod, d.doc, FPDF_NO_INCREMENTAL);
    } finally {
      d.close();
    }
  }
  return out;
}

/** Text file: rebuilt over the new B (B's prefix grows by its own section; ours comes last). */
export async function updateTextFile(
  mod: WrappedPdfiumModule,
  file: Uint8Array,
  next: { A?: Uint8Array; B?: Uint8Array },
  opts: { when: Date; password?: string; passwordA?: string },
): Promise<Uint8Array> {
  const opened = await openComparison(file, opts.password);
  const a = opened.A[0];
  const b = opened.B[0];
  if (!a || !b) throw new Error('inputs missing');
  if (!b.exact) throw new Error('Document B cannot be recovered exactly');
  const A: Input = { name: a.file.name, bytes: next.A ?? a.bytes };
  if (opts.passwordA) A.password = opts.passwordA;
  const B: Input = { name: b.file.name, bytes: next.B ?? b.bytes };
  if (opts.password) B.password = opts.password;
  const r = await buildTextFile(mod, A, B, opened.data.marks ?? [], {
    when: opts.when,
    route: 'prefix',
  });
  return r.bytes;
}
