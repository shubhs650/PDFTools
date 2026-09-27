// Offline signature integrity (D-24, §7.11, M2-13), in the Work worker with
// PKI.js: the digest of the /ByteRange bytes against the CMS messageDigest,
// and the signature over the signed attributes with the embedded
// certificate. Trust is never evaluated: no chain building, no OCSP, CRL or
// AIA fetch (rule 4) — the UI always says "Not verified (offline)".
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { parsePdfDate } from '../../model/pdfDate';
import {
  coverage,
  findSignatures,
  signedBytes,
  type Coverage,
  type SignatureField,
} from '../../model/signatures';
import type { JobSlice } from './scheduler';

const OID = {
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  commonName: '2.5.4.3',
};

const DIGESTS: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

export type Integrity = 'unchanged' | 'modified' | 'damaged';

export interface SignatureInfo extends Coverage {
  /** Signer's certificate subject CN (falls back to the dictionary's /Name). */
  signer: string;
  /** ISO time: the signed signingTime attribute, else /M. */
  signedAt: string | null;
  reason: string;
  location: string;
  subFilter: string;
  integrity: Integrity;
}

const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

function commonName(name: pkijs.RelativeDistinguishedNames | undefined): string {
  const tv = name?.typesAndValues.find((t) => t.type === OID.commonName);
  const v = tv?.value as { valueBlock?: { value?: unknown } } | undefined;
  return typeof v?.valueBlock?.value === 'string' ? v.valueBlock.value : '';
}

async function check(
  bytes: Uint8Array,
  field: SignatureField,
): Promise<Pick<SignatureInfo, 'signer' | 'signedAt' | 'integrity'>> {
  const fallback = {
    signer: field.name,
    signedAt: parsePdfDate(field.m)?.toISOString() ?? null,
  };
  try {
    const asn1 = asn1js.fromBER(field.cms.slice().buffer);
    if (asn1.offset === -1) return { ...fallback, integrity: 'damaged' };
    const content = new pkijs.ContentInfo({ schema: asn1.result });
    const sd = new pkijs.SignedData({ schema: content.content });
    const info = sd.signerInfos[0];
    if (!info) return { ...fallback, integrity: 'damaged' };
    const sid = info.sid as pkijs.IssuerAndSerialNumber;
    const cert = (sd.certificates ?? []).find(
      (c): c is pkijs.Certificate =>
        c instanceof pkijs.Certificate &&
        c.serialNumber.isEqual(sid.serialNumber) &&
        c.issuer.isEqual(sid.issuer),
    );
    const attrs = info.signedAttrs?.attributes ?? [];
    const time = attrs.find((a) => a.type === OID.signingTime)?.values[0] as
      asn1js.UTCTime | asn1js.GeneralizedTime | undefined;
    const who = {
      signer: commonName(cert?.subject) || field.name,
      signedAt: time ? time.toDate().toISOString() : fallback.signedAt,
    };
    const algorithm = DIGESTS[info.digestAlgorithm.algorithmId];
    const expected = attrs.find((a) => a.type === OID.messageDigest)?.values[0] as
      asn1js.OctetString | undefined;
    if (!algorithm || !expected) return { ...who, integrity: 'damaged' };
    const data = signedBytes(bytes, field.byteRange);
    const actual = await crypto.subtle.digest(algorithm, data);
    if (hex(expected.valueBlock.valueHexView) !== hex(actual))
      return { ...who, integrity: 'modified' };
    const verified = await sd.verify({
      signer: 0,
      data: data.buffer,
      checkChain: false, // trust is not evaluated offline (D-24)
      extendedMode: true,
    });
    return { ...who, integrity: verified.signatureVerified === true ? 'unchanged' : 'damaged' };
  } catch {
    return { ...fallback, integrity: 'damaged' };
  }
}

/** Every signature, checked one after another (progress and cancel between them, rule 2). */
export async function checkSignatures(
  bytes: Uint8Array,
  slice: JobSlice,
  onProgress: (p: { done: number; total: number }) => void,
): Promise<SignatureInfo[]> {
  const fields = findSignatures(bytes);
  const out: SignatureInfo[] = [];
  for (const [i, field] of fields.entries()) {
    await slice.checkpoint();
    const valid =
      field.byteRange[0] === 0 &&
      field.byteRange[2] + field.byteRange[3] <= bytes.length &&
      field.byteRange[1] <= field.byteRange[2];
    const checked = valid
      ? await check(bytes, field)
      : { signer: field.name, signedAt: null, integrity: 'damaged' as const };
    out.push({
      ...checked,
      ...coverage(field.byteRange, bytes),
      reason: field.reason,
      location: field.location,
      subFilter: field.subFilter,
    });
    onProgress({ done: i + 1, total: fields.length });
  }
  return out;
}
