// What a picked CRS template file is and what ExcelJS would lose from it
// (M13-07, D-71, ADR-034 Amendment 1 items 1 – 2). The kind comes from the
// file's bytes, never its name: only .xlsx and .xltx are taken; macro-enabled
// and binary workbooks and OLE2 files (old .xls, or a workbook with a password
// to open) are refused. The lost parts are found from the zip's part list and
// named in the import's warning. Runs in the Work worker.
import { strFromU8, unzipSync } from 'fflate';

export type WorkbookFileKind =
  | 'xlsx'
  | 'xltx'
  /** Macro-enabled (.xlsm / .xltm): ExcelJS drops the macros; refused. */
  | 'macro'
  /** Binary workbook (.xlsb): ExcelJS cannot read it. */
  | 'binary'
  /** An OLE2 compound file: an old .xls, or an .xlsx with a password to open. */
  | 'ole'
  | 'not-a-workbook';

/** Parts a load and write cannot keep (S33), in the order the warning names them. */
export const LOST_PARTS = [
  'shapes',
  'charts',
  'sparklines',
  'dropDowns2010',
  'cellStyles',
  'pivotTables',
  'slicers',
  'threadedComments',
  'formControls',
  'headerPictures',
  'externalLinks',
] as const;
export type LostPart = (typeof LOST_PARTS)[number];

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function mainContentType(types: string): string | undefined {
  return (
    /PartName="\/xl\/workbook\.\w+"\s+ContentType="([^"]+)"/u.exec(types)?.[1] ??
    /ContentType="([^"]+)"\s+PartName="\/xl\/workbook\.\w+"/u.exec(types)?.[1]
  );
}

export function workbookKind(bytes: Uint8Array): WorkbookFileKind {
  if (OLE.every((b, i) => bytes[i] === b)) return 'ole';
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return 'not-a-workbook';
  let types: string;
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === '[Content_Types].xml' });
    const t = files['[Content_Types].xml'];
    if (!t) return 'not-a-workbook';
    types = strFromU8(t);
  } catch {
    return 'not-a-workbook';
  }
  const main = mainContentType(types);
  if (!main) return 'not-a-workbook';
  if (main.includes('macroEnabled')) return 'macro';
  if (main.includes('sheet.binary')) return 'binary';
  if (main.includes('template.main')) return 'xltx';
  if (main.includes('sheet.main')) return 'xlsx';
  return 'not-a-workbook';
}

/** The parts of an .xlsx / .xltx that a load and write would lose. */
export function lostParts(bytes: Uint8Array): LostPart[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return [];
  }
  const names = Object.keys(files);
  const has = (re: RegExp) => names.some((n) => re.test(n));
  const anyText = (re: RegExp, test: RegExp) =>
    names.some((n) => {
      const f = files[n];
      return re.test(n) && f !== undefined && test.test(strFromU8(f));
    });
  const found = new Set<LostPart>();
  if (anyText(/^xl\/drawings\/drawing\d+\.xml$/u, /<xdr:(?:sp|cxnSp|grpSp)\b/u))
    found.add('shapes');
  if (has(/^xl\/charts\//u)) found.add('charts');
  const sheets = /^xl\/worksheets\/sheet\d+\.xml$/u;
  if (anyText(sheets, /<x14:sparklineGroups\b/u)) found.add('sparklines');
  if (anyText(sheets, /<x14:dataValidations\b/u)) found.add('dropDowns2010');
  if (anyText(/^xl\/styles\.xml$/u, /<cellStyle\b(?![^>]*\bbuiltinId=)/u)) found.add('cellStyles');
  if (has(/^xl\/pivotTables\//u) || has(/^xl\/pivotCache\//u)) found.add('pivotTables');
  if (has(/^xl\/slicers\//u) || has(/^xl\/slicerCaches\//u)) found.add('slicers');
  if (has(/^xl\/threadedComments\//u)) found.add('threadedComments');
  if (has(/^xl\/ctrlProps\//u)) found.add('formControls');
  if (anyText(sheets, /<legacyDrawingHF\b/u)) found.add('headerPictures');
  if (has(/^xl\/externalLinks\//u)) found.add('externalLinks');
  return LOST_PARTS.filter((p) => found.has(p));
}
