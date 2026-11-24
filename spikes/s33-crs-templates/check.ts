// Spike S33 (M13-06): structural checks on a written workbook for the things
// that make Excel offer to "repair" a file: overlapping merged cells,
// overlapping drop-down ranges, bad or duplicate sheet names, names pointing
// at missing sheets, parts without a content type, relationships to missing
// parts, picture anchors upside down. Excel itself is the owner's check; this
// catches the known causes before a file reaches him.
import { strFromU8, unzipSync } from 'fflate';
import { parseCell } from './a1';

export interface Problem {
  part: string;
  what: string;
}

interface Box {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

function box(ref: string): Box {
  const [a = ref, b = a] = ref.split(':');
  const p = parseCell(a);
  const q = parseCell(b);
  return { r1: p.row, c1: p.col, r2: q.row, c2: q.col };
}

const overlap = (x: Box, y: Box) => x.r1 <= y.r2 && y.r1 <= x.r2 && x.c1 <= y.c2 && y.c1 <= x.c2;

const attrs = (xml: string, tag: string, attr: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'gu'))].map((m) => m[1] ?? '');

export function checkWorkbook(bytes: Uint8Array): Problem[] {
  const files = unzipSync(bytes);
  const out: Problem[] = [];
  const text = (n: string) => strFromU8(files[n] ?? new Uint8Array());

  // Content types.
  const types = text('[Content_Types].xml');
  const defaults = new Set(attrs(types, 'Default', 'Extension').map((e) => e.toLowerCase()));
  const overrides = new Set(attrs(types, 'Override', 'PartName'));
  for (const name of Object.keys(files)) {
    if (name.endsWith('/') || name === '[Content_Types].xml') continue;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (!overrides.has(`/${name}`) && !defaults.has(ext))
      out.push({ part: name, what: 'no content type' });
  }

  // Relationships point at parts that exist.
  for (const name of Object.keys(files)) {
    if (!name.endsWith('.rels')) continue;
    const base = name.replace(/_rels\/[^/]*\.rels$/u, '');
    const xml = text(name);
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/gu)) {
      const tag = m[0];
      if (tag.includes('TargetMode="External"')) continue;
      const target = /Target="([^"]+)"/u.exec(tag)?.[1] ?? '';
      const path = target.startsWith('/') ? target.slice(1) : normalise(base + target);
      if (!files[path]) out.push({ part: name, what: `missing target ${target}` });
    }
  }

  // Sheets and names.
  const wb = text('xl/workbook.xml');
  const sheets = attrs(wb, 'sheet', 'name').map(unescape);
  const seen = new Set<string>();
  for (const s of sheets) {
    if (s.length < 1 || s.length > 31)
      out.push({ part: 'workbook', what: `sheet name length: ${s}` });
    if (/[:\\/?*[\]]/u.test(s) || /^'|'$/u.test(s))
      out.push({ part: 'workbook', what: `sheet name characters: ${s}` });
    if (seen.has(s.toLowerCase()))
      out.push({ part: 'workbook', what: `duplicate sheet name: ${s}` });
    seen.add(s.toLowerCase());
  }
  const lower = new Set(sheets.map((s) => s.toLowerCase()));
  const nameKeys = new Set<string>();
  for (const m of wb.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/gu)) {
    const a = m[1] ?? '';
    const body = unescape(m[2] ?? '');
    const name = /name="([^"]+)"/u.exec(a)?.[1] ?? '';
    const local = /localSheetId="(\d+)"/u.exec(a)?.[1];
    if (local !== undefined && Number(local) >= sheets.length)
      out.push({ part: 'workbook', what: `name ${name}: localSheetId ${local}` });
    const key = `${name.toLowerCase()}@${local ?? '-'}`;
    if (nameKeys.has(key)) out.push({ part: 'workbook', what: `duplicate name ${name}` });
    nameKeys.add(key);
    for (const ref of body.matchAll(/('(?:[^']|'')+'|[A-Za-z_][\w.]*)!/gu)) {
      const raw = ref[1] ?? '';
      const s = (raw.startsWith("'") ? raw.slice(1, -1).replace(/''/gu, "'") : raw).toLowerCase();
      if (!lower.has(s))
        out.push({ part: 'workbook', what: `name ${name} points at missing sheet ${raw}` });
    }
  }

  // Each worksheet: merges and drop-down ranges do not overlap.
  for (const name of Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(n))) {
    const xml = text(name);
    const merges = attrs(xml, 'mergeCell', 'ref').map(box);
    for (let i = 0; i < merges.length; i++) {
      for (let j = i + 1; j < merges.length; j++) {
        const x = merges[i];
        const y = merges[j];
        if (x && y && overlap(x, y)) out.push({ part: name, what: 'overlapping merged cells' });
      }
    }
    const dvs = attrs(xml, 'dataValidation', 'sqref').map((s) => s.split(/\s+/u).map(box));
    for (let i = 0; i < dvs.length; i++) {
      for (let j = i + 1; j < dvs.length; j++) {
        if (dvs[i]?.some((x) => dvs[j]?.some((y) => overlap(x, y)))) {
          out.push({ part: name, what: 'overlapping drop-down ranges' });
        }
      }
    }
    // Rows must be in increasing order, cells in a row too.
    let lastRow = 0;
    for (const r of attrs(xml, 'row', 'r').map(Number)) {
      if (r <= lastRow) out.push({ part: name, what: `row ${String(r)} out of order` });
      lastRow = r;
    }
  }

  // Picture anchors.
  for (const name of Object.keys(files).filter((n) => /^xl\/drawings\/drawing\d+\.xml$/u.test(n))) {
    const xml = text(name);
    for (const a of xml.matchAll(/<xdr:twoCellAnchor[\s\S]*?<\/xdr:twoCellAnchor>/gu)) {
      const rows = [...a[0].matchAll(/<xdr:row>(\d+)<\/xdr:row>/gu)].map((m) => Number(m[1]));
      if (rows.length === 2 && (rows[0] ?? 0) > (rows[1] ?? 0))
        out.push({ part: name, what: 'anchor upside down' });
    }
  }
  return out;
}

function normalise(path: string): string {
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.' && p !== '') parts.push(p);
  }
  return parts.join('/');
}

const unescape = (s: string) =>
  s
    .replace(/&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');

/** Counts of parts and features in a workbook's zip, for the survival table. */
export function inventory(bytes: Uint8Array): Record<string, number> {
  const files = unzipSync(bytes);
  const all = Object.keys(files)
    .filter((n) => n.endsWith('.xml') && /^xl\/(worksheets|drawings)\//u.test(n))
    .map((n) => strFromU8(files[n] ?? new Uint8Array()))
    .join('\n');
  const wb = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
  const count = (re: RegExp, s = all) => [...s.matchAll(re)].length;
  return {
    sheets: count(/<sheet\b/gu, wb),
    hiddenSheets: count(/<sheet\b[^>]*state="(hidden|veryHidden)"/gu, wb),
    definedNames: count(/<definedName\b/gu, wb),
    mergeCells: count(/<mergeCell\b/gu),
    dataValidations: count(/<dataValidation\b/gu),
    x14DataValidations: count(/<x14:dataValidation\b/gu),
    conditionalFormatting: count(/<conditionalFormatting\b/gu),
    x14ConditionalFormatting: count(/<x14:conditionalFormatting\b/gu),
    pictures: count(/<xdr:pic>/gu),
    shapes: count(/<xdr:sp\b/gu),
    charts: Object.keys(files).filter((n) => /^xl\/charts\/chart\d+\.xml$/u.test(n)).length,
    comments: Object.keys(files).filter((n) => /^xl\/comments\d*\.xml$/u.test(n)).length,
    threadedComments: Object.keys(files).filter((n) => n.startsWith('xl/threadedComments/')).length,
    tables: Object.keys(files).filter((n) => /^xl\/tables\/table\d+\.xml$/u.test(n)).length,
    pivotTables: Object.keys(files).filter((n) => n.startsWith('xl/pivotTables/')).length,
    externalLinks: Object.keys(files).filter((n) => n.startsWith('xl/externalLinks/')).length,
    vba: files['xl/vbaProject.bin'] ? 1 : 0,
    hyperlinks: count(/<hyperlink\b/gu),
    sheetProtection: count(/<sheetProtection\b/gu),
    workbookProtection: count(/<workbookProtection\b/gu, wb),
    frozenPanes: count(/<pane\b[^>]*state="frozen"/gu),
    headerFooter: count(/<(oddHeader|oddFooter)>[^<]/gu),
    printOptions: count(/<pageSetup\b/gu),
    rowBreaks: count(/<rowBreaks\b/gu),
    colsWithWidth: count(/<col\b[^>]*customWidth="1"/gu),
    customHeights: count(/<row\b[^>]*customHeight="1"/gu),
    sparklines: count(/<x14:sparklineGroup\b/gu),
    themeParts: Object.keys(files).filter((n) => /^xl\/theme\/[^/]+\.xml$/u.test(n)).length,
    namedCellStyles: count(/<cellStyle\b/gu, strFromU8(files['xl/styles.xml'] ?? new Uint8Array())),
    headerFooterPictures: Object.keys(files).filter(
      (n) => n.includes('vmlDrawing') && all.includes('legacyDrawingHF'),
    ).length,
    outlineRows: count(/<row\b[^>]*outlineLevel="[1-9]"/gu),
    formControls: Object.keys(files).filter((n) => n.startsWith('xl/ctrlProps/')).length,
    customXml: Object.keys(files).filter((n) => n.startsWith('customXml/')).length,
  };
}
