// CSV for the CRS (M3-19, §7.5, ADR-015 decision 4): UTF-8 with a BOM (Excel
// opens it as UTF-8), CRLF, RFC 4180 quoting, and a formula-injection guard —
// a cell starting with =, +, -, @, tab or CR gets a leading apostrophe, so a
// comment can never run as a formula in a spreadsheet. No images. Pure.

const RISKY = /^[=+\-@\t\r]/u;
const BOM = String.fromCharCode(0xfeff);

export function csvCell(value: string): string {
  const v = RISKY.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(v) ? `"${v.replace(/"/gu, '""')}"` : v;
}

/** Lines of cells → the file's bytes (BOM + CRLF). */
export function toCsv(lines: readonly (readonly string[])[]): Uint8Array<ArrayBuffer> {
  const text = lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return new TextEncoder().encode(BOM + text);
}
