// The text corpus's manifest differences (M12-17, D-66) as checks on the
// reported changes, after spike S30's accounting: every manifest item must be
// found, and every reported change must be explained by an item (a manifest
// item, or an "unlisted" one: a real difference the manifest does not name,
// such as the revision letter in the title block). A change nothing explains
// is a false report. Items M12-18 brings (figures, table cells) are marked
// `later` and not required yet.
import type { TextChange, TextChangeKind } from '../../../src/model/compare/text/match';

export interface Item {
  id: string;
  what: string;
  test: (c: TextChange) => boolean;
  unlisted?: boolean;
  /** Found by a later task (M12-18: figures, table rows). */
  later?: boolean;
}

const norm = (s: string): string => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const hit = (text: string | undefined, p: string | RegExp | undefined): boolean =>
  p === undefined
    ? true
    : typeof p === 'string'
      ? norm(text ?? '').includes(norm(p))
      : p.test(norm(text ?? ''));

/** A change of `kinds` (any by default) whose old text has `a` and new text has `b`. */
const ab =
  (a: string | RegExp | undefined, b: string | RegExp | undefined, kinds?: TextChangeKind[]) =>
  (c: TextChange): boolean =>
    (!kinds || kinds.includes(c.kind)) &&
    (a === undefined || !!c.a) &&
    (b === undefined || !!c.b) &&
    hit(c.a?.text, a) &&
    hit(c.b?.text, b);
const any =
  (...ts: ((c: TextChange) => boolean)[]) =>
  (c: TextChange): boolean =>
    ts.some((t) => t(c));

/** The revision letter and issue date in the title block and running header. */
const revision = (from: string, to: string, dates: [string, string][] = []): Item => ({
  id: 'revision',
  what: `revision ${from} → ${to} and its date (title block, running header)`,
  unlisted: true,
  test: any(
    ab(new RegExp(`^${from}$`), new RegExp(`^${to}$`), ['replaced', 'header', 'footer']),
    ...dates.map(([a, b]) => ab(a, b, ['replaced', 'header'])),
  ),
});

const figure = (what: string): Item => ({
  id: 'figure',
  what,
  later: true,
  test: () => false,
});

export const EXPECTED: Record<string, Item[]> = {
  '01': [
    { id: 'qty', what: 'Item 3 qty 12 → 15', test: ab('12', '15') },
    { id: 'price', what: 'Item 3 price $1,450 → $1,520', test: ab('1,450.00', '1,520.00') },
    { id: 'item5', what: 'Item 5 added ($3,200)', test: ab(undefined, '3,200.00', ['inserted']) },
    {
      id: 'item5-name',
      what: 'Item 5 added (its description, read as running text until M12-18)',
      unlisted: true,
      test: ab(undefined, 'On-Site Commissioning', ['inserted']),
    },
    { id: 'gst', what: 'GST 18% → 12%', test: ab('18%', '12%') },
    { id: 'po', what: 'PO R1 → R2', test: ab('PO-88412-R1', 'PO-88412-R2') },
    { id: 'net', what: 'Net 30 → Net 45', test: ab(/^30$/, /^45$/) },
    {
      id: 'totals',
      what: 'totals recalculated (amount, subtotal, GST, total due; running text until M12-18)',
      test: ab(/17,400\.00|44,140\.00|7,945\.20|52,085\.20/, undefined, ['replaced']),
    },
    {
      ...revision('A', 'B', [['2026-10-28', '2026-11-14']]),
      test: any(
        revision('A', 'B', [['2026-10-28', '2026-11-14']]).test,
        ab('INV-2026-0482-A', 'INV-2026-0482-B'),
      ),
    },
  ],
  '03': [
    {
      id: 'wind',
      what: 'Wind factor 1.40 → 1.50 (and the line load it gives)',
      test: any(ab('1.40', '1.50'), ab('28.64', '29.49')),
    },
    { id: 'med', what: 'M_Ed 142.5 → 156.8 kN·m', test: ab('142.5', '156.8') },
    { id: 'sigma', what: 'σ_b 178.4 → 191.2 MPa', test: ab('178.4', '191.2') },
    { id: 'util', what: 'utilization 0.78 → 0.84', test: ab('0.78', '0.84') },
    {
      id: 'bolts',
      what: 'bolts Grade 8.8 → 10.9 (and their 800 → 1000 MPa)',
      test: any(ab('8.8', '10.9'), ab('800 MPa', '1000 MPa')),
    },
    figure('updated BMD figure'),
    revision('A', 'B', [['2026-10-12', '2026-11-16']]),
  ],
  '04': [
    {
      id: 'clauses',
      what: '2 new clauses 2.2.1 / 2.2.2 inserted (cascading two-column reflow)',
      test: ab(undefined, /Clause 2\.2\.1.*Clause 2\.2\.2/, ['inserted']),
    },
    { id: 'metal', what: 'metallurgy CF8M → Duplex 2205', test: ab('CF8M', 'Duplex 2205') },
    { id: 'hydro', what: 'hydrotest 24 → 30 bar', test: ab('24.0 bar(g)', '30.0 bar(g)') },
    revision('A', 'B', [['2026-09-30', '2026-11-14']]),
  ],
  '06': [
    { id: 'purge', what: 'purge 15 → 25 min', test: ab(/^15$/, /^25$/) },
    {
      id: 'role',
      what: 'Shift Engineer → Commissioning Lead',
      test: ab('Shift Engineer', 'Commissioning Lead'),
    },
    revision('A', 'B', [['2026-10-12', '2026-11-12']]),
  ],
  '09': [
    {
      id: 'swap',
      what: 'Groundwater and Foundation sections swapped (a move)',
      test: (c) => c.kind === 'moved',
    },
    { id: 'gw', what: 'groundwater depth 3.2 → 2.6 m', test: ab('3.2 m', '2.6 m') },
    { id: 'bearing', what: 'allowable bearing 180 → 165 kPa', test: ab('180 kPa', '165 kPa') },
    figure('updated SPT chart'),
    revision('A', 'B', [['2026-10-08', '2026-11-18']]),
  ],
  '11': [
    { id: 'temp', what: 'Temp 280 → 320 °C (text and table)', test: ab('280°C', '320°C') },
    { id: 'dp', what: 'ΔP 0.60 → 0.45 bar', test: ab('0.60 bar', '0.45 bar') },
    { id: 'de', what: 'German Prüfdruck 16 → 25 bar', test: ab('16 bar', '25 bar') },
    { id: 'hi', what: 'Hindi safety factor 2.5 → 3.0', test: ab('2.5', '3.0') },
    {
      id: 'ja',
      what: 'Japanese SUS304 6 mm → SUS316L 8 mm',
      test: any(ab('SUS304', 'SUS316L'), ab('6.0 mm', '8.0 mm')),
    },
    { id: 'ar', what: 'Arabic warranty 12 → 24 months (right to left)', test: ab(/^12$/, /^24$/) },
    { id: 'ra', what: 'Ra 3.2 → 1.6 µm', test: ab('3.2 µm', '1.6 µm') },
    { id: 'mohm', what: '≥50 → ≥100 MΩ', test: ab('50 MΩ', '100 MΩ') },
    revision('A', 'B', [['2026-10-04', '2026-11-19']]),
  ],
};

export interface Accounting {
  found: string[];
  missed: string[];
  /** Changes no item explains (false reports), as "kind: old → new". */
  unexplained: string[];
}

/** Every change (moves with the edits inside them) against the items. */
export function account(items: readonly Item[], changes: readonly TextChange[]): Accounting {
  const flat: TextChange[] = [];
  for (const c of changes) {
    flat.push(c);
    for (const x of c.inner ?? []) flat.push(x);
  }
  const found = new Set<string>();
  const unexplained: string[] = [];
  for (const c of flat) {
    const its = items.filter((i) => i.test(c));
    for (const it of its) found.add(it.id);
    if (!its.length) unexplained.push(`${c.kind}: ${c.a?.text ?? '∅'} → ${c.b?.text ?? '∅'}`);
  }
  const want = items.filter((i) => !i.unlisted && !i.later);
  return {
    found: want.filter((i) => found.has(i.id)).map((i) => i.id),
    missed: want.filter((i) => !found.has(i.id)).map((i) => i.id),
    unexplained,
  };
}
