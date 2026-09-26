// M2-01 spike fixtures (self-made, generated at run time, never committed —
// CLAUDE.md rule 13). Outline + links, attachments, optional-content layers.
import { deflateSync } from 'node:zlib';
import { buildPdf, type PdfObject } from '../../e2e/fixtures/generate.ts';

/**
 * `pages` pages; an outline of `top` × `mid` × `leaf` entries (3 levels) with
 * /XYZ and /Fit destinations; page 1 has a GoTo link, a named-destination link
 * and a URI link.
 */
export function outlinePdf(pages = 50, top = 10, mid = 7, leaf = 6): Uint8Array {
  // Layout: 1 catalog, 2 pages, 3..(3+2p-1) page+content, font, then outline.
  const objs: PdfObject[] = ['', ''];
  const pageNum = (i: number) => 3 + i * 2;
  const font = 3 + pages * 2;
  for (let i = 0; i < pages; i++) {
    const links =
      i === 0
        ? ` /Annots [${String(font + 1)} 0 R ${String(font + 2)} 0 R ${String(font + 3)} 0 R]`
        : '';
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(pageNum(i) + 1)} 0 R${links} >>`,
      {
        dict: '<< >>',
        stream: `BT /F1 24 Tf 72 760 Td (Page ${String(i + 1)}) Tj ET BT /F1 12 Tf 72 700 Td (Go to page 10) Tj ET BT /F1 12 Tf 72 680 Td (Named: chapter-3) Tj ET BT /F1 12 Tf 72 660 Td (Web link) Tj ET`,
      },
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs.push(
    `<< /Type /Annot /Subtype /Link /Rect [70 695 200 712] /Border [0 0 0] /Dest [${String(pageNum(9))} 0 R /XYZ 0 500 2] >>`,
  );
  objs.push(
    '<< /Type /Annot /Subtype /Link /Rect [70 675 200 692] /Border [0 0 0] /A << /S /GoTo /D (chapter-3) >> >>',
  );
  objs.push(
    '<< /Type /Annot /Subtype /Link /Rect [70 655 200 672] /Border [0 0 0] /A << /S /URI /URI (https://example.org/spec) >> >>',
  );
  // Named destinations: /Names /Dests name tree with one entry.
  const namesNum = objs.length + 1;
  objs.push(`<< /Dests << /Names [(chapter-3) [${String(pageNum(2))} 0 R /Fit]] >> >>`);
  // Outline items.
  const outlineRoot = objs.length + 1;
  objs.push(''); // placeholder for /Outlines
  interface Item {
    num: number;
    title: string;
    kids: Item[];
    dest: string;
  }
  let next = outlineRoot + 1;
  const build = (depth: number, counts: number[], prefix: string): Item[] => {
    const n = counts[depth] ?? 0;
    return Array.from({ length: n }, (_, k) => {
      const title = `${prefix}${String(k + 1)}`;
      const num = next++;
      const page = (num * 7) % pages;
      const dest =
        k % 2
          ? `[${String(pageNum(page))} 0 R /Fit]`
          : `[${String(pageNum(page))} 0 R /XYZ 36 ${String(800 - k * 10)} 0]`;
      return {
        num,
        title,
        dest,
        kids: depth + 1 < counts.length ? build(depth + 1, counts, `${title}.`) : [],
      };
    });
  };
  const tree = build(0, [top, mid, leaf], 'Section ');
  const items: [number, string][] = [];
  const emit = (list: Item[], parent: number) => {
    list.forEach((it, i) => {
      const prev = list[i - 1];
      const nxt = list[i + 1];
      const kids = it.kids.length
        ? ` /First ${String(it.kids[0]?.num)} 0 R /Last ${String(it.kids.at(-1)?.num)} 0 R /Count ${String(-it.kids.length)}`
        : '';
      items.push([
        it.num,
        `<< /Title (${it.title}) /Parent ${String(parent)} 0 R${prev ? ` /Prev ${String(prev.num)} 0 R` : ''}${nxt ? ` /Next ${String(nxt.num)} 0 R` : ''}${kids} /Dest ${it.dest} >>`,
      ]);
      emit(it.kids, it.num);
    });
  };
  emit(tree, outlineRoot);
  items.sort((a, b) => a[0] - b[0]);
  for (const [, s] of items) objs.push(s);
  objs[outlineRoot - 1] =
    `<< /Type /Outlines /First ${String(tree[0]?.num)} 0 R /Last ${String(tree.at(-1)?.num)} 0 R /Count ${String(tree.length)} >>`;
  objs[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${String(outlineRoot)} 0 R /Names ${String(namesNum)} 0 R /PageMode /UseOutlines >>`;
  objs[1] = `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(pageNum(i))} 0 R`).join(' ')}] /Count ${String(pages)} >>`;
  return buildPdf(objs);
}

export const OUTLINE_ENTRIES = (top = 10, mid = 7, leaf = 6) => top + top * mid + top * mid * leaf;

/** Deterministic incompressible bytes. */
function noise(n: number, seed: number): Buffer {
  const b = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
}

/**
 * Document-level embedded files (`count` small text files, one of `bigMb` MB,
 * one embedded PDF) plus one FileAttachment annotation on page 1.
 */
export function attachmentsPdf(count = 20, bigMb = 20, innerPdf?: Uint8Array): Uint8Array {
  const objs: PdfObject[] = [
    '', // catalog
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [6 0 R] >>',
    { dict: '<< >>', stream: 'BT /F1 24 Tf 72 760 Td (Attachments) Tj ET' },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '', // 6: FileAttachment annot
  ];
  const addFile = (name: string, data: Buffer, desc: string): number => {
    const ef = objs.length + 1;
    const compressed = deflateSync(data, { level: 1 });
    objs.push({
      dict: `<< /Type /EmbeddedFile /Filter /FlateDecode /Params << /Size ${String(data.length)} /ModDate (D:20260926120000Z) >> >>`,
      stream: compressed.toString('latin1'),
    });
    objs.push(
      `<< /Type /Filespec /F (${name}) /UF (${name}) /Desc (${desc}) /EF << /F ${String(ef)} 0 R >> >>`,
    );
    return ef + 1;
  };
  const names: [string, number][] = [];
  for (let i = 0; i < count; i++) {
    const n = `note-${String(i + 1).padStart(2, '0')}.txt`;
    names.push([
      n,
      addFile(n, Buffer.from(`Attachment ${String(i + 1)}\n`.repeat(50)), `Note ${String(i + 1)}`),
    ]);
  }
  if (bigMb > 0)
    names.push(['big.bin', addFile('big.bin', noise(bigMb * 1024 * 1024, 3), 'Large binary')]);
  if (innerPdf)
    names.push(['inner.pdf', addFile('inner.pdf', Buffer.from(innerPdf), 'Embedded PDF')]);
  const annotFile = addFile(
    'on-page.txt',
    Buffer.from('File attached to an annotation\n'),
    'Annotation file',
  );
  objs[5] = `<< /Type /Annot /Subtype /FileAttachment /Rect [72 600 92 620] /FS ${String(annotFile)} 0 R /Contents (Annotation attachment) /Name /PushPin >>`;
  names.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  objs[0] = `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [${names.map(([n, num]) => `(${n}) ${String(num)} 0 R`).join(' ')}] >> >> >>`;
  return buildPdf(objs);
}

/**
 * One page with two optional-content groups: "Grid" (ON) draws a black block at
 * the top left, "Notes" (OFF in the default config) a black block at the
 * bottom right. Pixel sampling tells which ones PDFium drew.
 */
export function layersPdf(): Uint8Array {
  const content = [
    '/OC /oc1 BDC 0 g 50 700 100 100 re f EMC',
    '/OC /oc2 BDC 0 g 400 50 100 100 re f EMC',
  ].join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] /ON [5 0 R] /OFF [6 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Properties << /oc1 5 0 R /oc2 6 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: content },
    '<< /Type /OCG /Name (Grid) >>',
    '<< /Type /OCG /Name (Notes) >>',
  ]);
}
