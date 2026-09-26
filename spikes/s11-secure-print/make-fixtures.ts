// M2-02 spike fixtures (self-made, generated at run time, never committed —
// CLAUDE.md rule 13): a full AcroForm, XFA markers, print-flag annotations,
// and qpdf-encrypted variants (R2, R3, R4, R6) with user and owner passwords.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPdf, type PdfObject } from '../../e2e/fixtures/generate.ts';

const PAGE = '/MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /Helv 3 0 R >> >>';

const box = (w: number, h: number, body: string): PdfObject => ({
  dict: `<< /Type /XObject /Subtype /Form /BBox [0 0 ${String(w)} ${String(h)}] /Resources << /Font << /Helv 3 0 R >> >> >>`,
  stream: body,
});

/**
 * One page with every AcroForm field type §7.10 names: text (plus read-only and
 * required text), checkbox, a two-button radio group, a combo box and a list
 * box. `/Tabs /R`, and `/Annots` deliberately **not** in row order, so tab
 * order can be checked. Object numbers are fixed (see comments).
 */
export function fullFormPdf(): Uint8Array {
  const tx = (n: number, name: string, y: number, v: string, ff = 0) =>
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /TU (${name} field) /V (${v}) /Ff ${String(ff)} /DA (/Helv 12 Tf 0 g) /Rect [60 ${String(y)} 300 ${String(y + 24)}] /F 4 /P 4 0 R /AP << /N ${String(n)} 0 R >> >>`;
  const objs: PdfObject[] = [
    // 1 catalog, 2 pages, 3 font, 4 page, 5 content
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [8 0 R 6 0 R 7 0 R 9 0 R 10 0 R 13 0 R 14 0 R] /DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv 3 0 R >> >> >> >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Type /Page /Parent 2 0 R ${PAGE} /Contents 5 0 R /Tabs /R /Annots [9 0 R 8 0 R 6 0 R 7 0 R 11 0 R 12 0 R 14 0 R 10 0 R] >>`,
    { dict: '<< >>', stream: 'BT /F1 16 Tf 60 790 Td (PDFTools M2 form) Tj ET' },
    // 6 name (row 2), 7 readonly (row 3), 8 first (row 1), 9 required (row 4)
    tx(15, 'name', 700, 'Initial'),
    tx(16, 'readonly', 660, 'Fixed', 1),
    tx(17, 'first', 740, 'Top'),
    tx(18, 'required', 620, '', 2),
    // 10 checkbox; 11 and 12 radio buttons, kids of the field 13
    '<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /TU (Agree) /V /Off /AS /Off /Rect [60 580 76 596] /F 4 /P 4 0 R /MK << /CA (4) >> /AP << /N << /Yes 19 0 R /Off 20 0 R >> >> >>',
    '<< /Type /Annot /Subtype /Widget /Parent 13 0 R /AS /A /Rect [60 540 76 556] /F 4 /P 4 0 R /MK << /CA (l) >> /AP << /N << /A 19 0 R /Off 20 0 R >> >> >>',
    '<< /Type /Annot /Subtype /Widget /Parent 13 0 R /AS /Off /Rect [120 540 136 556] /F 4 /P 4 0 R /MK << /CA (l) >> /AP << /N << /B 19 0 R /Off 20 0 R >> >> >>',
    '<< /FT /Btn /Ff 49152 /T (choice) /TU (Choice) /V /A /Kids [11 0 R 12 0 R] >>',
    // 14 combo box (/Ff bit 18 = combo); 15–21 appearance streams
    '<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (size) /TU (Size) /Opt [(DN50) (DN80) (DN100)] /V (DN80) /DA (/Helv 12 Tf 0 g) /Rect [60 490 300 514] /F 4 /P 4 0 R /AP << /N 21 0 R >> >>',
    box(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Initial) Tj ET EMC'),
    box(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Fixed) Tj ET EMC'),
    box(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Top) Tj ET EMC'),
    box(240, 24, '/Tx BMC EMC'),
    box(16, 16, '0 g 1 w 0.5 0.5 15 15 re S 3 8 m 7 3 l 13 13 l S'),
    box(16, 16, '0 g 1 w 0.5 0.5 15 15 re S'),
    box(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (DN80) Tj ET EMC'),
  ];
  // 22 list box (added last so the numbers above stay fixed), in /Fields and /Annots.
  objs.push(
    '<< /Type /Annot /Subtype /Widget /FT /Ch /T (material) /TU (Material) /Opt [(Carbon steel) (Stainless) (Duplex)] /V (Stainless) /DA (/Helv 12 Tf 0 g) /Rect [60 400 300 470] /F 4 /P 4 0 R >>',
  );
  objs[0] = (objs[0] as string).replace('14 0 R]', '14 0 R 22 0 R]');
  objs[3] = (objs[3] as string).replace('10 0 R]', '10 0 R 22 0 R]');
  return buildPdf(objs);
}

/** The field names in reading (row) order, i.e. `/Tabs /R` order. */
export const ROW_ORDER = [
  'first',
  'name',
  'readonly',
  'required',
  'agree',
  'choice',
  'size',
  'material',
];

/** An AcroForm that also carries an XFA packet (hybrid, "XFA foreground"). */
export function xfaHybridPdf(full = false): Uint8Array {
  return buildPdf([
    `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /XFA 5 0 R >>${full ? ' /NeedsRendering true' : ''} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    { dict: '<< >>', stream: '' },
    {
      dict: '<< >>',
      stream:
        '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"/></xdp:xdp>',
    },
  ]);
}

/**
 * Two squares with appearance streams: one with the Print flag (/F 4), one
 * without (/F 0, "screen only"). A print render must drop the second.
 */
export function printFlagPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Annots [5 0 R 6 0 R] >>',
    { dict: '<< >>', stream: '' },
    '<< /Type /Annot /Subtype /Square /Rect [50 700 150 800] /F 4 /C [1 0 0] /AP << /N 7 0 R >> >>',
    '<< /Type /Annot /Subtype /Square /Rect [400 50 500 150] /F 0 /C [0 0 1] /AP << /N 7 0 R >> >>',
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] >>',
      stream: '0 g 0 0 100 100 re f',
    },
  ]);
}

export interface EncryptedVariant {
  name: string;
  /** qpdf arguments after `--encrypt user owner`. */
  args: string[];
  bytes: Uint8Array;
}

export const USER_PW = 'user-pw';
export const OWNER_PW = 'owner-pw';

/**
 * Encrypts `bytes` with qpdf: R2 (RC4-40), R3 (RC4-128), R4 (AES-128) and R6
 * (AES-256), each with a user and an owner password, with print, copy, modify,
 * annotate and form filling denied; plus an owner-password-only R6 variant.
 */
export function encryptedVariants(bytes: Uint8Array): EncryptedVariant[] {
  const dir = mkdtempSync(join(tmpdir(), 's11-'));
  const src = join(dir, 'in.pdf');
  writeFileSync(src, bytes);
  const deny128 = ['--print=none', '--modify=none', '--extract=n', '--annotate=n', '--form=n'];
  const specs: [string, string, string, string[]][] = [
    [
      'R2-rc4-40',
      USER_PW,
      OWNER_PW,
      ['40', '--print=n', '--modify=n', '--extract=n', '--annotate=n'],
    ],
    ['R3-rc4-128', USER_PW, OWNER_PW, ['128', '--use-aes=n', ...deny128]],
    ['R4-aes-128', USER_PW, OWNER_PW, ['128', '--use-aes=y', ...deny128]],
    ['R6-aes-256', USER_PW, OWNER_PW, ['256', ...deny128]],
    ['R6-owner-only', '', OWNER_PW, ['256', ...deny128]],
  ];
  return specs.map(([name, user, owner, args]) => {
    const out = join(dir, `${name}.pdf`);
    const r = spawnSync('qpdf', [
      '--allow-weak-crypto',
      '--encrypt',
      user,
      owner,
      ...args,
      '--',
      src,
      out,
    ]);
    if (r.status !== 0 && r.status !== 3) throw new Error(`qpdf ${name}: ${r.stderr.toString()}`);
    return { name, args, bytes: new Uint8Array(readFileSync(out)) };
  });
}
