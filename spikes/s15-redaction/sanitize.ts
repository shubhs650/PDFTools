// M4-02 spike (ADR-017): document-level sanitize after the redactions are
// applied (§7.9 step 3). PDFium has no API to edit the catalog, the trailer or
// page keys like /Thumb, so our object layer writes one incremental section
// over PDFium's full rewrite (pass 1); PDFium then rewrites that again (pass 2)
// and drops every object nothing references any more. The result is a single
// revision without the removed data.
import {
  isDict,
  nameOf,
  PdfRef,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import { PdfReader } from '../../src/model/pdf/reader.ts';
import { concatBytes } from '../../src/workers/render/save/bytes.ts';
import type { Rect } from './verify.ts';

export interface SanitizeReport {
  removed: string[];
  outlineItemsRemoved: number;
  fieldsRemoved: number;
  patchedObjects: number;
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

const inRect = (x: number, y: number, rects: readonly Rect[]) =>
  rects.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);

/**
 * @param pass1 PDFium's full rewrite after apply
 * @param rectsByPageObj redacted rectangles, keyed by page object number
 * @param removedWidgets object numbers of widgets removed from pages (their fields go too)
 */
export async function sanitize(
  pass1: Uint8Array,
  rectsByPageObj: ReadonlyMap<number, Rect[]>,
  removedWidgets: ReadonlySet<number>,
  password?: string,
): Promise<{ bytes: Uint8Array; report: SanitizeReport }> {
  const r = await PdfReader.open(pass1, undefined, password ? { password } : {});
  const report: SanitizeReport = {
    removed: [],
    outlineItemsRemoved: 0,
    fieldsRemoved: 0,
    patchedObjects: 0,
  };
  const out = new Map<number, PdfValue>();
  const rootRef = r.trailer.get('Root');
  if (!(rootRef instanceof PdfRef)) throw new Error('catalog is not indirect');
  const catalog = new Map((await r.get(rootRef)) as PdfDict);

  for (const k of CATALOG_DROP) if (catalog.delete(k)) report.removed.push(`catalog /${k}`);
  const openAction = await r.resolve(catalog.get('OpenAction'));
  if (isDict(openAction) && nameOf(openAction.get('S')) === 'JavaScript') {
    catalog.delete('OpenAction');
    report.removed.push('catalog /OpenAction (JavaScript)');
  }
  // /Names: drop JavaScript and EmbeddedFiles, keep Dests.
  const namesV = catalog.get('Names');
  const names = await r.resolve(namesV);
  if (isDict(names)) {
    const copy = new Map(names);
    for (const k of NAMES_DROP) if (copy.delete(k)) report.removed.push(`names /${k}`);
    if (namesV instanceof PdfRef) out.set(namesV.num, copy);
    else catalog.set('Names', copy);
  }
  // /AcroForm /Fields: drop fields whose widgets were removed.
  const acroV = catalog.get('AcroForm');
  const acro = await r.resolve(acroV);
  if (isDict(acro)) {
    const fields = await r.resolve(acro.get('Fields'));
    if (Array.isArray(fields)) {
      const keep = fields.filter((f) => !(f instanceof PdfRef && removedWidgets.has(f.num)));
      report.fieldsRemoved = fields.length - keep.length;
      const copy = new Map(acro);
      copy.set('Fields', keep);
      if (acroV instanceof PdfRef) out.set(acroV.num, copy);
      else catalog.set('AcroForm', copy);
    }
  }
  // Outlines (top level): drop items whose destination point is in a redacted rectangle.
  const outlinesV = catalog.get('Outlines');
  const outlines = await r.resolve(outlinesV);
  if (isDict(outlines) && outlinesV instanceof PdfRef) {
    const items: { ref: PdfRef; dict: PdfDict }[] = [];
    let cur = outlines.get('First');
    let guard = 0;
    while (cur instanceof PdfRef && guard++ < 10_000) {
      const d = (await r.get(cur)) as PdfDict;
      items.push({ ref: cur, dict: d });
      cur = d.get('Next');
    }
    const kept: { ref: PdfRef; dict: PdfDict }[] = [];
    for (const it of items) {
      let dest = await r.resolve(it.dict.get('Dest'));
      const act = await r.resolve(it.dict.get('A'));
      if (!dest && isDict(act)) dest = await r.resolve(act.get('D'));
      const hit =
        Array.isArray(dest) &&
        dest[0] instanceof PdfRef &&
        nameOf(dest[1]) === 'XYZ' &&
        typeof dest[2] === 'number' &&
        typeof dest[3] === 'number' &&
        inRect(dest[2], dest[3], rectsByPageObj.get(dest[0].num) ?? []);
      if (hit) report.outlineItemsRemoved++;
      else kept.push(it);
    }
    if (report.outlineItemsRemoved > 0) {
      kept.forEach((it, i) => {
        const d = new Map(it.dict);
        const prev = kept[i - 1];
        const next = kept[i + 1];
        if (prev) d.set('Prev', prev.ref);
        else d.delete('Prev');
        if (next) d.set('Next', next.ref);
        else d.delete('Next');
        out.set(it.ref.num, d);
      });
      const o = new Map(outlines);
      const first = kept[0];
      const last = kept.at(-1);
      if (first && last) {
        o.set('First', first.ref);
        o.set('Last', last.ref);
        o.set('Count', kept.length);
      } else {
        o.delete('First');
        o.delete('Last');
        o.delete('Count');
      }
      out.set(outlinesV.num, o);
    }
  }
  out.set(rootRef.num, catalog);
  // Pages: thumbnails (the unredacted image), private data, structure links.
  for (const { num, dict } of await r.pages()) {
    const d = new Map(dict);
    let changed = false;
    for (const k of PAGE_DROP)
      if (d.delete(k)) {
        changed = true;
        report.removed.push(`page ${String(num)} /${k}`);
      }
    if (changed) out.set(num, d);
  }
  if (r.trailer.has('Info')) report.removed.push('trailer /Info');

  // One incremental section, classic xref, trailer without /Info.
  let body = '\n';
  const chunks: Uint8Array[] = [pass1];
  const offsets: [number, number][] = [];
  let at = pass1.length;
  const enc = new TextEncoder();
  const push = (b: Uint8Array) => {
    chunks.push(b);
    at += b.length;
  };
  push(enc.encode(body));
  body = '';
  for (const [num, value] of [...out.entries()].sort((a, b) => a[0] - b[0])) {
    const v = r.crypt ? r.crypt.mapStrings(value, num, 0, true) : value;
    offsets.push([num, at]);
    push(serializeIndirect(num, 0, v));
    push(enc.encode('\n'));
  }
  report.patchedObjects = offsets.length;
  const prev = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(
    new TextDecoder('latin1').decode(pass1.subarray(-64)),
  );
  const xrefAt = at;
  let xref = 'xref\n';
  offsets.sort((a, b) => a[0] - b[0]);
  for (const [num, off] of offsets)
    xref += `${String(num)} 1\n${String(off).padStart(10, '0')} 00000 n \n`;
  // PDFium keeps the previous trailer's /Info when the new trailer omits it, so
  // point /Info at a new empty dictionary instead; pass 2 drops the old one.
  const infoNum = r.maxObjNum() + 1;
  const emptyInfo = serializeIndirect(infoNum, 0, new Map());
  offsets.push([infoNum, at]);
  push(emptyInfo);
  push(enc.encode('\n'));
  const size = infoNum + 1;
  const encrypt = r.trailer.get('Encrypt');
  const id = r.trailer.get('ID');
  const extra =
    (encrypt instanceof PdfRef ? ` /Encrypt ${String(encrypt.num)} ${String(encrypt.gen)} R` : '') +
    (Array.isArray(id)
      ? ` /ID [${id.map((x) => `<${Buffer.from((x as { bytes: Uint8Array }).bytes).toString('hex')}>`).join(' ')}]`
      : '');
  xref += `trailer\n<< /Size ${String(size)} /Root ${String(rootRef.num)} ${String(rootRef.gen)} R /Info ${String(infoNum)} 0 R /Prev ${prev?.[1] ?? '0'}${extra} >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`;
  push(enc.encode(xref));
  return { bytes: concatBytes(chunks), report };
}
