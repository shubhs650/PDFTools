// M0-S2: read measurement annotations and scale viewports from any PDF (ours,
// Acrobat's, PDF-XChange's) into our model, and recompute their values.
//
// CLI (owner runs on files saved by the viewers):
//   node spikes/s2-measure/read-measure.ts <file.pdf> [--json]

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  PdfDocument,
  PdfRef,
  PdfString,
  isDict,
  nameOf,
  type PdfDict,
  type PdfValue,
} from './pdf-object.ts';
import {
  chooseScale,
  format,
  fromMeasureRL,
  measure,
  type Kind,
  type Pt,
  type Scale,
  type ScaleViewport,
} from './scale-math.ts';

export interface ReadViewport {
  name: string;
  bbox: [number, number, number, number] | null;
  scale: Scale | null;
  rawMeasure: unknown;
}

export interface ReadMeasurement {
  page: number;
  objnum: number;
  nm: string;
  subtype: string;
  it: string;
  points: Pt[];
  /** Scale from the annotation's own /Measure (what viewers display with). */
  ownScale: Scale | null;
  /** Our value from its own /Measure. */
  value: string;
  /** Our §7.4 choice from the page viewports, for comparison. */
  viewportChoice: string;
  /** What the author's viewer shows (/Contents), for comparison. */
  contents: string;
  hasAP: boolean;
  rawMeasure: unknown;
}

const inflate = (b: Uint8Array): Uint8Array => new Uint8Array(inflateSync(b));

/** Resolve a PDF value into plain JS (names/strings → text). */
export function toPlain(v: PdfValue | undefined, doc: PdfDocument, depth = 0): unknown {
  const r = doc.resolve(v);
  if (depth > 16 || r === undefined) return undefined;
  if (Array.isArray(r)) return r.map((x) => toPlain(x, doc, depth + 1));
  if (isDict(r)) return Object.fromEntries([...r].map(([k, x]) => [k, toPlain(x, doc, depth + 1)]));
  if (r instanceof PdfString) return r.text();
  return nameOf(r) ?? r;
}

const text = (v: PdfValue | undefined): string => (v instanceof PdfString ? v.text() : '');

function pointsOf(d: PdfDict): Pt[] {
  const sub = nameOf(d.get('Subtype'));
  const nums = ((sub === 'Line' ? d.get('L') : d.get('Vertices')) as number[] | undefined) ?? [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i] ?? 0, y: nums[i + 1] ?? 0 });
  return pts;
}

export function readMeasurements(bytes: Uint8Array): {
  encrypted: boolean;
  pages: { page: number; viewports: ReadViewport[] }[];
  measurements: ReadMeasurement[];
} {
  const doc = new PdfDocument(bytes, inflate);
  if (doc.encrypted) return { encrypted: true, pages: [], measurements: [] };
  const pages: { page: number; viewports: ReadViewport[] }[] = [];
  const measurements: ReadMeasurement[] = [];
  doc.pages().forEach((p, pageIndex) => {
    const vps: ReadViewport[] = (
      (doc.resolve(p.dict.get('VP')) as PdfValue[] | undefined) ?? []
    ).flatMap((v) => {
      const d = doc.resolve(v);
      if (!isDict(d)) return [];
      const m = doc.resolve(d.get('Measure'));
      const plain = isDict(m) ? toPlain(m, doc) : undefined;
      const bb = doc.resolve(d.get('BBox'));
      return [
        {
          name: text(d.get('Name')),
          bbox:
            Array.isArray(bb) && bb.length === 4 ? (bb as [number, number, number, number]) : null,
          scale: plain ? fromMeasureRL(plain) : null,
          rawMeasure: plain,
        },
      ];
    });
    pages.push({ page: pageIndex, viewports: vps });
    const usable: ScaleViewport[] = vps.flatMap((v) =>
      v.bbox && v.scale ? [{ name: v.name, bbox: v.bbox, scale: v.scale }] : [],
    );

    for (const ref of (doc.resolve(p.dict.get('Annots')) as PdfValue[] | undefined) ?? []) {
      const d = doc.resolve(ref);
      if (!isDict(d)) continue;
      const it = nameOf(d.get('IT')) ?? '';
      const m = doc.resolve(d.get('Measure'));
      if (!isDict(m) && !it.endsWith('Dimension')) continue;
      const sub = nameOf(d.get('Subtype')) ?? '';
      const plain = isDict(m) ? toPlain(m, doc) : undefined;
      const ownScale = plain ? fromMeasureRL(plain) : null;
      const pts = pointsOf(d);
      // Perimeter: PolyLine (open list) vs Polygon with /IT PolyLineDimension (closed).
      const kind: Kind = it === 'PolygonDimension' ? 'area' : 'distance';
      const pts2 = sub === 'Polygon' && kind === 'distance' && pts[0] ? [...pts, pts[0]] : pts;
      const c = chooseScale(pts2, usable, null);
      measurements.push({
        page: pageIndex,
        objnum: ref instanceof PdfRef ? ref.num : -1,
        nm: text(d.get('NM')),
        subtype: sub,
        it,
        points: pts2,
        ownScale,
        value: ownScale ? format(measure(kind, pts2, ownScale), ownScale, kind) : 'uncalibrated',
        viewportChoice:
          c.kind === 'viewport'
            ? c.viewport.name
            : c.kind === 'spanning'
              ? `spanning ${c.viewports.join(' + ')}`
              : c.kind,
        contents: text(d.get('Contents')),
        hasAP: d.has('AP'),
        rawMeasure: plain,
      });
    }
  });
  return { encrypted: false, pages, measurements };
}

if (process.argv[1]?.endsWith('read-measure.ts')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node spikes/s2-measure/read-measure.ts <file.pdf> [--json]');
    process.exit(2);
  }
  const r = readMeasurements(new Uint8Array(readFileSync(file)));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.encrypted) {
    console.log('Encrypted file: the S2 reader handles unencrypted files only (ADR-007).');
    console.log('For analysis only, make a decrypted copy first: qpdf --decrypt in.pdf copy.pdf');
  } else {
    for (const p of r.pages) {
      for (const v of p.viewports) {
        console.log(
          `page ${String(p.page + 1)} viewport "${v.name}" bbox=${JSON.stringify(v.bbox)} scale=${JSON.stringify(v.scale)}`,
        );
      }
    }
    for (const m of r.measurements) {
      console.log(
        `page ${String(m.page + 1)} obj ${String(m.objnum)} ${m.subtype}/${m.it}: ours=${m.value} viewer="${m.contents}" viewport=${m.viewportChoice} AP=${String(m.hasAP)}`,
      );
      if (!m.ownScale) console.log(`   raw /Measure: ${JSON.stringify(m.rawMeasure)}`);
    }
  }
}
