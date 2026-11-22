// Spike S31 (M12-06, D-65): recognising a comparison file and taking it apart
// again — the data, Document A and Document B byte for byte, each checked by
// its SHA-256. Detection reads only the catalog (/PieceInfo); the data
// attachment by its key is the fallback for a file whose catalog another
// program rewrote without our page-piece dictionary.
import {
  PdfRef,
  PdfStream,
  PdfString,
  isDict,
  nameOf,
  numOf,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import {
  KEY_DATA,
  PIECE_KEY,
  PRIVATE_TYPE,
  decodeData,
  revisionCount,
  sha256Hex,
  type ComparisonData,
  type Kind,
  type StoredFile,
} from './format';

export interface Detected {
  kind: Kind;
  version: number;
  /** How it was recognised. */
  via: 'pieceInfo' | 'attachment';
  reader: PdfReader;
}

async function attachmentsOf(reader: PdfReader): Promise<Map<string, PdfDict>> {
  const root = await reader.resolve(reader.trailer.get('Root'));
  if (!isDict(root)) throw new Error('no catalog');
  const names = await reader.resolve(root.get('Names'));
  const out = new Map<string, PdfDict>();
  if (!isDict(names)) return out;
  const seen = new Set<number>();
  const walk = async (ref: PdfValue | undefined, depth: number): Promise<void> => {
    if (depth > 32) return;
    if (ref instanceof PdfRef) {
      if (seen.has(ref.num)) return;
      seen.add(ref.num);
    }
    const node = await reader.resolve(ref);
    if (!isDict(node)) return;
    const arr = await reader.resolve(node.get('Names'));
    if (Array.isArray(arr)) {
      for (let i = 0; i + 1 < arr.length; i += 2) {
        const k = arr[i];
        const v = await reader.resolve(arr[i + 1]);
        if (k instanceof PdfString && isDict(v)) out.set(k.text(), v);
      }
    }
    const kids = await reader.resolve(node.get('Kids'));
    if (Array.isArray(kids)) for (const k of kids) await walk(k, depth + 1);
  };
  await walk(names.get('EmbeddedFiles'), 0);
  return out;
}

async function fileBytes(reader: PdfReader, spec: PdfDict): Promise<Uint8Array> {
  const ef = await reader.resolve(spec.get('EF'));
  if (!isDict(ef)) throw new Error('attachment without /EF');
  const s = await reader.resolve(ef.get('UF') ?? ef.get('F'));
  if (!(s instanceof PdfStream)) throw new Error('attachment stream missing');
  return reader.decode(s);
}

/**
 * Is this a comparison file? Reads the catalog only (plus, as a fallback, the
 * attachment names). `null` for any other PDF.
 */
export async function detect(bytes: Uint8Array, password?: string): Promise<Detected | null> {
  const reader = await PdfReader.open(bytes, undefined, password === undefined ? {} : { password });
  if (!reader.readable) throw new Error('password needed');
  const root = await reader.resolve(reader.trailer.get('Root'));
  if (!isDict(root)) return null;
  const piece = await reader.resolve(root.get('PieceInfo'));
  if (isDict(piece)) {
    const ours = await reader.resolve(piece.get(PIECE_KEY));
    const priv = isDict(ours) ? await reader.resolve(ours.get('Private')) : undefined;
    if (isDict(priv) && nameOf(priv.get('Type')) === PRIVATE_TYPE) {
      const k = nameOf(priv.get('Kind'));
      return {
        kind: k === 'Text' ? 'text' : 'overlay',
        version: numOf(priv.get('Version')) ?? 0,
        via: 'pieceInfo',
        reader,
      };
    }
  }
  const files = await attachmentsOf(reader);
  const spec = files.get(KEY_DATA);
  if (!spec) return null;
  const data = decodeData(await fileBytes(reader, spec));
  return { kind: data.kind, version: data.version, via: 'attachment', reader };
}

export interface Recovered {
  file: StoredFile;
  bytes: Uint8Array;
  /** SHA-256 matches the stored value (byte for byte). */
  exact: boolean;
}

export interface Opened {
  detected: Detected;
  data: ComparisonData;
  A: Recovered[];
  B: Recovered[];
  /** Revisions appended after ours (another program saved into the comparison file). */
  foreignRevisions: number;
  /** Size of the data attachment (JSON, uncompressed). */
  dataBytes: number;
  ms: { detect: number; open: number };
}

/** Opens a comparison file: the data, every input byte for byte, and what changed since. */
export async function openComparison(bytes: Uint8Array, password?: string): Promise<Opened> {
  const t0 = performance.now();
  const detected = await detect(bytes, password);
  const t1 = performance.now();
  if (!detected) throw new Error('not a comparison file');
  const { reader } = detected;
  const files = await attachmentsOf(reader);
  const dataSpec = files.get(KEY_DATA);
  if (!dataSpec) throw new Error('comparison data missing');
  const raw = await fileBytes(reader, dataSpec);
  const data = decodeData(raw);
  const recover = async (f: StoredFile): Promise<Recovered> => {
    let b: Uint8Array;
    if ('attachment' in f.storage) {
      const spec = files.get(f.storage.attachment);
      if (!spec) throw new Error(`attachment ${f.storage.attachment} missing`);
      b = await fileBytes(reader, spec);
    } else {
      b = bytes.subarray(0, Math.min(bytes.length, f.storage.prefix.length));
    }
    return { file: f, bytes: b, exact: b.length === f.size && (await sha256Hex(b)) === f.sha256 };
  };
  const A = await Promise.all(data.documents.A.map(recover));
  const B = await Promise.all(data.documents.B.map(recover));
  // Our own section is one revision; a prefix-stored B brings its own.
  const b0 = data.documents.B[0];
  const ours = b0 && 'prefix' in b0.storage ? b0.storage.prefix.revisions + 1 : undefined;
  const foreignRevisions = ours === undefined ? 0 : Math.max(0, revisionCount(bytes) - ours);
  return {
    detected,
    data,
    A,
    B,
    foreignRevisions,
    dataBytes: raw.length,
    ms: { detect: t1 - t0, open: performance.now() - t0 },
  };
}
