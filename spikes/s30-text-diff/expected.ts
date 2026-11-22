// Spike S30 (M12-05): every manifest difference of the text corpus, written as
// a check on the reported changes. Each reported change must be explained by
// an item (a manifest item, or an "unlisted" item: a real difference the
// manifest does not name, such as the revision letter in the title block), and
// each manifest item must be found. A change no item explains is a false
// report; a manifest item no change finds is a miss.

import type { Change, Kind } from './compare.ts';

export interface Item {
  id: string;
  /** The manifest's words, or why an unlisted difference is real. */
  what: string;
  test: (c: Change) => boolean;
  /** A real difference the manifest does not list. */
  unlisted?: boolean;
  /** Found only with OCR at compare time. */
  ocr?: boolean;
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const hit = (text: string | undefined, p: string | RegExp | undefined) =>
  p === undefined
    ? true
    : typeof p === 'string'
      ? norm(text ?? '').includes(norm(p))
      : p.test(norm(text ?? ''));

/** A change of `kind` (any by default) whose old text has `a` and new text has `b`. */
const ab =
  (a: string | RegExp | undefined, b: string | RegExp | undefined, kinds?: Kind[]) =>
  (c: Change): boolean =>
    (!kinds || kinds.includes(c.kind)) &&
    (a === undefined || !!c.a) &&
    (b === undefined || !!c.b) &&
    hit(c.a?.text, a) &&
    hit(c.b?.text, b);
const any =
  (...ts: ((c: Change) => boolean)[]) =>
  (c: Change) =>
    ts.some((t) => t(c));

/** The revision letter or number and the issue date in the title block and running header. */
const revision = (from: string, to: string, dates: [string, string][] = []): Item => ({
  id: 'revision',
  what: `revision ${from} → ${to} and its date (title block, running header)`,
  unlisted: true,
  test: any(
    ab(new RegExp(`^${from}$`), new RegExp(`^${to}$`), ['replaced', 'header', 'footer']),
    ...dates.map(([a, b]) => ab(a, b, ['replaced', 'header'])),
  ),
});

export const EXPECTED: Record<string, Item[]> = {
  '01': [
    { id: 'qty', what: 'Item 3 qty 12 → 15', test: ab('12', '15') },
    { id: 'price', what: 'Item 3 price $1,450 → $1,520', test: ab('1,450.00', '1,520.00') },
    { id: 'item5', what: 'Item 5 added ($3,200)', test: ab(undefined, '3,200.00', ['inserted']) },
    { id: 'gst', what: 'GST 18% → 12%', test: ab('18%', '12%') },
    { id: 'po', what: 'PO R1 → R2', test: ab('PO-88412-R1', 'PO-88412-R2') },
    { id: 'net', what: 'Net 30 → Net 45', test: ab(/^30$/, /^45$/) },
    {
      id: 'totals',
      what: 'totals recalculated (amount, subtotal, GST, total due)',
      test: (c) => c.kind === 'replaced' && !!c.table && /Amount|column 2/.test(c.table.col ?? ''),
    },
    {
      ...revision('A', 'B', [['2026-10-28', '2026-11-14']]),
      test: any(
        revision('A', 'B', [['2026-10-28', '2026-11-14']]).test,
        ab('INV-2026-0482-A', 'INV-2026-0482-B'),
      ),
    },
  ],
  '02': [
    {
      id: 'status',
      what: 'Overall status ACCEPT → CONDITIONAL HOLD',
      test: any(ab('ACCEPTED', 'CONDITIONAL HOLD'), ab('ALL 24 WELDS', 'REJECTED WELD')),
    },
    { id: 'figure', what: 'Fig 1 UT A-scan replaced and taller', test: (c) => c.kind === 'figure' },
    {
      id: 'w14',
      what: 'W-14 flaw 2.1 → 3.4 mm (REJECT), in the text and the table',
      test: any(
        ab('2.1 mm', '3.4 mm'),
        ab('ACCEPT', 'REJECT'),
        ab(/38%|slag|42 mm|discontinuity|well below|reporting threshold/, undefined, ['replaced']),
      ),
    },
    { id: 'ncr', what: 'NCR note added', test: ab(undefined, 'NCR-2026-114', ['inserted']) },
    revision('A', 'B', [['2026-11-02', '2026-11-15']]),
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
    { id: 'figure', what: 'updated BMD figure', test: (c) => c.kind === 'figure' },
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
  '05': [
    {
      id: 'clauses',
      what: '2 new clauses inserted in section 3',
      test: ab(undefined, /Clause 3\.4: ESG.*Clause 3\.5: Modern Slavery/, ['inserted']),
    },
    {
      id: 'renumber',
      what: 'renumbering 3.4–3.9 → 3.6–3.11 (reported once)',
      test: ab('3.4–3.9', '3.6–3.11', ['renumbered']),
    },
    { id: 'ld', what: 'LD cap 5% → 10%', test: ab('5%', '10%') },
    {
      id: 'not',
      what: "Clause 5.3 removes 'not' from liability",
      test: ab(/^not$/, undefined, ['deleted']),
    },
    revision('A', 'B', [['2026-10-01', '2026-11-17']]),
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
  '07': [
    {
      id: 'del38',
      what: 'Item 38 deleted',
      test: (c) => c.kind === 'deleted' && (c.table?.row ?? '').startsWith('038'),
    },
    {
      id: 'ins75a',
      what: 'Item 075A inserted',
      test: (c) => c.kind === 'inserted' && (c.table?.row ?? '').startsWith('075A'),
    },
    {
      id: 'rates',
      what: 'rate increases on items 22, 64, 98, 121 (and their totals)',
      test: (c) => c.kind === 'replaced' && /^(022|064|098|121) /.test(c.table?.row ?? ''),
    },
    {
      id: 'grand',
      what: 'Grand Total recalculated',
      test: (c) => (c.table?.row ?? '').includes('GRAND TOTAL'),
    },
    revision('A', 'B', [['2026-10-05', '2026-11-18']]),
  ],
  '08': [
    { id: 'heat', what: 'Heat HT-99241-A → B', test: ab('HT-99241-A', 'HT-99241-B') },
    { id: 'obs', what: '2 → 3 observations', test: ab(/^2$/, /^3$/) },
    { id: 'deadline', what: 'deadline', test: ab('2026-11-30', '2026-12-15') },
    {
      id: 'calib',
      what: 'scanned page: calibration expiry 2026-12-31 → 2027-06-30',
      test: ab('2026-12-31', '2027-06-30'),
      ocr: true,
    },
    {
      id: 'cert',
      what: 'scanned page: certificate CAL-2026-7741-A → B',
      test: ab('CAL-2026-7741-A', 'CAL-2026-7741-B'),
      ocr: true,
    },
    {
      id: 'cr',
      what: 'scanned page: measured Cr 16.81% → 16.84%',
      test: ab('16.81%', '16.84%'),
      ocr: true,
    },
    revision('A', 'B', [['2026-10-20', '2026-11-17']]),
  ],
  '09': [
    {
      id: 'swap',
      what: 'Groundwater and Foundation sections swapped (a move)',
      test: (c) => c.kind === 'moved',
    },
    { id: 'gw', what: 'groundwater depth 3.2 → 2.6 m', test: ab('3.2 m', '2.6 m') },
    { id: 'bearing', what: 'allowable bearing 180 → 165 kPa', test: ab('180 kPa', '165 kPa') },
    { id: 'figure', what: 'updated SPT chart', test: (c) => c.kind === 'figure' },
    revision('A', 'B', [['2026-10-08', '2026-11-18']]),
  ],
  '10': [
    { id: 'bond', what: 'bond 10 → 15%', test: ab('10%', '15%') },
    { id: 'warranty', what: 'warranty 12 → 24 months', test: ab('12 months', '24 months') },
    { id: 'milestone', what: 'milestone date', test: ab('2028-03-15', '2028-04-30') },
    { id: 'seat', what: 'Mumbai → Singapore', test: ab('Mumbai', 'Singapore') },
    {
      id: 'addendum',
      what: '1-page Addendum 6A inserted',
      test: ab(undefined, 'ADDENDUM 6A', ['inserted']),
    },
    revision('A', 'B', [['2026-09-15', '2026-11-19']]),
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
  '12': [
    { id: 'value', what: 'Contract value $285,000 → $312,500', test: ab('285,000', '312,500') },
    {
      id: 'completion',
      what: 'completion 2027-02-28 → 2027-04-15',
      test: ab('2027-02-28', '2027-04-15'),
    },
    { id: 'retention', what: 'retention 5.0% → 7.5%', test: ab('5.0%', '7.5%') },
    { id: 'grout', what: 'grout 45 → 55 MPa', test: ab('45 MPa', '55 MPa') },
    { id: 'vo', what: 'VO-014-R1 → R2', test: ab('VO-014-R1', 'VO-014-R2') },
    {
      id: 'artefacts',
      what: "Rev A OCR artefacts '5O0 mm', 'U1trasonic' (grouped as possible OCR error)",
      test: (c) => c.ocr === 'possible OCR error' && /5O0|U1trasonic/.test(c.a?.text ?? ''),
    },
    revision('A', 'B', [['2026-10-09', '2026-11-18']]),
  ],
  '13': [
    {
      id: 'header',
      what: "Header 'Rev C' → 'Rev D' on every page (once)",
      test: ab(/^C$/, /^D$/, ['header']),
    },
    {
      id: 'footer',
      what: "Footer 'Page X of 6' → 'Page X of 7' (once)",
      test: ab(/^6$/, /^7$/, ['footer']),
    },
    {
      id: 'annex',
      what: "page 4 'Annex B Hydrostatic test record' inserted",
      test: ab(undefined, 'Annex B Hydrostatic test record', ['inserted']),
    },
    { id: 'pressure', what: 'design pressure 16 → 20 bar(g)', test: ab('16 bar(g)', '20 bar(g)') },
    { id: 'vibration', what: 'vibration limit 3.0 → 2.8 mm/s', test: ab('3.0 mm/s', '2.8 mm/s') },
  ],
  '14': [
    {
      id: 'sentence',
      what: "sentence inserted at the start of section 2 ('filtered to 25 µm')",
      test: ab(undefined, 'filtered to 25 µm', ['inserted']),
    },
    { id: 'velocity', what: 'flow velocity 1.5 → 2.0 m/s', test: ab('1.5 m/s', '2.0 m/s') },
    {
      id: 'footnote',
      what: 'new footnote 2 (spool pieces) with its mark',
      test: any(ab(undefined, 'Spool pieces', ['inserted']), ab(undefined, /^2$/, ['inserted'])),
    },
    {
      id: 'renumber',
      what: 'old footnotes 2–3 renumbered 3–4 (once)',
      test: ab('2–3', '3–4', ['renumbered']),
    },
    { id: 'iso', what: 'ISO 4406 code 17/15/12 → 18/16/13', test: ab('17/15/12', '18/16/13') },
    { id: 'fill', what: "'first fill' → 'final fill'", test: ab('first', 'final') },
    revision('A', 'B'),
  ],
  '15': [
    {
      id: 'page',
      what: "Rev A page 4 (section 4 'Temporary works') deleted",
      test: ab('Temporary works', undefined, ['deleted']),
    },
    {
      id: 'header',
      what: 'header Rev A → B (once); footers renumber (not reported)',
      test: ab(/^A$/, /^B$/, ['header']),
    },
  ],
  '16': [
    {
      id: 'row',
      what: 'row P-101C added inside item 1',
      test: ab(undefined, 'P-101C', ['inserted']),
    },
    {
      id: 'remark',
      what: 'P-101A remark wraps onto more lines',
      test: ab('Mechanical seal per API 682.', 'Plan 53A barrier system'),
    },
    {
      id: 'material',
      what: "merged material cell 'Duplex 2205' → 'Super duplex 2507'",
      test: ab('Duplex 2205', 'Super duplex 2507'),
    },
    {
      id: 'temp',
      what: 'E-201 design temperature 85 → 95',
      test: (c) =>
        ab(/^85$/, /^95$/)(c) && /E-201|Cooling water exchangers/.test(c.table?.row ?? ''),
    },
    revision('A', 'B'),
  ],
  '17': [
    { id: 'ld', what: 'delay damages 0.5 % → 0.75 % (P37)', test: ab('0.5 %', '0.75 %') },
    { id: 'rfi', what: 'RFI response 28 → 21 days (P212)', test: ab('28 days', '21 days') },
    {
      id: 'seat',
      what: 'arbitration seat Singapore → London (P389)',
      test: ab('Singapore', 'London'),
    },
    {
      id: 'liability',
      what: "'shall not be liable' → 'shall be liable' (P456)",
      test: ab(/^not$/, undefined, ['deleted']),
    },
    {
      id: 'cyber',
      what: "new clause 'Cyber security' inserted (P250)",
      test: ab(undefined, 'Cyber security', ['inserted']),
    },
    {
      id: 'renumber',
      what: 'the rest of its article renumbered (once)',
      test: (c) => c.kind === 'renumbered',
    },
    revision('0', '1'),
  ],
  scrambled: [
    { id: 'clause', what: 'Clause 3A inserted', test: ab(undefined, 'Clause 3A', ['inserted']) },
    {
      id: 'pressure',
      what: 'Clause 8: 24.0 → 30.0 bar(g)',
      test: ab('24.0 bar(g)', '30.0 bar(g)'),
    },
    {
      id: 'metal',
      what: 'Clause 11: A351 CF8M → A890 Duplex 2205',
      test: ab('CF8M', 'Duplex 2205'),
    },
  ],
};

export interface Accounting {
  found: string[];
  missed: string[];
  /** Changes no item explains (false reports). */
  unexplained: Change[];
  reported: number;
}

/** Every change (moves with their inner edits) against the items. */
export function account(
  items: readonly Item[],
  changes: readonly Change[],
  withOcr: boolean,
): Accounting {
  const flat: Change[] = [];
  for (const c of changes) {
    flat.push(c);
    for (const x of c.inner ?? []) flat.push(x);
  }
  const found = new Set<string>();
  const unexplained: Change[] = [];
  for (const c of flat) {
    const it = items.find((i) => i.test(c));
    if (it) found.add(it.id);
    else unexplained.push(c);
  }
  const want = items.filter((i) => !i.unlisted && (withOcr || !i.ocr));
  return {
    found: want.filter((i) => found.has(i.id)).map((i) => i.id),
    missed: want.filter((i) => !found.has(i.id)).map((i) => i.id),
    unexplained,
    reported: changes.length,
  };
}
