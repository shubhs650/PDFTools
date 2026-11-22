// Text corpus pairs 13 to 17 (M12-01, Q37): self-made documents typeset by
// flow.ts. Each builder returns both revisions and the facts the manifest
// states (page counts, where the edits landed), computed, not typed.

import { Flow, A4, headerFooter, type PageSetup } from './flow.ts';
import { Doc, rng, type DocInfo } from './pdf.ts';
import { drawTable, type Cell } from './table.ts';
import type { PairFiles } from './drawings.ts';

const DATE_A = 'D:20260901090000Z';
const DATE_B = 'D:20261015090000Z';

const info = (title: string, pair: number, date: string): DocInfo => ({
  title,
  author: 'Triya PDF corpus generator',
  subject: `Comparison corpus text pair ${String(pair)}, self-made`,
  creationDate: date,
  modDate: date,
});

function toPdf(setup: PageSetup, pages: string[], i: DocInfo, id: string): Uint8Array {
  const d = new Doc();
  for (const content of pages) d.addPage({ width: setup.width, height: setup.height, content });
  return d.finish(i, id);
}

/** Paragraph text built from a sentence bank, the same for both revisions. */
function prose(seed: number, bank: string[], sentences: number): string {
  const r = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) out.push(bank[Math.floor(r() * bank.length)] ?? '');
  return out.join(' ');
}

const SPEC_BANK = [
  'The Vendor shall be responsible for the design, supply, testing and documentation of the complete package.',
  'Deviations from this specification shall be listed in the technical bid and approved in writing by the Purchaser.',
  'Where requirements conflict, the more stringent requirement shall apply unless the Purchaser agrees otherwise.',
  'All instruments shall be calibrated against traceable standards before the factory acceptance test.',
  'The package shall be designed for continuous outdoor operation in a coastal, mildly corrosive atmosphere.',
  'Nozzle loads shall be at least twice the values given in the applicable pump standard.',
  'The baseplate shall be fabricated from structural steel and shall drain towards a single connection.',
  'Coupling guards shall be non-sparking and shall allow inspection of the coupling without removal.',
  'Spare parts for two years of operation shall be quoted separately with their delivery times.',
  'Painting shall follow the project coating specification for carbon steel in atmospheric service.',
  'Electric motors shall be rated for the maximum power required by the pump at the end of its curve.',
  'All pressure retaining parts shall be identified with their material grade and heat number.',
  'Welding procedures and welder qualifications shall be submitted for review before fabrication starts.',
  'The Vendor shall inform the Purchaser of any subcontractor before placing the order.',
  'Lifting lugs shall be designed for the complete package weight with a dynamic factor of 2.0.',
  'Noise levels shall not exceed 85 dB(A) at one metre from the package boundary.',
];

// --- Pair 13: header with revision letter, "Page X of Y", an added page --

const PUMP_SECTIONS: [string, number][] = [
  ['1 Scope', 3],
  ['2 Codes and standards', 3],
  ['3 Design conditions', 4],
  ['4 Materials of construction', 4],
  ['5 Performance and guarantees', 4],
  ['6 Inspection and testing', 5],
  ['7 Documentation', 3],
  ['8 Preservation, packing and shipping', 3],
];

export function text13(): PairFiles {
  const build = (rev: 'C' | 'D') => {
    const f = new Flow(A4);
    PUMP_SECTIONS.forEach(([title, paras], s) => {
      if (s === 4) {
        // A page break before section 5; Rev D inserts Annex B on its own page here.
        f.newPage();
        if (rev === 'D') {
          f.mark('annex');
          f.heading('Annex B Hydrostatic test record (inserted)');
          for (let k = 0; k < 3; k++) f.para(prose(900 + k, SPEC_BANK, 6), { justify: true });
          f.para(
            'The test pressure shall be held for 30 minutes with no visible leakage and no pressure drop. The record shall show the gauge serial numbers, the test medium, the temperature and the witnesses present.',
            { justify: true },
          );
          f.newPage();
        }
      }
      f.heading(title);
      for (let k = 0; k < paras; k++) {
        let t = prose(100 * s + k, SPEC_BANK, 8);
        if (s === 2 && k === 0) {
          f.mark('pressure');
          t = `The design pressure of the casing shall be ${rev === 'C' ? '16' : '20'} bar(g) at a design temperature of 120 °C. ${t}`;
        }
        if (s === 5 && k === 1) {
          f.mark('vibration');
          t = `${t} Vibration measured on the bearing housings shall not exceed ${rev === 'C' ? '3.0' : '2.8'} mm/s RMS at any flow between minimum continuous flow and 120 % of rated flow.`;
        }
        f.para(t, { justify: true });
      }
    });
    const pages = f.finish((p, total) =>
      headerFooter(
        A4,
        'TS-ENG-0413 Centrifugal pump package',
        `Rev ${rev}`,
        `Page ${String(p)} of ${String(total)}`,
      ),
    );
    return { pages, marks: f.marks };
  };
  const a = build('C');
  const b = build('D');
  return {
    old: toPdf(
      A4,
      a.pages,
      info('TS-ENG-0413 Centrifugal pump package, Rev C', 13, DATE_A),
      'text13-C',
    ),
    new: toPdf(
      A4,
      b.pages,
      info('TS-ENG-0413 Centrifugal pump package, Rev D', 13, DATE_B),
      'text13-D',
    ),
    facts: {
      oldPages: String(a.pages.length),
      newPages: String(b.pages.length),
      annexPage: String(b.marks.get('annex')),
      pressurePage: String(a.marks.get('pressure')),
      vibrationOld: String(a.marks.get('vibration')),
      vibrationNew: String(b.marks.get('vibration')),
    },
  };
}

// --- Pair 14: hyphenation, ligatures and footnotes -------------------------

const VOWELS = /[aeiouy]/i;

/** Marks naive hyphenation points (V-CV and VC-CV) in long alphabetic words. */
export function hyphenate(text: string): string {
  return text
    .split(' ')
    .map((w) => {
      if (w.length < 7 || !/^[A-Za-z]+[,.;:]?$/.test(w)) return w;
      let out = '';
      for (let i = 0; i < w.length; i++) {
        const a = w[i - 1] ?? '';
        const b = w[i] ?? '';
        const c = w[i + 1] ?? '';
        const d = w[i - 2] ?? '';
        const ok = i >= 3 && i <= w.length - 3 && /[a-z]/.test(b) && /[a-z]/.test(c);
        if (ok && VOWELS.test(a) && !VOWELS.test(b) && VOWELS.test(c)) out += '~';
        else if (ok && VOWELS.test(d) && !VOWELS.test(a) && !VOWELS.test(b) && VOWELS.test(c))
          out += '~';
        out += b;
      }
      return out;
    })
    .join(' ');
}

export function text14(): PairFiles {
  const build = (rev: 'A' | 'B') => {
    const setup: PageSetup = { ...A4, left: 72, right: 72 };
    const f = new Flow(setup, true);
    const P = (t: string, o: { ligatures?: boolean } = {}) => {
      f.para(hyphenate(t), { justify: true, size: 10.5, leading: 14, ...o });
    };
    f.heading('Flushing and cleaning of lube oil systems', 14);
    f.para('Field procedure FP-0721, issued for construction', { font: 'F4', size: 9 });
    f.heading('1 Purpose');
    P(
      'This procedure specifies the flushing, cleaning and final acceptance of the lubrication and seal oil systems of the compressor trains before the first start. It applies to all piping, fittings, coolers, filters and reservoirs that carry oil to the bearings, and it defines the responsibilities of the field engineers, the mechanical subcontractor and the commissioning team.',
    );
    f.heading('2 Flushing medium and equipment');
    P(
      `${rev === 'B' ? 'The flushing medium shall be filtered to 25 µm before it enters the system. ' : ''}The flushing oil shall be a low viscosity mineral oil compatible with the final lubricant and certified by its supplier for flushing service. Temporary flushing skids shall include a heater, a circulating pump sized for the specified flow velocity, a duplex filter and a sampling point upstream of the return filter.{fn:The heater shall be thermostatically controlled and shall not exceed 70 °C at its outlet.} Temporary hoses and fittings shall be clean, capped and identified before connection.`,
    );
    P(
      `Turbulent flow is essential: the flushing flow velocity shall be at least ${rev === 'A' ? '1.5' : '2.0'} m/s in the largest pipe of each loop, which normally requires two to three times the operating flow. Instruments, control valves and orifice plates shall be removed or bypassed with spool pieces, and the bearing housings shall be isolated with blind flanges so that no flushing debris enters the machine.${rev === 'B' ? '{fn:Spool pieces shall be fabricated and pickled with the same procedure as the permanent piping.}' : ''} The configuration of each loop shall be marked on a flushing diagram and signed by the field engineer.`,
    );
    f.heading('3 Cleanliness acceptance');
    P(
      `Oil samples shall be taken from the sampling point every four hours during circulation and analysed for particle count with a calibrated counter. The system is accepted when three consecutive samples meet the cleanliness code{fn:ISO 4406 cleanliness code ${rev === 'A' ? '17/15/12' : '18/16/13'} or better for bearing oil; the seal oil system follows the seal supplier's value.} and when a 100 mesh screen fitted at the bearing inlet shows no visible particles after one hour of circulation at the final flow.`,
    );
    // Rev B sets this paragraph without ligatures: the same words, no real change.
    P(
      'Should a sample fail, the field engineer shall identify the affected loop, flush it again at the specified velocity and inspect the filters for fibres, weld spatter and other foreign material. Persistent failures shall be reported to the commissioning lead, who shall decide whether the loop needs mechanical cleaning or chemical pickling before the flushing continues.',
      { ligatures: rev === 'A' },
    );
    f.heading('4 Final fill and records');
    P(
      `After acceptance the flushing oil shall be drained completely while it is still warm, the reservoirs shall be inspected and wiped with lint-free cloths, and the filter elements shall be replaced with the elements specified for operation. The ${rev === 'A' ? 'first' : 'final'} fill with operating oil shall be made through a 10 µm filter cart, and a sample of the operating oil shall be retained for reference.{fn:Retained samples shall be labelled with the system, the date and the oil batch number and kept for twelve months.}`,
    );
    P(
      'The flushing records shall include the flushing diagrams, the flow velocities achieved, the sample results with their certificates, the screen inspection reports and the signatures of the field engineer and the commissioning lead. The records form part of the mechanical completion dossier of each compressor train and shall be filed before the pre-commissioning certificate is issued.',
    );
    f.heading('5 Safety');
    P(
      'Hot oil, temporary hoses under pressure and the fire risk of oil mist require a permit to work for every flushing loop. Fire extinguishers shall be available at the skid, drip trays shall be placed under every temporary connection and spilled oil shall be cleaned immediately. Personnel shall wear oil resistant gloves and face shields when taking samples or changing filter elements.',
    );
    for (let k = 0; k < 4; k++) P(prose(1400 + k, SPEC_BANK, 6));
    const pages = f.finish((p, total) =>
      headerFooter(
        setup,
        'FP-0721 Flushing and cleaning of lube oil systems',
        `Rev ${rev}`,
        `${String(p)} / ${String(total)}`,
      ),
    );
    return { pages };
  };
  const a = build('A');
  const b = build('B');
  return {
    old: toPdf(
      A4,
      a.pages,
      info('FP-0721 Flushing and cleaning of lube oil systems, Rev A', 14, DATE_A),
      'text14-A',
    ),
    new: toPdf(
      A4,
      b.pages,
      info('FP-0721 Flushing and cleaning of lube oil systems, Rev B', 14, DATE_B),
      'text14-B',
    ),
    facts: { oldPages: String(a.pages.length), newPages: String(b.pages.length) },
  };
}

// --- Pair 15: a deleted page ----------------------------------------------

const MS_BANK = [
  'The supervisor shall brief the crew on the method, the hazards and the controls before each shift.',
  'Lifting operations shall follow the approved lifting plan and shall be stopped if the wind exceeds 38 km/h.',
  'Excavations deeper than 1.2 m shall be shored or battered back to a safe angle before anyone enters.',
  'Concrete shall be placed within 90 minutes of batching and compacted with internal vibrators.',
  'Survey control points shall be checked weekly and after any disturbance.',
  'Waste shall be segregated at source and removed from the work front at the end of each day.',
  'Access routes shall be kept clear and lit, and barriers shall separate plant from pedestrians.',
  'Inspection and test records shall be completed before the next activity starts.',
  'Any change to this method shall be reviewed by the engineer and briefed to the crew.',
  'Formwork shall be inspected by a competent person before concrete is placed.',
];

export function text15(): PairFiles {
  const build = (rev: 'A' | 'B') => {
    const f = new Flow(A4);
    const section = (title: string, seed: number, paras: number) => {
      f.heading(title);
      for (let k = 0; k < paras; k++) f.para(prose(seed + k, MS_BANK, 8), { justify: true });
    };
    f.heading('Method statement MS-CIV-118 Pipe rack foundations', 14);
    section('1 Scope of work', 10, 3);
    section('2 Sequence of work', 20, 4);
    f.newPage();
    section('3 Excavation and blinding', 30, 5);
    f.newPage();
    if (rev === 'A') {
      // The page Rev B deletes: section 4 in full, on one page.
      f.mark('deleted');
      section('4 Temporary works', 40, 5);
      f.mark('deletedEnd');
      f.newPage();
    }
    section('5 Reinforcement and formwork', 50, 5);
    f.newPage();
    section('6 Concrete placing and curing', 60, 5);
    const pages = f.finish((p) =>
      headerFooter(A4, 'MS-CIV-118 Pipe rack foundations', `Rev ${rev}`, `Page ${String(p)}`),
    );
    return { pages, marks: f.marks };
  };
  const a = build('A');
  const b = build('B');
  return {
    old: toPdf(
      A4,
      a.pages,
      info('MS-CIV-118 Pipe rack foundations, Rev A', 15, DATE_A),
      'text15-A',
    ),
    new: toPdf(
      A4,
      b.pages,
      info('MS-CIV-118 Pipe rack foundations, Rev B', 15, DATE_B),
      'text15-B',
    ),
    facts: {
      oldPages: String(a.pages.length),
      newPages: String(b.pages.length),
      deletedPage: String(a.marks.get('deleted')),
      deletedEnd: String(a.marks.get('deletedEnd')),
    },
  };
}

// --- Pair 16: a table with merged and wrapped cells -------------------------

const LANDSCAPE: PageSetup = {
  width: 841.89,
  height: 595.28,
  top: 64,
  bottom: 56,
  left: 48,
  right: 48,
};

export function text16(): PairFiles {
  const build = (rev: 'A' | 'B') => {
    const f = new Flow(LANDSCAPE);
    f.heading('Equipment list EL-300 Cooling water and transfer pumps', 14);
    f.para('Design data per equipment item. Merged cells apply to every row they span.', {
      size: 9,
    });
    const cols = [36, 110, 60, 150, 62, 62, 90, 175];
    const header: Cell[][] = [
      [
        { text: 'Item', rowspan: 2, bold: true },
        { text: 'Service', rowspan: 2, bold: true },
        { text: 'Tag', rowspan: 2, bold: true },
        { text: 'Description', rowspan: 2, bold: true },
        { text: 'Design conditions', colspan: 2, bold: true, align: 'center' },
        { text: 'Material', rowspan: 2, bold: true },
        { text: 'Remarks', rowspan: 2, bold: true },
      ],
      [
        { text: 'Pressure barg', bold: true, align: 'center' },
        { text: 'Temp. °C', bold: true, align: 'center' },
      ],
    ];
    const pumps = rev === 'A' ? ['P-101A', 'P-101B'] : ['P-101A', 'P-101B', 'P-101C'];
    const body: Cell[][] = [];
    pumps.forEach((tag, i) => {
      const row: Cell[] = [];
      if (i === 0) {
        row.push(
          { text: '1', rowspan: pumps.length },
          { text: 'Feed water transfer pumps', rowspan: pumps.length },
        );
      }
      row.push(
        { text: tag },
        {
          text:
            i === 2
              ? 'Centrifugal pump, installed spare for maintenance'
              : 'Centrifugal pump, horizontal, between bearings',
        },
        { text: '16.0', align: 'center' },
        { text: '85', align: 'center' },
      );
      if (i === 0) row.push({ text: 'Duplex 2205 casing and impeller', rowspan: pumps.length });
      row.push({
        text:
          i === 0
            ? rev === 'A'
              ? 'Mechanical seal per API 682.'
              : 'Mechanical seal per API 682 Category 2, Arrangement 2, with a Plan 53A barrier system.'
            : i === 1
              ? 'Common baseplate with P-101A.'
              : 'Added for N+1 redundancy.',
      });
      body.push(row);
    });
    const cw: [string, string][] = [
      ['P-201A', '10.0'],
      ['P-201B', '10.0'],
      ['P-201C', '10.0'],
    ];
    cw.forEach(([tag, p], i) => {
      const row: Cell[] = [];
      if (i === 0)
        row.push(
          { text: '2', rowspan: 3 },
          { text: 'Cooling water circulation pumps', rowspan: 3 },
        );
      row.push(
        { text: tag },
        { text: 'Vertical inline pump with variable speed drive' },
        { text: p, align: 'center' },
        { text: '60', align: 'center' },
      );
      if (i === 0)
        row.push({ text: rev === 'A' ? 'Duplex 2205' : 'Super duplex 2507', rowspan: 3 });
      row.push({
        text: i === 0 ? 'Duty, standby and spare share one suction header; see P&ID 300-12.' : '-',
      });
      body.push(row);
    });
    const exchangers: [string, string, string, string][] = [
      [
        'E-201',
        'Plate heat exchanger, gasketed, 120 plates',
        rev === 'A' ? '85' : '95',
        'Titanium plates, EPDM gaskets',
      ],
      ['E-202', 'Plate heat exchanger, gasketed, 80 plates', '85', 'Titanium plates, EPDM gaskets'],
    ];
    exchangers.forEach(([tag, d, t, m], i) => {
      const row: Cell[] = [];
      if (i === 0)
        row.push({ text: '3', rowspan: 2 }, { text: 'Cooling water exchangers', rowspan: 2 });
      row.push(
        { text: tag },
        { text: d },
        { text: '10.0', align: 'center' },
        { text: t, align: 'center' },
        { text: m },
      );
      row.push({ text: i === 0 ? 'Frame sized for 20 % more plates.' : '-' });
      body.push(row);
    });
    // Further items fill the table onto a second page; header repeats there.
    for (let k = 0; k < 14; k++) {
      const n = 4 + k;
      body.push([
        { text: String(n) },
        {
          text:
            k % 3 === 0
              ? 'Chemical dosing package'
              : k % 3 === 1
                ? 'Strainer, basket type'
                : 'Instrument air receiver',
        },
        { text: `X-${String(300 + k)}` },
        {
          text:
            k % 2
              ? 'Skid mounted, two pumps, one tank'
              : 'Duplex basket, quick opening cover, differential pressure gauge',
        },
        { text: k % 2 ? '6.0' : '10.0', align: 'center' },
        { text: '50', align: 'center' },
        { text: k % 2 ? 'SS316L' : 'Carbon steel, lined' },
        {
          text:
            k % 4 === 0
              ? 'Vendor to confirm the weight and the footprint before the layout is frozen.'
              : '-',
        },
      ]);
    }
    f.mark('table');
    drawTable(f, cols, header, body);
    const pages = f.finish((p, total) =>
      headerFooter(
        LANDSCAPE,
        'EL-300 Equipment list',
        `Rev ${rev}`,
        `Page ${String(p)} of ${String(total)}`,
      ),
    );
    return { pages };
  };
  const a = build('A');
  const b = build('B');
  return {
    old: toPdf(LANDSCAPE, a.pages, info('EL-300 Equipment list, Rev A', 16, DATE_A), 'text16-A'),
    new: toPdf(LANDSCAPE, b.pages, info('EL-300 Equipment list, Rev B', 16, DATE_B), 'text16-B'),
    facts: { oldPages: String(a.pages.length), newPages: String(b.pages.length) },
  };
}

// --- Pair 17: a 500-page contract (generated at test time) -----------------

const ARTICLES = [
  'General provisions',
  'The Employer',
  'The Engineer',
  'The Contractor',
  'Design',
  'Staff and labour',
  'Plant, materials and workmanship',
  'Commencement, delays and suspension',
  'Tests on completion',
  'Taking over',
  'Defects liability',
  'Variations and adjustments',
  'Contract price and payment',
  'Termination',
  'Risk and responsibility',
  'Insurance',
  'Force majeure',
  'Claims and disputes',
];
const SUBJECTS = [
  'The Contractor',
  'The Employer',
  'The Engineer',
  'Each Party',
  'The Subcontractor',
  'The Supplier',
];
const VERBS = [
  'shall submit',
  'shall provide',
  'shall maintain',
  'shall keep',
  'shall review',
  'may request',
  'shall deliver',
];
const OBJECTS = [
  'the programme of the Works',
  'all records of the Works',
  'the quality plan',
  'a written notice',
  'the health and safety plan',
  'the as-built documents',
  'evidence of the insurances',
  'a monthly progress report',
  'the drawings for review',
  'the test certificates',
];
const TAILS = [
  'within 14 days of the Commencement Date',
  'before any work starts on the Site',
  'at intervals of not more than one month',
  'in accordance with the Specification',
  'unless the Engineer agrees otherwise in writing',
  'to the reasonable satisfaction of the Engineer',
  'at no additional cost to the Employer',
  'as required by the applicable laws',
];

/** Clauses per article and the number of clauses that fill 500 pages. */
const PER_ARTICLE = 40;
export const CONTRACT_CLAUSES = 7600;

/** Buried edits: clause index → [Rev 0 text, Rev 1 text]. */
const EDITS: Record<number, [string, string]> = {
  562: [
    'The Contractor shall pay delay damages of 0.5 % of the Contract Price for every week of delay, up to a maximum of 10 % of the Contract Price.',
    'The Contractor shall pay delay damages of 0.75 % of the Contract Price for every week of delay, up to a maximum of 10 % of the Contract Price.',
  ],
  3222: [
    'The Engineer shall respond to a request for information within 28 days of its receipt.',
    'The Engineer shall respond to a request for information within 21 days of its receipt.',
  ],
  5913: [
    'Any dispute not settled by agreement shall be finally settled by arbitration seated in Singapore.',
    'Any dispute not settled by agreement shall be finally settled by arbitration seated in London.',
  ],
  6916: [
    'The Contractor shall not be liable for any loss of use, loss of production or loss of profit suffered by the Employer.',
    'The Contractor shall be liable for any loss of use, loss of production or loss of profit suffered by the Employer.',
  ],
};
/** Rev 1 inserts this clause after clause index 2060 (renumbering the rest of its article). */
const INSERT_AFTER = 3800;
const INSERTED =
  'Cyber security. The Contractor shall protect all control system software and data supplied under the Contract against unauthorised access, and shall report any incident to the Employer within 24 hours.';

export function text17(): PairFiles {
  const build = (rev: 0 | 1) => {
    const r = rng(17017);
    const pick = (a: string[]): string => a[Math.floor(r() * a.length)] ?? '';
    const clauses: string[] = [];
    for (let i = 0; i < CONTRACT_CLAUSES; i++) {
      const n = 2 + Math.floor(r() * 3);
      const s: string[] = [];
      for (let k = 0; k < n; k++)
        s.push(`${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}.`);
      const edit = EDITS[i];
      clauses.push(edit ? edit[rev] : s.join(' '));
    }
    if (rev === 1) clauses.splice(INSERT_AFTER + 1, 0, INSERTED);
    const f = new Flow(A4);
    f.heading(
      'Contract C-2026-500 Engineering, procurement and construction of a water treatment plant',
      13,
    );
    let article = 0;
    let clauseNo = 0;
    const editAt = new Map<number, number>();
    clauses.forEach((t, i) => {
      // Article boundaries follow Rev 0's clause indexes, so the insertion renumbers within one article.
      const base = rev === 1 && i > INSERT_AFTER ? i - 1 : i;
      const isInserted = rev === 1 && i === INSERT_AFTER + 1;
      if (!isInserted && base % PER_ARTICLE === 0) {
        article++;
        clauseNo = 0;
        f.heading(`Article ${String(article)} ${ARTICLES[(article - 1) % ARTICLES.length] ?? ''}`);
      }
      clauseNo++;
      if (EDITS[base] && !isInserted) editAt.set(base, f.pages.length);
      if (isInserted) editAt.set(-1, f.pages.length);
      f.para(`${String(article)}.${String(clauseNo)} ${t}`, { justify: true });
    });
    const pages = f.finish((p, total) =>
      headerFooter(
        A4,
        'Contract C-2026-500',
        `Revision ${String(rev)}`,
        `Page ${String(p)} of ${String(total)}`,
      ),
    );
    return { pages, editAt };
  };
  const a = build(0);
  const b = build(1);
  const where = (k: number) => `${String(a.editAt.get(k))}->${String(b.editAt.get(k))}`;
  return {
    old: toPdf(A4, a.pages, info('Contract C-2026-500, Revision 0', 17, DATE_A), 'text17-0'),
    new: toPdf(A4, b.pages, info('Contract C-2026-500, Revision 1', 17, DATE_B), 'text17-1'),
    facts: {
      oldPages: String(a.pages.length),
      newPages: String(b.pages.length),
      ld: where(562),
      rfi: where(3222),
      seat: where(5913),
      liability: where(6916),
      inserted: String(b.editAt.get(-1)),
    },
  };
}
