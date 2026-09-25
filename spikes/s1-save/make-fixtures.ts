// Self-made S1 fixtures (CLAUDE.md rule 13). Writes to spikes/s1-save/out/fixtures/.
// External CLIs used only to *make* inputs: qpdf (encryption, Apache-2.0) and
// openssl (throwaway test signature). Neither is a project dependency.
//
// Usage: node spikes/s1-save/make-fixtures.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { buildPdf } from '../shared/mini-pdf.ts';

const outDir = join(import.meta.dirname, 'out', 'fixtures');
mkdirSync(outDir, { recursive: true });

const PAGE = '/MediaBox [0 0 595 842] /Resources << /Font << /F1 99 0 R >> >>';
const HELV = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

function textContent(title: string, lines: number): string {
  const out = [`BT /F1 20 Tf 60 780 Td (${title}) Tj ET`];
  for (let i = 0; i < lines; i++) {
    out.push(
      `BT /F1 11 Tf 60 ${String(740 - i * 16)} Td (Line ${String(i + 1)}: The quick brown fox jumps over the lazy dog.) Tj ET`,
    );
  }
  return out.join('\n');
}

/** Pages as objects 3.. ; object 99 is renumbered to the font by `withFont`. */
function withFont(objs: (string | { dict: string; stream: string })[]): typeof objs {
  const fontNum = objs.length + 1;
  const fix = (s: string): string => s.replaceAll('99 0 R', `${String(fontNum)} 0 R`);
  return [...objs.map((o) => (typeof o === 'string' ? fix(o) : { ...o, dict: fix(o.dict) })), HELV];
}

export function plainPdf(pages = 3): Uint8Array {
  const objs: (string | { dict: string; stream: string })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  ];
  for (let i = 0; i < pages; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R ${PAGE} /Contents ${String(4 + i * 2)} 0 R >>`);
    objs.push({
      dict: '<< >>',
      stream: textContent(`PDFTools S1 plain page ${String(i + 1)}`, 40),
    });
  }
  return buildPdf(withFont(objs));
}

/** plain.pdf plus one unreferenced (orphan) stream, to see whether a full rewrite drops it. */
export function orphanPdf(): Uint8Array {
  const objs: (string | { dict: string; stream: string })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R ${PAGE} /Contents 4 0 R >>`,
    { dict: '<< >>', stream: textContent('PDFTools S1 orphan-object page', 10) },
  ];
  return buildPdf([
    ...withFont(objs),
    { dict: '<< >>', stream: '% ORPHAN-MARKER unreferenced object' },
  ]);
}

/** One page with a sticky note and a square that already has an appearance stream. */
export function annotatedPdf(): Uint8Array {
  return buildPdf(
    withFont([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R ${PAGE} /Contents 4 0 R /Annots [5 0 R 6 0 R] >>`,
      { dict: '<< >>', stream: textContent('PDFTools S1 annotated page', 30) },
      '<< /Type /Annot /Subtype /Text /Rect [500 780 520 800] /Contents (Existing sticky note) /T (Fixture) /Name /Comment /C [1 1 0] /F 4 >>',
      '<< /Type /Annot /Subtype /Square /Rect [100 500 300 600] /Contents (Existing square) /T (Fixture) /C [1 0 0] /BS << /W 2 >> /F 4 /AP << /N 7 0 R >> >>',
      {
        dict: '<< /Type /XObject /Subtype /Form /BBox [100 500 300 600] >>',
        stream: '1 0 0 RG 2 w 101 501 198 98 re S',
      },
    ]),
  );
}

/** AcroForm: one text field with a value and one checked checkbox, both with appearances. */
export function formPdf(): Uint8Array {
  return buildPdf(
    withFont([
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R] /DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv 99 0 R >> >> >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R ${PAGE} /Contents 4 0 R /Annots [5 0 R 6 0 R] >>`,
      { dict: '<< >>', stream: 'BT /F1 16 Tf 60 780 Td (PDFTools S1 form) Tj ET' },
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (Initial value) /DA (/Helv 12 Tf 0 g) /Rect [60 700 300 724] /F 4 /P 3 0 R /AP << /N 7 0 R >> >>',
      '<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /V /Yes /AS /Yes /Rect [60 660 76 676] /F 4 /P 3 0 R /MK << /CA (4) >> /AP << /N << /Yes 8 0 R /Off 9 0 R >> >> >>',
      {
        dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 240 24] /Resources << /Font << /Helv 99 0 R >> >> >>',
        stream: '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Initial value) Tj ET EMC',
      },
      {
        dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 16 16] >>',
        stream: '0 g 1 w 0.5 0.5 15 15 re S 3 8 m 7 3 l 13 13 l S',
      },
      {
        dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 16 16] >>',
        stream: '0 g 1 w 0.5 0.5 15 15 re S',
      },
    ]),
  );
}

/**
 * A detached CMS (adbe.pkcs7.detached) signature over the file's ByteRange,
 * made with a throwaway self-signed certificate generated on the fly.
 */
export function signedPdf(): Uint8Array {
  const CONTENTS_HEX = 16384; // 8 KiB of signature space
  const placeholder = '/ByteRange [0 0000000000 0000000000 0000000000]';
  const pdf = buildPdf(
    withFont([
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R ${PAGE} /Contents 4 0 R /Annots [5 0 R] >>`,
      {
        dict: '<< >>',
        stream: textContent('PDFTools S1 signed page (throwaway test certificate)', 20),
      },
      '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0] /F 132 /P 3 0 R /V 6 0 R >>',
      `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ${placeholder} /Contents <${'0'.repeat(CONTENTS_HEX)}> /M (D:20260924000000Z) /Name (PDFTools S1 test signer) /Reason (M0-S1 spike) >>`,
    ]),
  );
  const text = Buffer.from(pdf).toString('latin1');
  const brAt = text.indexOf(placeholder);
  const lt = text.indexOf('/Contents <', brAt) + '/Contents '.length; // offset of '<'
  const gt = lt + 1 + CONTENTS_HEX + 1; // offset after '>'
  const pad = (n: number): string => String(n).padStart(10, '0');
  const br = `/ByteRange [0 ${pad(lt)} ${pad(gt)} ${pad(pdf.length - gt)}]`;
  const bytes = Buffer.from(pdf);
  bytes.write(br, brAt, 'latin1');
  const signedData = Buffer.concat([bytes.subarray(0, lt), bytes.subarray(gt)]);

  const dir = mkdtempSync(join(tmpdir(), 's1-sig-'));
  const run = (args: string[]): void => {
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  };
  run([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'key.pem',
    '-out',
    'cert.pem',
    '-days',
    '30',
    '-subj',
    '/CN=PDFTools S1 throwaway test signer',
  ]);
  writeFileSync(join(dir, 'data.bin'), signedData);
  run([
    'cms',
    '-sign',
    '-binary',
    '-md',
    'sha256',
    '-in',
    'data.bin',
    '-signer',
    'cert.pem',
    '-inkey',
    'key.pem',
    '-outform',
    'DER',
    '-out',
    'sig.der',
  ]);
  const der = readFileSync(join(dir, 'sig.der'));
  if (der.length * 2 > CONTENTS_HEX) throw new Error('signature too large');
  bytes.write(der.toString('hex').toUpperCase().padEnd(CONTENTS_HEX, '0'), lt + 1, 'latin1');
  writeFileSync(join(outDir, 'signer-cert.pem'), readFileSync(join(dir, 'cert.pem')));
  return new Uint8Array(bytes);
}

/** 32×32 RGBA (or RGB) PNG (self-made) for the image stamp. */
export function stampPng(alpha = true): Uint8Array {
  const w = 32;
  const h = 32;
  const bpp = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * bpp + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * bpp + 1) + 1 + x * bpp;
      const edge = x < 3 || y < 3 || x > w - 4 || y > h - 4;
      raw[o] = edge ? 200 : 255;
      raw[o + 1] = edge ? 30 : 240;
      raw[o + 2] = edge ? 30 : 240;
      if (alpha) raw[o + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer): number => {
    let c = 0xffffffff;
    for (const v of b) c = (crcTable[(c ^ v) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function qpdfEncrypt(input: string, output: string, bits: '256' | '128'): void {
  execFileSync('qpdf', [
    // RC4 is legacy but common in the wild; we must read and re-save it.
    ...(bits === '128' ? ['--allow-weak-crypto'] : []),
    '--encrypt',
    '',
    'owner-s1',
    bits,
    ...(bits === '128' ? ['--use-aes=n'] : []),
    '--print=none',
    '--modify=annotate',
    '--extract=n',
    '--',
    input,
    output,
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = (name: string, bytes: Uint8Array): void => {
    writeFileSync(join(outDir, name), bytes);
    console.log(`${name}: ${String(bytes.length)} bytes`);
  };
  write('plain.pdf', plainPdf());
  write('annotated.pdf', annotatedPdf());
  write('form.pdf', formPdf());
  write('orphan.pdf', orphanPdf());
  write('signed.pdf', signedPdf());
  write('stamp.png', stampPng());
  qpdfEncrypt(join(outDir, 'plain.pdf'), join(outDir, 'encrypted-aes256.pdf'), '256');
  qpdfEncrypt(join(outDir, 'plain.pdf'), join(outDir, 'encrypted-rc4-128.pdf'), '128');
  // Modern layout: objects in object streams + a cross-reference stream.
  execFileSync('qpdf', [
    '--object-streams=generate',
    join(outDir, 'annotated.pdf'),
    join(outDir, 'objstm.pdf'),
  ]);
  // Annotations forbidden: the app must refuse edits (CLAUDE.md rule 9).
  execFileSync('qpdf', [
    '--encrypt',
    '',
    'owner-s1',
    '256',
    '--modify=none',
    '--',
    join(outDir, 'plain.pdf'),
    join(outDir, 'encrypted-noannotate.pdf'),
  ]);
  console.log('objstm.pdf (object streams + xref stream), encrypted-noannotate.pdf (modify=none)');
  console.log(
    'encrypted-aes256.pdf, encrypted-rc4-128.pdf (owner password "owner-s1", print/extract denied, annotate allowed)',
  );
}
