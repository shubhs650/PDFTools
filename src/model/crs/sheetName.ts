// Sheet names for the copies of a CRS template sheet (M13-07, D-71, C5, C15;
// ADR-034 Amendment 1 item 4). Excel's rules: 1–31 characters (UTF-16 units,
// a surrogate pair never split), none of : \ / ? * [ ], no control
// characters, no quote at either end, not "History" (Excel keeps it), and
// unique without regard to case. Pure.

const MAX = 31;

/** Cut to `max` UTF-16 units without splitting a pair or ending on a quote. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let t = s.slice(0, max);
  if (/[\uD800-\uDBFF]$/u.test(t)) t = t.slice(0, -1);
  return t.replace(/'+$/u, '').trimEnd();
}

/**
 * A safe, unique sheet name for `raw`; `taken` holds the names in use, lower
 * case (the caller adds the result). `fallback` stands in for an empty name.
 */
export function sheetName(raw: string, taken: ReadonlySet<string>, fallback = 'Sheet'): string {
  let base = raw
    .replace(/[:\\/?*[\]]/gu, '-')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .replace(/^'+|'+$/gu, '')
    .trim();
  if (!base) base = fallback;
  if (base.toLowerCase() === 'history') base = `${base} 1`;
  let name = cut(base, MAX);
  for (let i = 2; taken.has(name.toLowerCase()); i++) {
    const tail = ` (${String(i)})`;
    name = cut(base, MAX - tail.length) + tail;
  }
  return name;
}
