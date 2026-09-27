// Save verification for our object layer's keys (M3-03, extends M1-21): the
// saved file, read with our own reader (PDFium can't read nested dictionaries),
// must hold every staged key with the staged value, and none of the removed ones.
import { isDict, serialize } from '../../model/pdf/objects';
import { PdfReader, type Inflate } from '../../model/pdf/reader';
import { ABSENT, hashText, type ObjectDigest } from '../render/save/digest';
import type { VerifyResult } from './verifySave';

export async function verifyObjects(
  expected: readonly ObjectDigest[],
  bytes: Uint8Array,
  inflate?: Inflate,
  password?: string,
): Promise<VerifyResult> {
  if (expected.length === 0) return { ok: true };
  let reader: PdfReader;
  try {
    // Encrypted files: strings are decrypted with the open password's file key (M3-04).
    reader = await PdfReader.open(bytes, inflate, password === undefined ? {} : { password });
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  for (const want of expected) {
    let value;
    try {
      value = await reader.get(want.obj);
    } catch {
      return { ok: false, reason: 'unparsable' };
    }
    if (!isDict(value)) return { ok: false, reason: 'objects' };
    for (const [key, hash] of Object.entries(want.keys)) {
      const got = value.get(key);
      const actual = got === undefined ? ABSENT : hashText(serialize(got));
      if (actual !== hash) return { ok: false, reason: 'objects' };
    }
  }
  return { ok: true };
}
