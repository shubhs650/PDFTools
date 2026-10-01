// Sanitize after the redactions are applied (M4-17, §7.9 step 3, ADR-017
// decision 5): PDFium has no API for the catalog, the trailer or page keys
// such as /Thumb, so our object layer writes one incremental section over
// PDFium's full rewrite (pass 1) and PDFium rewrites that once more (pass 2),
// dropping every object nothing references any more. The result is a single
// revision without: document Info and XMP metadata, page thumbnails, the
// structure tree (/ActualText, /Alt), JavaScript, embedded files, private
// application data, form fields whose widgets were removed, and bookmarks
// whose destination lies in a redacted rectangle. Encryption is kept (M4-Q4).
import {
  isDict,
  nameOf,
  PdfRef,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../../model/pdf/objects';
import { PdfReader } from '../../../model/pdf/reader';
import { concatBytes } from '../../render/save/bytes';
import type { Rect } from './geometry';

export interface SanitizeReport {
  /** What was removed, as PDF key paths (no document content, rule 10). */
  removed: string[];
  outlineItemsRemoved: number;
  fieldsRemoved: number;
}

const CATALOG_DROP = [
  'Metadata',
  'StructTreeRoot',
  'MarkInfo',
  'PieceInfo',
  'AA',
  'Threads',
  'SpiderInfo',
];
const PAGE_DROP = ['Thumb', 'PieceInfo', 'Metadata', 'StructParents', 'AA', 'B'];
const NAMES_DROP = ['JavaScript', 'EmbeddedFiles'];

const within = (x: number, y: number, rects: readonly Rect[]) =>
  rects.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * @param pass1 PDFium's full rewrite after apply
 * @param rectsByPageObj redacted rectangles keyed by page object number
 * @param removedWidgets object numbers of the widgets removed from pages (their fields go too)
 */
export async function sanitize(
  pass1: Uint8Array,
  rectsByPageObj: ReadonlyMap<number, Rect[]>,
  removedWidgets: ReadonlySet<number>,
  password?: string,
): Promise<{ bytes: Uint8Array; report: SanitizeReport }> {
  const r = await PdfReader.open(pass1, undefined, password ? { password } : {});
  const report: SanitizeReport = { removed: [], outlineItemsRemoved: 0, fieldsRemoved: 0 };
  const out = new Map<number, PdfValue>();
  const rootRef = r.trailer.get('Root');
  if (!(rootRef instanceof PdfRef)) throw new Error('catalog is not indirect');
  const catalog = new Map((await r.get(rootRef)) as PdfDict);

  for (const k of CATALOG_DROP) if (catalog.delete(k)) report.removed.push(`/Root/${k}`);
  const openAction = await r.resolve(catalog.get('OpenAction'));
  if (isDict(openAction) && nameOf(openAction.get('S')) === 'JavaScript') {
    catalog.delete('OpenAction');
    report.removed.push('/Root/OpenAction');
  }
  // /Names: JavaScript and embedded files go; named destinations stay.
  const namesV = catalog.get('Names');
  const names = await r.resolve(namesV);
  if (isDict(names)) {
    const copy = new Map(names);
    for (const k of NAMES_DROP) if (copy.delete(k)) report.removed.push(`/Root/Names/${k}`);
    if (namesV instanceof PdfRef) out.set(namesV.num, copy);
    else catalog.set('Names', copy);
  }
  // /AcroForm /Fields: fields whose widgets were removed.
  const acroV = catalog.get('AcroForm');
  const acro = await r.resolve(acroV);
  if (isDict(acro)) {
    const fields = await r.resolve(acro.get('Fields'));
    if (Array.isArray(fields)) {
      const keep = fields.filter((f) => !(f instanceof PdfRef && removedWidgets.has(f.num)));
      report.fieldsRemoved = fields.length - keep.length;
      if (report.fieldsRemoved) {
        const copy = new Map(acro);
        copy.set('Fields', keep);
        if (acroV instanceof PdfRef) out.set(acroV.num, copy);
        else catalog.set('AcroForm', copy);
      }
    }
  }
  await pruneOutlines(r, catalog, rectsByPageObj, out, report);
  out.set(rootRef.num, catalog);
  // Pages: thumbnails (the unredacted picture), private data, structure links.
  for (const { num, dict } of await r.pages()) {
    const d = new Map(dict);
    let changed = false;
    for (const k of PAGE_DROP)
      if (d.delete(k)) {
        changed = true;
        report.removed.push(`/Page/${k}`);
      }
    if (changed) out.set(num, d);
  }
  if (r.trailer.has('Info')) report.removed.push('/Info');
  // PDFium keeps the previous trailer's /Info when the new trailer has none,
  // so /Info points at a new empty dictionary; pass 2 drops the old one.
  const infoNum = r.maxObjNum() + 1;
  out.set(infoNum, new Map());

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [pass1, enc.encode('\n')];
  let at = pass1.length + 1;
  const offsets: [number, number][] = [];
  for (const [num, value] of [...out.entries()].sort((a, b) => a[0] - b[0])) {
    const v = r.crypt ? r.crypt.mapStrings(value, num, 0, true) : value;
    offsets.push([num, at]);
    const b = serializeIndirect(num, 0, v);
    chunks.push(b, enc.encode('\n'));
    at += b.length + 1;
  }
  const prev = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(
    new TextDecoder('latin1').decode(pass1.subarray(-64)),
  );
  let xref = 'xref\n';
  for (const [num, off] of offsets)
    xref += `${String(num)} 1\n${String(off).padStart(10, '0')} 00000 n \n`;
  const encrypt = r.trailer.get('Encrypt');
  const id = r.trailer.get('ID');
  const extra =
    (encrypt instanceof PdfRef ? ` /Encrypt ${String(encrypt.num)} ${String(encrypt.gen)} R` : '') +
    (Array.isArray(id)
      ? ` /ID [${id.map((x) => `<${hex((x as { bytes: Uint8Array }).bytes)}>`).join(' ')}]`
      : '');
  xref += `trailer\n<< /Size ${String(infoNum + 1)} /Root ${String(rootRef.num)} ${String(rootRef.gen)} R /Info ${String(infoNum)} 0 R /Prev ${prev?.[1] ?? '0'}${extra} >>\nstartxref\n${String(at)}\n%%EOF\n`;
  chunks.push(enc.encode(xref));
  return { bytes: concatBytes(chunks), report };
}

/** Bookmarks (every level) whose destination point lies in a redacted rectangle are unlinked. */
async function pruneOutlines(
  r: PdfReader,
  catalog: PdfDict,
  rectsByPageObj: ReadonlyMap<number, Rect[]>,
  out: Map<number, PdfValue>,
  report: SanitizeReport,
): Promise<void> {
  const outlinesV = catalog.get('Outlines');
  const outlines = await r.resolve(outlinesV);
  if (!isDict(outlines) || !(outlinesV instanceof PdfRef)) return;
  const hits = async (d: PdfDict): Promise<boolean> => {
    let dest = await r.resolve(d.get('Dest'));
    const act = await r.resolve(d.get('A'));
    if (!dest && isDict(act)) dest = await r.resolve(act.get('D'));
    return (
      Array.isArray(dest) &&
      dest[0] instanceof PdfRef &&
      nameOf(dest[1]) === 'XYZ' &&
      typeof dest[2] === 'number' &&
      typeof dest[3] === 'number' &&
      within(dest[2], dest[3], rectsByPageObj.get(dest[0].num) ?? [])
    );
  };
  let guard = 0;
  // Returns the kept children of `parent` (relinked) and rewrites the parent's First/Last/Count.
  const walk = async (parentRef: PdfRef, parent: PdfDict): Promise<boolean> => {
    const items: { ref: PdfRef; dict: PdfDict }[] = [];
    let cur = parent.get('First');
    while (cur instanceof PdfRef && guard++ < 100_000) {
      const d = new Map((await r.get(cur)) as PdfDict);
      items.push({ ref: cur, dict: d });
      cur = d.get('Next');
    }
    let changed = false;
    const kept: { ref: PdfRef; dict: PdfDict }[] = [];
    for (const it of items) {
      if (await hits(it.dict)) {
        report.outlineItemsRemoved++;
        changed = true;
        continue;
      }
      if (await walk(it.ref, it.dict)) out.set(it.ref.num, it.dict);
      kept.push(it);
    }
    if (!changed) return out.has(parentRef.num);
    kept.forEach((it, i) => {
      const prev = kept[i - 1];
      const next = kept[i + 1];
      if (prev) it.dict.set('Prev', prev.ref);
      else it.dict.delete('Prev');
      if (next) it.dict.set('Next', next.ref);
      else it.dict.delete('Next');
      out.set(it.ref.num, it.dict);
    });
    const first = kept[0];
    const last = kept.at(-1);
    if (first && last) {
      parent.set('First', first.ref);
      parent.set('Last', last.ref);
      parent.set('Count', kept.length);
    } else {
      parent.delete('First');
      parent.delete('Last');
      parent.delete('Count');
    }
    return true;
  };
  const root = new Map(outlines);
  if (await walk(outlinesV, root)) out.set(outlinesV.num, root);
}
