// Spike S33 (M13-06): what kind of workbook a picked file is, from its bytes
// (never from the file name alone). Only .xlsx and .xltx are taken; the rest
// get a plain message (plan §6: .xlsm and .xls refused).
import { strFromU8, unzipSync } from 'fflate';

export type Kind =
  | 'xlsx'
  | 'xltx'
  /** Macro-enabled (.xlsm / .xltm): ExcelJS drops the macros; refused. */
  | 'macro'
  /** Binary workbook (.xlsb): ExcelJS cannot read it. */
  | 'binary'
  /**
   * An OLE2 compound file: an old .xls, OR an .xlsx saved with a password to
   * open (Excel wraps encrypted workbooks in OLE2). Both refused; the message
   * names both.
   */
  | 'ole'
  | 'not-a-workbook';

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function workbookKind(bytes: Uint8Array): Kind {
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
  const main =
    /PartName="\/xl\/workbook\.\w+"\s+ContentType="([^"]+)"/u.exec(types)?.[1] ??
    /ContentType="([^"]+)"\s+PartName="\/xl\/workbook\.\w+"/u.exec(types)?.[1];
  if (!main) return 'not-a-workbook';
  if (main.includes('macroEnabled')) return 'macro';
  if (main.includes('sheet.binary')) return 'binary';
  if (main.includes('template.main')) return 'xltx';
  if (main.includes('sheet.main')) return 'xlsx';
  return 'not-a-workbook';
}
