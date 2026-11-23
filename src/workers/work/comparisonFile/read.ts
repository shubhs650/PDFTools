// Recognising a comparison file and taking it apart again (M12-20, D-65;
// spike S31): the data, each input byte for byte, each checked by its
// SHA-256. Detection reads only the catalog's /PieceInfo; the data attachment
// by its key is the fallback for a file whose catalog another program
// rewrote without our page-piece dictionary.
import {
  DataError,
  KEY_DATA,
  PIECE_KEY,
  PRIVATE_TYPE,
  decodeData,
  revisionCount,
  sha256Hex,
  type ComparisonData,
  type FileKind,
  type StoredFile,
} from '../../../model/compare/file/format';
import { PdfStream, isDict, nameOf, numOf, type PdfDict } from '../../../model/pdf/objects';
import type { PdfReader } from '../../../model/pdf/reader';
import { nameTreeOf } from './section';

export interface Detected {
  kind: FileKind;
  version: number;
  /** How it was recognised. */
  via: 'pieceInfo' | 'attachment';
}

/** The attachments of the file by their key. */
export async function attachmentsOf(reader: PdfReader): Promise<Map<string, PdfDict>> {
  const root = await reader.resolve(reader.trailer.get('Root'));
  const out = new Map<string, PdfDict>();
  if (!isDict(root)) return out;
  const names = await reader.resolve(root.get('Names'));
  if (!isDict(names)) return out;
  for (const [k, v] of await nameTreeOf(reader, names.get('EmbeddedFiles'))) {
    const spec = await reader.resolve(v);
    if (isDict(spec)) out.set(k.text(), spec);
  }
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
 * Is this a comparison file? Reads the catalog (and, as a fallback, the
 * attachment names and the data's first fields). Null for any other PDF.
 */
export async function detect(reader: PdfReader): Promise<Detected | null> {
  const root = await reader.resolve(reader.trailer.get('Root'));
  if (!isDict(root)) return null;
  const piece = await reader.resolve(root.get('PieceInfo'));
  if (isDict(piece)) {
    const ours = await reader.resolve(piece.get(PIECE_KEY));
    const priv = isDict(ours) ? await reader.resolve(ours.get('Private')) : undefined;
    if (isDict(priv) && nameOf(priv.get('Type')) === PRIVATE_TYPE) {
      return {
        kind: nameOf(priv.get('Kind')) === 'Text' ? 'text' : 'overlay',
        version: numOf(priv.get('Version')) ?? 0,
        via: 'pieceInfo',
      };
    }
  }
  const names = await reader.resolve(root.get('Names'));
  if (!isDict(names)) return null;
  const hasData = (await nameTreeOf(reader, names.get('EmbeddedFiles'))).some(
    ([k]) => k.text() === KEY_DATA,
  );
  if (!hasData) return null;
  const spec = (await attachmentsOf(reader)).get(KEY_DATA);
  if (!spec) return null;
  try {
    const data = decodeData(await fileBytes(reader, spec));
    return { kind: data.kind, version: data.version, via: 'attachment' };
  } catch (err) {
    // A newer version found by its data: still ours, refused when opened.
    if (err instanceof DataError && err.problem === 'newer')
      return { kind: 'overlay', version: Number.MAX_SAFE_INTEGER, via: 'attachment' };
    return null;
  }
}

export interface Recovered {
  file: StoredFile;
  bytes: Uint8Array;
  /** SHA-256 and length match the stored values (byte for byte). */
  exact: boolean;
}

export interface Opened {
  detected: Detected;
  data: ComparisonData;
  A: Recovered[];
  B: Recovered[];
  /** Revisions another program appended after ours (text: B is the prefix). */
  foreignRevisions: number;
}

/** Opens a comparison file: the data, every input byte for byte, and what changed since. */
export async function readComparison(reader: PdfReader, bytes: Uint8Array): Promise<Opened> {
  const detected = await detect(reader);
  if (!detected) throw new DataError('notComparison', 'not a comparison file');
  const files = await attachmentsOf(reader);
  const dataSpec = files.get(KEY_DATA);
  if (!dataSpec) throw new DataError('broken', 'comparison data missing');
  const data = decodeData(await fileBytes(reader, dataSpec));
  const recover = async (f: StoredFile): Promise<Recovered> => {
    let b: Uint8Array;
    if ('attachment' in f.storage) {
      const spec = files.get(f.storage.attachment);
      b = spec ? await fileBytes(reader, spec).catch(() => new Uint8Array()) : new Uint8Array();
    } else {
      b = bytes.slice(0, Math.min(bytes.length, f.storage.prefix.length));
    }
    return { file: f, bytes: b, exact: b.length === f.size && (await sha256Hex(b)) === f.sha256 };
  };
  const A = await Promise.all(data.documents.A.map(recover));
  const B = await Promise.all(data.documents.B.map(recover));
  // Our section is one revision; a prefix-stored B brings its own.
  const b0 = data.documents.B[0];
  const ours = b0 && 'prefix' in b0.storage ? b0.storage.prefix.revisions + 1 : undefined;
  const foreignRevisions = ours === undefined ? 0 : Math.max(0, revisionCount(bytes) - ours);
  return { detected, data, A, B, foreignRevisions };
}
