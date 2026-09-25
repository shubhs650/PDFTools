// Offline signature integrity check with PKI.js (D-24 shape): does the CMS
// messageDigest match SHA-256 of the ByteRange bytes, and does the signature
// over the signed attributes verify with the embedded certificate?
// Trust is *not* evaluated ("not verified", ARCHITECTURE §7.11).

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { signatureParts } from './save-core.ts';

const MESSAGE_DIGEST = '1.2.840.113549.1.9.4';

export interface SigCheck {
  present: boolean;
  byteRange?: [number, number, number, number];
  coversBytes?: number;
  digestMatches?: boolean;
  signatureVerified?: boolean;
  error?: string;
}

function hex(b: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function checkSignature(pdf: Uint8Array): Promise<SigCheck> {
  const parts = signatureParts(pdf);
  if (!parts) return { present: false };
  try {
    const asn1 = asn1js.fromBER(parts.cms);
    if (asn1.offset === -1) throw new Error('CMS is not valid BER');
    const content = new pkijs.ContentInfo({ schema: asn1.result });
    const sd = new pkijs.SignedData({ schema: content.content });
    const signer = sd.signerInfos[0];
    const attr = signer?.signedAttrs?.attributes.find((a) => a.type === MESSAGE_DIGEST);
    const expected = attr?.values[0] as asn1js.OctetString | undefined;
    const actual = await crypto.subtle.digest('SHA-256', parts.signed.slice());
    const digestMatches = expected ? hex(expected.valueBlock.valueHexView) === hex(actual) : false;
    const verified = await sd.verify({
      signer: 0,
      data: parts.signed.slice().buffer,
      checkChain: false,
      extendedMode: true,
    });
    const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(
      new TextDecoder('latin1').decode(pdf),
    );
    const byteRange = br
      ? ([Number(br[1]), Number(br[2]), Number(br[3]), Number(br[4])] as [
          number,
          number,
          number,
          number,
        ])
      : undefined;
    return {
      present: true,
      ...(byteRange ? { byteRange, coversBytes: byteRange[2] + byteRange[3] } : {}),
      digestMatches,
      signatureVerified: verified.signatureVerified === true,
    };
  } catch (e) {
    return { present: true, error: String(e) };
  }
}
