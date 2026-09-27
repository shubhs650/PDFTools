// Signed self-made PDFs for M2-13, made with PKI.js and a throwaway RSA key
// generated per run (Node's WebCrypto). Nothing is committed (rule 13).
// adbe.pkcs7.detached signatures over /ByteRange with signed attributes
// (contentType, messageDigest, signingTime), as Acrobat writes them.
import { webcrypto } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { buildPdf } from './generate.ts';

const crypto = webcrypto as unknown as Crypto;
pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto }));

const CONTENTS_HEX = 16384; // 8 KiB of signature space
const PLACEHOLDER = '/ByteRange [0 0000000000 0000000000 0000000000]';
const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  commonName: '2.5.4.3',
};

export interface Signer {
  cert: pkijs.Certificate;
  key: CryptoKey;
  commonName: string;
}

/** A throwaway self-signed RSA-2048 / SHA-256 certificate. */
export async function makeSigner(commonName: string): Promise<Signer> {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: Date.now() % 1_000_000_000 });
  const name = [
    new pkijs.AttributeTypeAndValue({
      type: OID.commonName,
      value: new asn1js.Utf8String({ value: commonName }),
    }),
  ];
  cert.subject.typesAndValues = name;
  cert.issuer.typesAndValues = name;
  cert.notBefore.value = new Date(Date.UTC(2024, 0, 1));
  cert.notAfter.value = new Date(Date.UTC(2034, 0, 1));
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, 'SHA-256');
  return { cert, key: keys.privateKey, commonName };
}

/** Detached CMS over `data` with signed attributes. */
async function cms(data: Uint8Array, signer: Signer, when: Date): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data.slice());
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: signer.cert.issuer,
          serialNumber: signer.cert.serialNumber,
        }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({
              type: OID.contentType,
              values: [new asn1js.ObjectIdentifier({ value: OID.data })],
            }),
            new pkijs.Attribute({
              type: OID.messageDigest,
              values: [new asn1js.OctetString({ valueHex: digest })],
            }),
            new pkijs.Attribute({
              type: OID.signingTime,
              values: [new asn1js.UTCTime({ valueDate: when })],
            }),
          ],
        }),
      }),
    ],
    certificates: [signer.cert],
  });
  await sd.sign(signer.key, 0, 'SHA-256');
  const info = new pkijs.ContentInfo({ contentType: OID.signedData, content: sd.toSchema(true) });
  return new Uint8Array(info.toSchema().toBER(false));
}

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

/**
 * Fills the last signature placeholder in `pdf` (ByteRange and Contents)
 * with a signature over everything else.
 */
async function fill(pdf: Uint8Array, signer: Signer, when: Date): Promise<Uint8Array> {
  const text = latin1(pdf);
  const brAt = text.lastIndexOf(PLACEHOLDER);
  if (brAt < 0) throw new Error('no signature placeholder');
  const lt = text.indexOf('/Contents <', brAt) + '/Contents '.length; // the '<'
  const gt = lt + 1 + CONTENTS_HEX + 1; // after '>'
  const pad = (n: number): string => String(n).padStart(10, '0');
  const out = Buffer.from(pdf);
  out.write(`/ByteRange [0 ${pad(lt)} ${pad(gt)} ${pad(pdf.length - gt)}]`, brAt, 'latin1');
  const signed = Buffer.concat([out.subarray(0, lt), out.subarray(gt)]);
  const der = await cms(signed, signer, when);
  const hex = Buffer.from(der).toString('hex');
  if (hex.length > CONTENTS_HEX) throw new Error('signature too large');
  out.write(hex, lt + 1, 'latin1');
  return new Uint8Array(out);
}

const sigDict = (name: string, reason: string, location: string, m: string): string =>
  `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ${PLACEHOLDER} /Contents <${'0'.repeat(CONTENTS_HEX)}> /M (${m}) /Name (${name}) /Reason (${reason}) /Location (${location}) >>`;

/** One page, one signature field "Approval" signed by `signer`. */
export async function signedPdf(signer: Signer): Promise<Uint8Array> {
  const pdf = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [5 0 R] >>',
    { dict: '<< >>', stream: 'BT /F1 24 Tf 72 740 Td (Signed test page) Tj ET' },
    '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Approval) /Rect [0 0 0 0] /F 132 /P 3 0 R /V 6 0 R >>',
    sigDict('Test Signer', 'Approved', 'Test Lab', 'D:20240301120000Z'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
  return fill(pdf, signer, new Date(Date.UTC(2024, 2, 1, 12)));
}

/** Appends an incremental revision with the given [object number, text] objects. */
export function appendRevision(
  base: Uint8Array,
  objects: [number, string][],
  root = 1,
): Uint8Array {
  const text = latin1(base);
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1] ?? 0);
  const size = Number([...text.matchAll(/\/Size (\d+)/g)].pop()?.[1] ?? 0);
  let body = '\n';
  const offsets: [number, number][] = [];
  for (const [num, o] of objects) {
    offsets.push([num, base.length + body.length]);
    body += `${String(num)} 0 obj\n${o}\nendobj\n`;
  }
  const xrefAt = base.length + body.length;
  let xref = 'xref\n';
  for (const [num, off] of offsets)
    xref += `${String(num)} 1\n${String(off).padStart(10, '0')} 00000 n \n`;
  const newSize = Math.max(size, ...objects.map(([n]) => n + 1));
  xref += `trailer\n<< /Size ${String(newSize)} /Root ${String(root)} 0 R /Prev ${String(prev)} >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([Buffer.from(base), Buffer.from(body + xref, 'latin1')]));
}

/**
 * `signedPdf`, then a second signature field "Review" signed by `second` in
 * an incremental revision (the first signature covers revision 1 of 2).
 */
export async function twiceSignedPdf(first: Signer, second: Signer): Promise<Uint8Array> {
  const one = await signedPdf(first);
  const two = appendRevision(one, [
    [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 8 0 R] /SigFlags 3 >> >>'],
    [
      3,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [5 0 R 8 0 R] >>',
    ],
    [
      8,
      '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Review) /Rect [0 0 0 0] /F 132 /P 3 0 R /V 9 0 R >>',
    ],
    [9, sigDict('Second Signer', 'Reviewed', 'Elsewhere', 'D:20240302120000Z')],
  ]);
  return fill(two, second, new Date(Date.UTC(2024, 2, 2, 12)));
}

/** A copy with one byte inside the signed range changed. */
export function tampered(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const at = latin1(out).indexOf('Signed test page');
  out[at] = 's'.charCodeAt(0);
  return out;
}

/** A harmless incremental revision after signing (a new, unused object). */
export function savedAfterSigning(bytes: Uint8Array): Uint8Array {
  const size = Number([...latin1(bytes).matchAll(/\/Size (\d+)/g)].pop()?.[1] ?? 8);
  return appendRevision(bytes, [[size, '<< /Note (added after signing) >>']]);
}
