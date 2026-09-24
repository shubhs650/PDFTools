// Self-made S7 test sheet with known geometry (CLAUDE.md rule 13), plus a
// synthetic dense sheet for scaling measurements (not a stand-in for real
// P&IDs — those are the owner's local files, ADR-002).

import { deflateSync } from 'node:zlib';
import { buildPdf } from '../shared/mini-pdf.ts';

/** Expected stroked segments in user space (order-independent). */
export const EXPECTED: [number, number, number, number][] = [
  [100, 100, 300, 100],
  [100, 100, 100, 300],
  // rectangle via `re`
  [400, 400, 500, 400],
  [500, 400, 500, 450],
  [500, 450, 400, 450],
  [400, 450, 400, 400],
  // crossing diagonals → intersection (200, 200)
  [150, 150, 250, 250],
  [150, 250, 250, 150],
  // `q 2 0 0 2 10 20 cm  50 150 m 75 150 l S Q`
  [110, 320, 160, 320],
  // `q 0 1 -1 0 300 300 cm  0 0 m 50 0 l S Q` (90° rotation)
  [300, 300, 300, 350],
  // form Fm1 (0 0 → 30 0) at 350,500 and scaled 0.5 at 50,500
  [350, 500, 380, 500],
  [50, 500, 65, 500],
  // form Fm2 has /Matrix [2 0 0 1 0 0]; placed at 350,550
  [350, 550, 410, 550],
];
export const INTERSECTION: [number, number] = [200, 200];
export const CIRCLE = { cx: 450, cy: 150, r: 40 };
export const FILL_ONLY: [number, number, number, number][] = [
  [200, 450, 250, 450],
  [250, 450, 225, 500],
  [225, 500, 200, 450],
];

export function testSheet(): Uint8Array {
  const k = 0.5522847498 * CIRCLE.r;
  const { cx, cy, r } = CIRCLE;
  const circle = [
    `${String(cx + r)} ${String(cy)} m`,
    `${String(cx + r)} ${String(cy + k)} ${String(cx + k)} ${String(cy + r)} ${String(cx)} ${String(cy + r)} c`,
    `${String(cx - k)} ${String(cy + r)} ${String(cx - r)} ${String(cy + k)} ${String(cx - r)} ${String(cy)} c`,
    `${String(cx - r)} ${String(cy - k)} ${String(cx - k)} ${String(cy - r)} ${String(cx)} ${String(cy - r)} c`,
    `${String(cx + k)} ${String(cy - r)} ${String(cx + r)} ${String(cy - k)} ${String(cx + r)} ${String(cy)} c S`,
  ].join(' ');
  const content = [
    '1 w 0 G',
    '100 100 m 300 100 l S',
    '100 100 m 100 300 l S',
    '400 400 100 50 re S',
    '150 150 m 250 250 l S 150 250 m 250 150 l S',
    'q 2 0 0 2 10 20 cm 50 150 m 75 150 l S Q',
    'q 0 1 -1 0 300 300 cm 0 0 m 50 0 l S Q',
    circle,
    'q 1 0 0 1 350 500 cm /Fm1 Do Q',
    'q 0.5 0 0 0.5 50 500 cm /Fm1 Do Q',
    'q 1 0 0 1 350 550 cm /Fm2 Do Q',
    '0.5 g 200 450 m 250 450 l 225 500 l f',
    'BT /F1 10 Tf 20 580 Td (PDFTools M0-S7 snap test sheet - self-made) Tj ET',
  ].join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 600] /Resources << /XObject << /Fm1 5 0 R /Fm2 6 0 R >> /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: content },
    { dict: '<< /Type /XObject /Subtype /Form /BBox [-1 -1 31 1] >>', stream: '0 0 m 30 0 l S' },
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [-1 -1 31 1] /Matrix [2 0 0 1 0 0] >>',
      stream: '0 0 m 30 0 l S',
    },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/**
 * Synthetic dense A0 sheet: `n` short stroked segments, grouped into path
 * objects of `perPath` segments clustered around a point (like CAD entities),
 * so region extraction can skip objects by their bounds.
 */
export function denseSheet(n: number, perPath = 50): Uint8Array {
  const W = 3370;
  const H = 2384;
  const lines: string[] = ['0.2 w 0 G'];
  let rng = 7;
  const rand = (): number => {
    rng = (rng * 1103515245 + 12345) >>> 0;
    return rng / 2 ** 32;
  };
  let path: string[] = [];
  let ox = 0;
  let oy = 0;
  for (let i = 0; i < n; i++) {
    if (path.length === 0) {
      ox = 60 + rand() * (W - 180);
      oy = 60 + rand() * (H - 180);
    }
    const x = ox + rand() * 60;
    const y = oy + rand() * 60;
    const a = rand() < 0.5 ? 0 : (Math.PI / 2) * (rand() < 0.5 ? 1 : 0.5);
    const len = 4 + rand() * 30;
    path.push(
      `${x.toFixed(2)} ${y.toFixed(2)} m ${(x + Math.cos(a) * len).toFixed(2)} ${(y + Math.sin(a) * len).toFixed(2)} l`,
    );
    if (path.length === perPath) {
      lines.push(`${path.join(' ')} S`);
      path = [];
    }
  }
  if (path.length) lines.push(`${path.join(' ')} S`);
  const z = deflateSync(Buffer.from(lines.join('\n'), 'latin1'));
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(W)} ${String(H)}] /Contents 4 0 R >>`,
    { dict: '<< /Filter /FlateDecode >>', stream: z.toString('latin1') },
  ]);
}
