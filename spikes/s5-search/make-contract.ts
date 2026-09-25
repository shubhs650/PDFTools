// Self-made ~2,000-page "contract profile" stand-in for S5 (CLAUDE.md rule 13).
// The FAR itself can't be fetched from the cloud container (network policy);
// the owner runs the same scenario on the real FAR. Deterministic text with
// FAR-like clause numbers, plus known needles for correctness checks:
//   "PDFTOOLS-NEEDLE" on pages (0-based) 6, 999 and 1998 only;
//   "Contractor" appears on every page.
//
// Usage: node spikes/s5-search/make-contract.ts [pages=2000]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { buildPdf } from '../shared/mini-pdf.ts';

export const NEEDLE = 'PDFTOOLS-NEEDLE';
export const NEEDLE_PAGES = [6, 999, 1998];

const WORDS = (
  'the contractor shall provide all labor materials equipment and services necessary ' +
  'to perform the work in accordance with the terms and conditions of this contract ' +
  'including any modifications issued by the contracting officer pursuant to clause ' +
  'government may terminate for convenience subject to equitable adjustment payment ' +
  'invoice acceptance inspection warranty delivery schedule subcontract flowdown ' +
  'records audit examination disputes changes notice written determination period ' +
  'offeror solicitation evaluation factors price technical past performance small business'
).split(' ');

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);

function pageContent(i: number, rand: () => number): string {
  const lines: string[] = [];
  const part = 1 + Math.floor(i / 40);
  lines.push(
    `52.${String(200 + (i % 90))}-${String(1 + (i % 9))} Clause ${String(i + 1)}. Contractor obligations (Part ${String(part)})`,
  );
  for (let l = 0; l < 52; l++) {
    let line = '';
    while (line.length < 88) line += `${WORDS[Math.floor(rand() * WORDS.length)] ?? ''} `;
    if (l === 20 && NEEDLE_PAGES.includes(i)) line = `See ${NEEDLE} reference ${String(i)} ${line}`;
    lines.push(line.trim());
  }
  const out = ['BT /F1 13 Tf 50 800 Td'];
  lines.forEach((t, n) => out.push(`${n === 0 ? '' : '0 -14.5 Td '}(${esc(t)}) Tj`));
  out.push('ET');
  return out.join('\n');
}

export function contractPdf(pages = 2000): Uint8Array {
  const rand = rng(42);
  const fontNum = 3 + pages * 2;
  const objs: (string | { dict: string; stream: string })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  ];
  for (let i = 0; i < pages; i++) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${String(fontNum)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
    );
    const z = deflateSync(Buffer.from(pageContent(i, rand), 'latin1'));
    objs.push({ dict: '<< /Filter /FlateDecode >>', stream: z.toString('latin1') });
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  return buildPdf(objs);
}

if (process.argv[1]?.endsWith('make-contract.ts')) {
  const pages = Number(process.argv[2] ?? 2000);
  const outDir = join(import.meta.dirname, 'out');
  mkdirSync(outDir, { recursive: true });
  const bytes = contractPdf(pages);
  writeFileSync(join(outDir, `contract-${String(pages)}.pdf`), bytes);
  console.log(
    `contract-${String(pages)}.pdf: ${String(bytes.length)} bytes, ${String(pages)} pages`,
  );
}
