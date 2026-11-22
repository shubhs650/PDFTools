// The corpus pairs this generator owns (M12-01): where they live, how they are
// built and their manifest rows, in the manifests' own columns. Pairs 01–13
// (overlay) and 01–12 (text) were added by hand (#144) and are not rebuilt.

import { pair14, pair15, pair16, pair17, pair18, pair19, type PairFiles } from './drawings.ts';
import { text13, text14, text15, text16, text17 } from './documents.ts';

export type CorpusKind = 'overlay' | 'text';

export interface GeneratedPair {
  kind: CorpusKind;
  id: string;
  folder: string;
  oldFile: string;
  newFile: string;
  /** Large speed files are built when a test asks for them, never committed. */
  atTestTime: boolean;
  build: () => PairFiles;
  /** Manifest columns 2 and 7–9 (type, size/layout, edge case, expected differences). */
  row: (f: Record<string, string>) => {
    type: string;
    layout: string;
    edge: string;
    expected: string;
  };
}

export const GENERATED_PAIRS: GeneratedPair[] = [
  {
    kind: 'overlay',
    id: '14',
    folder: 'pair_14_dense_a1_plot_plan',
    oldFile: '14_dense_a1_plot_plan_RevA_OLD.pdf',
    newFile: '14_dense_a1_plot_plan_RevB_NEW.pdf',
    atTestTime: false,
    build: pair14,
    row: (f) => ({
      type: 'Process Plant Layout',
      layout: 'A1 Landscape',
      edge: 'Dense Sheet: Tens of Thousands of Lines, Zero-Width Lines, Hatching, All Text as Curves',
      expected: `No text objects at all (every label is stroked geometry); ${f.pads ?? ''} hatched pads, ${f.tags ?? ''} curve tags, about ${f.segments ?? ''} line segments; background grid drawn with 0-width lines. Rev B: pad P-1310 moved 5 mm right on paper (zone ${f.padZone ?? ''}); tag P-1204 -> P-1204A (curves, zone ${f.tagZone ?? ''}); new 8-line rack branch (zone ${f.branchZone ?? ''}); hatched pad P-1505 removed (zone ${f.tankZone ?? ''}); title block Rev A -> B with a new revision row (curves).`,
    }),
  },
  {
    kind: 'overlay',
    id: '15',
    folder: 'pair_15_same_drawing_a1_a3',
    oldFile: '15_same_drawing_A1_RevA_OLD.pdf',
    newFile: '15_same_drawing_A3_RevB_NEW.pdf',
    atTestTime: false,
    build: pair15,
    row: (f) => ({
      type: 'Structural Framing',
      layout: 'A1 Landscape vs A3 Landscape',
      edge: 'Same Drawing Plotted at A1 and at A3 (Fit to Page)',
      expected: `NO content differences. Rev B is Rev A scaled by ${f.scale ?? ''} (fit to page) and offset ${f.tx ?? ''} pt x / ${f.ty ?? ''} pt y; pen widths stay absolute (lines relatively 2x heavier on A3), text scales with the sheet. Alignment must recover the scale; detection must report nothing.`,
    }),
  },
  {
    kind: 'overlay',
    id: '16',
    folder: 'pair_16_identical_control',
    oldFile: '16_identical_control_RevA_OLD.pdf',
    newFile: '16_identical_control_RevB_NEW.pdf',
    atTestTime: false,
    build: pair16,
    row: () => ({
      type: 'Structural Framing + Details',
      layout: 'A2 Landscape',
      edge: 'Fully Identical Pair (Zero-Diff Control, Different Files)',
      expected:
        'IDENTICAL page content on both sheets (plan with 0-width reference lines; connection details with hatching). Only the document information dates and the file identifier differ. Expected: zero differences, 0 % changed, both sheets reported unchanged.',
    }),
  },
  {
    kind: 'overlay',
    id: '17',
    folder: 'pair_17_set_removed_reordered',
    oldFile: '17_set_removed_reordered_RevA_OLD.pdf',
    newFile: '17_set_removed_reordered_RevB_NEW.pdf',
    atTestTime: false,
    build: pair17,
    row: () => ({
      type: 'Structural Drawing Set',
      layout: 'A3 Landscape',
      edge: 'Sheet Set: One Sheet Removed + Two Sheets Swapped',
      expected:
        'Rev A sheets S-101..S-106; Rev B order S-101, S-102, S-104, S-106, S-105. Expected pairing A1-B1, A2-B2, A3 removed (S-103 first floor framing), A4-B3, A5-B5, A6-B4. Only S-104 changed: beam C/4-5 W310x39 -> W410x60, bay 5-6/A-B hatched, title block Rev A -> B with a new revision row. S-101, S-102, S-105 and S-106 have zero differences.',
    }),
  },
  {
    kind: 'overlay',
    id: '18',
    folder: 'pair_18_title_block_only',
    oldFile: '18_title_block_only_RevC_OLD.pdf',
    newFile: '18_title_block_only_RevD_NEW.pdf',
    atTestTime: false,
    build: pair18,
    row: (f) => ({
      type: 'Structural Framing',
      layout: 'A1 Landscape',
      edge: 'Title-Block-Only Change (Drawing Area Identical)',
      expected: `Every difference is inside the title block (zones ${f.tbZone ?? ''}): Rev C -> D, date 2026-09-20 -> 2026-10-15, status FOR APPROVAL -> FOR CONSTRUCTION, approved '-' -> A.N., new revision row 'D 2026-10-15 ISSUED FOR CONSTRUCTION' (the table grows by one row). The drawing area has zero differences.`,
    }),
  },
  {
    kind: 'overlay',
    id: '19',
    folder: 'pair_19_review_comments_closeout',
    oldFile: '19_review_comments_RevA_OLD.pdf',
    newFile: '19_review_comments_RevB_NEW.pdf',
    atTestTime: false,
    build: pair19,
    row: (f) => ({
      type: 'Structural Framing (Checked Print)',
      layout: 'A3 Landscape',
      edge: 'Old Revision with Review Comments + See-Through Check Highlights; New Revision Addresses Some',
      expected: `Rev A carries checker comments (author R. Mehta): C1 cloud + callout 'beam B/2-3 overstressed, use W360x51' (zone ${f.c1 ?? ''}) -> Rev B W360x51 = ADDRESSED; C2 cloud 'opening bay 4-5/B-C increase to 1200x900' (zone ${f.c2 ?? ''}) -> Rev B 1200x600 = CHANGED DIFFERENTLY; C3 note 'bay 2-3 is 5000, architectural grid 5200' (zone ${f.c3 ?? ''}) -> unchanged = CARRIED OVER; C4 note 'confirm secondary beam spacing' with designer reply (zone ${f.c4 ?? ''}) -> unchanged = CARRIED OVER. Check highlights (yellow, multiply): marker along row A and line 1, highlight on the drawing number, area over the notes. Unrequested change in Rev B: bay 1-2/C-D hatched (zone ${f.stair ?? ''}); title block Rev A -> B. Rev B has no comments.`,
    }),
  },
  {
    kind: 'text',
    id: '13',
    folder: 'pair_13_header_rev_page_x_of_y',
    oldFile: '13_header_page_x_of_y_RevC_OLD.pdf',
    newFile: '13_header_page_x_of_y_RevD_NEW.pdf',
    atTestTime: false,
    build: text13,
    row: (f) => ({
      type: 'Pump Package Specification',
      layout: 'A4 Portrait',
      edge: "Running Header with Revision Letter + 'Page X of Y' Footer + Inserted Page",
      expected: `Header 'Rev C' -> 'Rev D' and footer 'Page X of ${f.oldPages ?? ''}' -> 'Page X of ${f.newPages ?? ''}' on EVERY page (header/footer change, not body text). Rev D inserts page ${f.annexPage ?? ''} 'Annex B Hydrostatic test record' (whole page added; later pages shift by one). Body edits: design pressure 16 -> 20 bar(g) (P${f.pressurePage ?? ''}); vibration limit 3.0 -> 2.8 mm/s (P${f.vibrationOld ?? ''} -> P${f.vibrationNew ?? ''}).`,
    }),
  },
  {
    kind: 'text',
    id: '14',
    folder: 'pair_14_hyphenation_ligatures_footnotes',
    oldFile: '14_hyphenation_ligatures_footnotes_RevA_OLD.pdf',
    newFile: '14_hyphenation_ligatures_footnotes_RevB_NEW.pdf',
    atTestTime: false,
    build: text14,
    row: () => ({
      type: 'Field Procedure',
      layout: 'A4 Portrait (Justified, Hyphenated)',
      edge: 'Line-End Hyphenation + fi/fl Ligature Glyphs + Numbered Footnotes',
      expected:
        "Justified text with words hyphenated at line ends; 'fi' and 'fl' drawn as ligature glyphs (no ToUnicode). Real edits: sentence inserted at the start of section 2 ('filtered to 25 µm', reflows the paragraph so different words are hyphenated); flow velocity 1.5 -> 2.0 m/s; new footnote 2 (spool pieces) renumbers old footnotes 2-3 to 3-4; footnote ISO 4406 code 17/15/12 -> 18/16/13; 'first fill' -> 'final fill'. NOT changes: section 3's second paragraph is set without ligatures in Rev B (same words); hyphen positions alone.",
    }),
  },
  {
    kind: 'text',
    id: '15',
    folder: 'pair_15_deleted_page',
    oldFile: '15_deleted_page_RevA_OLD.pdf',
    newFile: '15_deleted_page_RevB_NEW.pdf',
    atTestTime: false,
    build: text15,
    row: (f) => ({
      type: 'Method Statement',
      layout: 'A4 Portrait',
      edge: 'Deleted Page (One Whole Section Removed)',
      expected: `Rev A page ${f.deletedPage ?? ''} (section 4 'Temporary works' in full) is deleted in Rev B; later pages move up one and their footers renumber ('Page X'); header Rev A -> B. No other text changes (${f.oldPages ?? ''} -> ${f.newPages ?? ''} pages).`,
    }),
  },
  {
    kind: 'text',
    id: '16',
    folder: 'pair_16_merged_wrapped_table',
    oldFile: '16_merged_wrapped_table_RevA_OLD.pdf',
    newFile: '16_merged_wrapped_table_RevB_NEW.pdf',
    atTestTime: false,
    build: text16,
    row: (f) => ({
      type: 'Equipment List',
      layout: 'A4 Landscape',
      edge: 'Table with Merged Cells (Row and Column Spans) + Wrapped Cell Text + Repeating Header',
      expected: `Two-row header with 'Design conditions' spanning Pressure/Temp; item cells span their rows (${f.oldPages ?? ''} -> ${f.newPages ?? ''} pages, header repeats). Rev B: row P-101C added inside item 1 (its merged cells grow from 2 to 3 rows); P-101A remark wraps onto more lines ('Mechanical seal per API 682.' -> '... Category 2, Arrangement 2, with a Plan 53A barrier system.'); merged material cell of item 2 'Duplex 2205' -> 'Super duplex 2507'; E-201 design temperature 85 -> 95.`,
    }),
  },
  {
    kind: 'text',
    id: '17',
    folder: 'pair_17_contract_500_pages',
    oldFile: '17_contract_500p_Rev0_OLD.pdf',
    newFile: '17_contract_500p_Rev1_NEW.pdf',
    atTestTime: true,
    build: text17,
    row: (f) => ({
      type: 'EPC Contract (Speed)',
      layout: 'A4 Portrait',
      edge: '500-Page Contract for Speed + Buried Edits + Clause Insertion with Renumbering (GENERATED AT TEST TIME, not committed)',
      expected: `${f.oldPages ?? ''} -> ${f.newPages ?? ''} pages. Edits (page old->new): delay damages 0.5 % -> 0.75 % per week (P${f.ld ?? ''}); RFI response 28 -> 21 days (P${f.rfi ?? ''}); arbitration seat Singapore -> London (P${f.seat ?? ''}); liability 'shall not be liable' -> 'shall be liable' (P${f.liability ?? ''}); new clause 'Cyber security' inserted (Rev 1 P${f.inserted ?? ''}), renumbering the rest of its article. Everything else identical; reflow after the insertion only.`,
    }),
  },
];
