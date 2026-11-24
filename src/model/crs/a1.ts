// CRS project templates (M13-07, D-71, ADR-034 Amendment 1): A1 references in
// formulas, print areas, merged cells, drop-downs and conditional formatting.
// From spike S33. Pure; three operations:
//
// - `shiftRows`: rows after `after` move down by `n` (an insert below the
//   table's last row). A range that reaches the table's last row from above or
//   at it GROWS with the table (r1 <= after <= r2), like Excel does when rows
//   are inserted inside a range; anything wholly below moves down.
// - `slideRows`: a formula copied from one row to another (relative row parts
//   move by the distance, `$` rows stay), like Excel's fill down.
// - `renameSheetRefs`: references to a renamed sheet follow it.
//
// The tokenizer skips string literals ("…", with "" inside), structured
// references ([…]) and function names that look like cells (LOG10( ).

export interface Shift {
  /** The sheet whose rows move. */
  sheet: string;
  /** The sheet the formula lives on (unqualified references belong to it). */
  home: string | null;
  /** Rows after this one move down. */
  after: number;
  n: number;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colLetters(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseCell(addr: string): { col: number; row: number } {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/u.exec(addr);
  if (!m) throw new Error(`not a cell address: ${addr}`);
  return { col: colNumber(m[1] ?? 'A'), row: Number(m[2]) };
}

export const cellName = (col: number, row: number): string => `${colLetters(col)}${String(row)}`;

/** Unquoted, case-folded sheet name of a reference prefix ("'My sheet'!" → "my sheet"). */
function sheetKey(prefix: string): string {
  const raw = prefix.slice(0, -1);
  const unq = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/gu, "'") : raw;
  return unq.toLowerCase();
}

// sheet prefix, then a cell or cell range, or a row range (5:9), or a column range (A:C).
const REF =
  /(?<![\w.$])((?:'(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!)?(?:(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?|(\$?)(\d+):(\$?)(\d+)|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3})(?![\w(.!])/uy;

type RowMap = (row: number, abs: boolean) => number;
type RangeMap = (r1: number, r2: number, a1: boolean, a2: boolean) => [number, number];

/**
 * Rewrites the row numbers of every reference in `formula` that `applies`
 * to. Text between quotes and inside brackets is left alone.
 */
function mapRefs(
  formula: string,
  applies: (sheet: string | null) => boolean,
  one: RowMap,
  range: RangeMap,
): string {
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      // string literal, "" escapes a quote
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') j += 2;
          else break;
        } else j++;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '[') {
      let depth = 0;
      let j = i;
      for (; j < formula.length; j++) {
        if (formula[j] === '[') depth++;
        else if (formula[j] === ']' && --depth === 0) break;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    REF.lastIndex = i;
    const m = REF.exec(formula);
    if (!m) {
      out += formula.charAt(i);
      i++;
      continue;
    }
    const [whole, prefix, ca1, c1, ra1, r1, ca2, c2, ra2, r2, ra3, r3, ra4, r4] = m;
    const sheet = prefix ? sheetKey(prefix) : null;
    const col1Ok = c1 === undefined || colNumber(c1) <= 16384;
    const col2Ok = c2 === undefined || colNumber(c2) <= 16384;
    if (!applies(sheet) || !col1Ok || !col2Ok || (r1 === undefined && r3 === undefined)) {
      out += whole;
      i += whole.length;
      continue;
    }
    const p = prefix ?? '';
    if (r1 !== undefined && c1 !== undefined) {
      if (r2 !== undefined && c2 !== undefined) {
        const [a, b] = range(Number(r1), Number(r2), ra1 === '$', ra2 === '$');
        out += `${p}${ca1 ?? ''}${c1}${ra1 ?? ''}${String(a)}:${ca2 ?? ''}${c2}${ra2 ?? ''}${String(b)}`;
      } else {
        out += `${p}${ca1 ?? ''}${c1}${ra1 ?? ''}${String(one(Number(r1), ra1 === '$'))}`;
      }
    } else {
      const [a, b] = range(Number(r3), Number(r4), ra3 === '$', ra4 === '$');
      out += `${p}${ra3 ?? ''}${String(a)}:${ra4 ?? ''}${String(b)}`;
    }
    i += whole.length;
  }
  return out;
}

const growRange =
  (s: Shift): RangeMap =>
  (r1, r2) => {
    const lo = Math.min(r1, r2);
    const hi = Math.max(r1, r2);
    if (lo > s.after) return [lo + s.n, hi + s.n];
    if (hi >= s.after) return [lo, hi + s.n];
    return [lo, hi];
  };

const appliesTo = (s: Shift) => (sheet: string | null) =>
  (sheet ?? s.home?.toLowerCase() ?? null) === s.sheet.toLowerCase();

/** Rows after `s.after` on `s.sheet` move down by `s.n` (see the file comment). */
export function shiftRows(formula: string, s: Shift): string {
  return mapRefs(formula, appliesTo(s), (r) => (r > s.after ? r + s.n : r), growRange(s));
}

/** A space-separated list of ranges or cells (sqref, CF ref) on the moving sheet. */
export function shiftSqref(sqref: string, s: Shift): string {
  return shiftRows(sqref, { ...s, home: s.sheet });
}

/** The formula as it reads when copied `d` rows down (relative rows move). */
export function slideRows(formula: string, d: number): string {
  if (d === 0) return formula;
  return mapRefs(
    formula,
    () => true,
    (r, abs) => (abs ? r : r + d),
    (r1, r2, a1, a2) => [a1 ? r1 : r1 + d, a2 ? r2 : r2 + d],
  );
}

/** References to sheet `from` renamed to `to` (quoted when needed). */
export function renameSheetRefs(formula: string, from: string, to: string): string {
  const q = quoteSheet(to);
  const key = from.toLowerCase();
  let out = '';
  let i = 0;
  const PREFIX = /(?<![\w.$])('(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!/uy;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length && !(formula[j] === '"' && formula[j + 1] !== '"')) {
        j += formula[j] === '"' ? 2 : 1;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    PREFIX.lastIndex = i;
    const m = PREFIX.exec(formula);
    if (m && sheetKey(m[0]) === key) {
      out += `${q}!`;
      i += m[0].length;
    } else {
      out += formula.charAt(i);
      i++;
    }
  }
  return out;
}

/** A sheet name as a formula needs it: quoted unless it is a plain identifier. */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_][\w.]*$/u.test(name) && !/^[A-Za-z]{1,3}\d+$/u.test(name)
    ? name
    : `'${name.replace(/'/gu, "''")}'`;
}

/** Excel's last column (XFD) and row. */
export const MAX_COL = 16384;
export const MAX_ROW = 1048576;

/** A cell address as a person types it ("b4", "$B$4", " C12 "), or null. */
export function cellOf(text: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/u.exec(text.trim());
  if (!m) return null;
  const col = colNumber(m[1] ?? '');
  const row = Number(m[2]);
  return col >= 1 && col <= MAX_COL && row >= 1 && row <= MAX_ROW ? { col, row } : null;
}

/**
 * A column as a person types it: a number ("3") or letters ("C", "aa"), or
 * null (C13: "a field list with tick + column, number or letter").
 */
export function columnOf(text: string): number | null {
  const s = text.trim();
  if (/^\d{1,5}$/u.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= MAX_COL ? n : null;
  }
  if (/^[A-Za-z]{1,3}$/u.test(s)) {
    const n = colNumber(s);
    return n <= MAX_COL ? n : null;
  }
  return null;
}
