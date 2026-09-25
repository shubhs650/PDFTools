// M0-S2: append one incremental revision containing objects we serialize
// ourselves (patched annotation dicts, page /VP, new /Measure objects). Same
// xref form as the file's newest section; /Prev chained; Root/Info/ID kept
// (first /ID element permanent). Unencrypted files only (ADR-007).

import { PdfDocument, PdfName, serialize, type PdfValue } from './pdf-object.ts';

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export function appendRevision(
  bytes: Uint8Array,
  doc: PdfDocument,
  objects: Map<number, PdfValue>,
): Uint8Array {
  if (doc.encrypted)
    throw new Error('appendRevision: encrypted documents need string encryption (ADR-007)');
  if (objects.size === 0) return bytes;
  const tail = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 1024)));
  const prev = Number([...tail.matchAll(/startxref\s+(\d+)/g)].pop()?.[1] ?? NaN);
  if (!Number.isFinite(prev)) throw new Error('no startxref');
  const isTable = String.fromCharCode(...bytes.subarray(prev, prev + 4)) === 'xref';

  const parts: Uint8Array[] = [bytes];
  let pos = bytes.length;
  const push = (b: Uint8Array): void => {
    parts.push(b);
    pos += b.length;
  };
  const last = bytes[bytes.length - 1];
  if (last !== 0x0a && last !== 0x0d) push(enc('\n'));

  const nums = [...objects.keys()].sort((a, b) => a - b);
  const offsets = new Map<number, number>();
  for (const n of nums) {
    offsets.set(n, pos);
    push(enc(`${String(n)} 0 obj\n${serialize(objects.get(n) ?? null)}\nendobj\n`));
  }

  const t = doc.trailer;
  let size = Math.max(doc.maxObjNum(), (nums[nums.length - 1] ?? 0) + 1);
  const id = t.get('ID');
  const common = new Map<string, PdfValue>([['Root', t.get('Root') ?? null]]);
  if (t.has('Info')) common.set('Info', t.get('Info') ?? null);
  if (Array.isArray(id)) common.set('ID', id);
  common.set('Prev', prev);

  const groups = (xs: number[]): [number, number][] => {
    const g: [number, number][] = [];
    for (const n of xs) {
      const lastG = g[g.length - 1];
      if (lastG && lastG[0] + lastG[1] === n) lastG[1]++;
      else g.push([n, 1]);
    }
    return g;
  };

  const xrefAt = pos;
  if (isTable) {
    let x = 'xref\n';
    for (const [first, n] of groups(nums)) {
      x += `${String(first)} ${String(n)}\n`;
      for (let k = first; k < first + n; k++)
        x += `${String(offsets.get(k) ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = new Map<string, PdfValue>([['Size', size], ...common]);
    push(enc(`${x}trailer\n${serialize(trailer)}\nstartxref\n${String(xrefAt)}\n%%EOF\n`));
  } else {
    const self = size;
    size = self + 1;
    offsets.set(self, xrefAt);
    const all = [...nums, self];
    const data = new Uint8Array(all.length * 7);
    all.forEach((n, i) => {
      const off = offsets.get(n) ?? 0;
      data.set(
        [1, (off >>> 24) & 255, (off >>> 16) & 255, (off >>> 8) & 255, off & 255, 0, 0],
        i * 7,
      );
    });
    const dict = new Map<string, PdfValue>([
      ['Type', new PdfName('XRef')],
      ['Size', size],
      ['W', [1, 4, 2]],
      ['Index', groups(all).flat()],
      ...common,
      ['Length', data.length],
    ]);
    push(enc(`${String(self)} 0 obj\n${serialize(dict)}\nstream\n`));
    push(data);
    push(enc(`\nendstream\nendobj\nstartxref\n${String(xrefAt)}\n%%EOF\n`));
  }
  const out = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
