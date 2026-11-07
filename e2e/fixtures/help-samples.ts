// Self-made sample documents for Help's screenshots (M9, ADR-026; CLAUDE.md
// rule 13): a two-sheet engineering drawing and a short design report with a
// table and bookmarks. Generated at run time; nothing here is a real project.
import { deflateSync } from 'node:zlib';
import { buildPdf, type PdfObject } from './generate.ts';

const flate = (text: string): { dict: string; stream: string } => ({
  dict: '<< /Filter /FlateDecode >>',
  stream: deflateSync(Buffer.from(text, 'latin1')).toString('latin1'),
});

const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** Text at (x, y) in font /F1 (Helvetica) or /F2 (Helvetica-Bold). */
const text = (x: number, y: number, size: number, s: string, bold = false): string =>
  `BT /${bold ? 'F2' : 'F1'} ${String(size)} Tf ${String(x)} ${String(y)} Td (${esc(s)}) Tj ET\n`;

const rect = (x: number, y: number, w: number, h: number): string =>
  `${String(x)} ${String(y)} ${String(w)} ${String(h)} re S\n`;

const line = (x1: number, y1: number, x2: number, y2: number): string =>
  `${String(x1)} ${String(y1)} m ${String(x2)} ${String(y2)} l S\n`;

/** A circle by four Bézier curves. */
function circle(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  const p = (n: number) => n.toFixed(2);
  return (
    `${p(cx + r)} ${p(cy)} m ` +
    `${p(cx + r)} ${p(cy + k)} ${p(cx + k)} ${p(cy + r)} ${p(cx)} ${p(cy + r)} c ` +
    `${p(cx - k)} ${p(cy + r)} ${p(cx - r)} ${p(cy + k)} ${p(cx - r)} ${p(cy)} c ` +
    `${p(cx - r)} ${p(cy - k)} ${p(cx - k)} ${p(cy - r)} ${p(cx)} ${p(cy - r)} c ` +
    `${p(cx + k)} ${p(cy - r)} ${p(cx + r)} ${p(cy - k)} ${p(cx + r)} ${p(cy)} c S\n`
  );
}

/** A horizontal dimension with ticks and its value above. */
function dimH(x1: number, x2: number, y: number, label: string): string {
  return (
    '0.4 w\n' +
    line(x1, y, x2, y) +
    line(x1, y - 4, x1, y + 4) +
    line(x2, y - 4, x2, y + 4) +
    text((x1 + x2) / 2 - label.length * 2.6, y + 3, 9, label)
  );
}

function dimV(x: number, y1: number, y2: number, label: string): string {
  return (
    '0.4 w\n' +
    line(x, y1, x, y2) +
    line(x - 4, y1, x + 4, y1) +
    line(x - 4, y2, x + 4, y2) +
    `BT /F1 9 Tf 0 1 -1 0 ${String(x - 3)} ${String((y1 + y2) / 2 - label.length * 2.6)} Tm (${esc(label)}) Tj ET\n`
  );
}

const A3 = { w: 1191, h: 842 };

function frameAndTitle(sheet: string, title: string, no: string): string {
  let s = '1.2 w\n' + rect(20, 20, A3.w - 40, A3.h - 40);
  // Title block, bottom right.
  const x = A3.w - 360;
  s += '0.8 w\n' + rect(x, 20, 340, 110);
  s += line(x, 90, x + 340, 90) + line(x, 60, x + 340, 60) + line(x + 220, 20, x + 220, 60);
  s += text(x + 10, 105, 9, 'TRIYA PDF SAMPLE PROJECT');
  s += text(x + 10, 70, 14, title, true);
  s += text(x + 10, 40, 9, 'Drawing no.');
  s += text(x + 70, 40, 11, no, true);
  s += text(x + 230, 40, 9, 'Rev');
  s += text(x + 255, 40, 11, 'B', true);
  s += text(x + 290, 40, 9, sheet);
  // Grid references.
  ['1', '2', '3', '4', '5', '6'].forEach((n, i) => {
    s += text(20 + ((A3.w - 40) / 6) * (i + 0.5), A3.h - 34, 10, n);
  });
  ['A', 'B', 'C', 'D'].forEach((n, i) => {
    s += text(28, A3.h - 20 - ((A3.h - 40) / 4) * (i + 0.5), 10, n);
  });
  return s;
}

/** 1 mm on site at 1:100, in points (2.8346 pt per paper millimetre). */
const MM = 72 / 25.4 / 100;

function planSheet(): string {
  let s = frameAndTitle('Sheet 1 of 2', 'Pump station - plan', 'TP-101');
  s += text(80, 770, 16, 'PLAN VIEW', true);
  s += text(80, 752, 10, 'Scale 1:100 (A3)');
  // Building 22000 x 15000: pump hall and control room 10000 wide, valve chamber 12000.
  const x0 = 120;
  const y0 = 260;
  const W = 22000 * MM;
  const H = 15000 * MM;
  const xWall = x0 + 10000 * MM;
  const yWall = y0 + 6000 * MM;
  s += '2 w\n' + rect(x0, y0, W, H);
  s += '1.2 w\n' + line(xWall, y0, xWall, y0 + H) + line(x0, yWall, xWall, yWall);
  s += text(200, 650, 12, 'PUMP HALL', true);
  s += text(200, 380, 12, 'CONTROL ROOM', true);
  s += text(510, 650, 12, 'VALVE CHAMBER', true);
  // Pumps.
  s += '1 w\n' + circle(220, 580, 28) + circle(330, 580, 28);
  s += text(205, 576, 10, 'P-01') + text(315, 576, 10, 'P-02');
  // Pipes.
  s += '3 w\n' + line(248, 580, 302, 580) + line(358, 580, 520, 580) + line(520, 580, 520, 360);
  s += line(520, 360, x0 + W, 360);
  s += '1 w\n' + rect(500, 560, 40, 40) + text(546, 590, 9, 'V-11');
  s += rect(600, 340, 40, 40) + text(646, 370, 9, 'V-12');
  // Door and window.
  s += '0.8 w\n' + line(240, y0, 290, y0 + 40) + rect(560, y0 + H - 4, 120, 8);
  // Dimensions.
  s += dimH(x0, x0 + W, 225, '22000') + dimH(x0, xWall, y0 + H + 30, '10000');
  s += dimH(xWall, x0 + W, y0 + H + 30, '12000');
  s += dimV(85, y0, y0 + H, '15000') + dimV(x0 + W + 40, y0, yWall, '6000');
  // Notes.
  s += text(860, 700, 12, 'NOTES', true);
  [
    '1. All dimensions in millimetres.',
    '2. Pumps P-01 and P-02: duty and standby.',
    '3. Valves V-11 and V-12: DN150 gate valves.',
    '4. Floor level +0.150 above finished ground.',
    '5. Do not scale from this drawing.',
  ].forEach((n, i) => {
    s += text(860, 680 - i * 16, 9, n);
  });
  return s;
}

function sectionSheet(): string {
  let s = frameAndTitle('Sheet 2 of 2', 'Pump station - section', 'TP-102');
  s += text(80, 770, 16, 'SECTION A-A', true);
  s += text(80, 752, 10, 'Scale 1:100 (A3)');
  s += '2 w\n' + line(100, 300, 820, 300) + rect(160, 300, 600, 320);
  s += '1.2 w\n' + line(140, 620, 460, 700) + line(460, 700, 780, 620);
  s += '1 w\n' + rect(220, 300, 120, 80) + rect(400, 300, 120, 80);
  s += text(250, 336, 10, 'P-01') + text(430, 336, 10, 'P-02');
  s += '3 w\n' + line(340, 360, 400, 360) + line(520, 360, 700, 360) + line(700, 360, 700, 300);
  s += dimH(160, 760, 260, '16000') + dimV(120, 300, 620, '4200');
  s += text(860, 700, 12, 'DETAIL 1', true);
  s += '1 w\n' + rect(860, 520, 220, 160) + circle(970, 600, 50) + text(945, 596, 10, 'DN150');
  return s;
}

/**
 * A two-sheet engineering drawing (landscape A3): plan and section of a small
 * pump station, with a title block, grid, dimensions and notes, and an outline.
 */
export function helpDrawingPdf(): Uint8Array {
  const page = (contents: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(A3.w)} ${String(A3.h)}] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents ${String(contents)} 0 R >>`;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    page(4),
    flate(planSheet()),
    page(6),
    flate(sectionSheet()),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Outlines /First 10 0 R /Last 10 0 R /Count 3 >>',
    '<< /Title (Pump station TP-101) /Parent 9 0 R /First 11 0 R /Last 12 0 R /Count 2 /Dest [3 0 R /Fit] >>',
    '<< /Title (Plan view) /Parent 10 0 R /Next 12 0 R /Dest [3 0 R /Fit] >>',
    '<< /Title (Section A-A) /Parent 10 0 R /Prev 11 0 R /Dest [5 0 R /Fit] >>',
  ];
  return buildPdf(objs);
}

const REPORT_TEXT = [
  'This report describes the upgrade of the pump station at the sample site. The',
  'existing pumps are replaced by two new duty and standby units, and the valve',
  'chamber is rebuilt to give safe access for maintenance. The design follows the',
  'client brief and the relevant standards, and was reviewed by the project team.',
];

function reportPage(n: number): string {
  let s =
    text(72, 800, 9, 'Pump Station Upgrade - Design Report') +
    text(500, 800, 9, `Page ${String(n)}`);
  s += '0.5 w\n' + line(72, 792, 523, 792);
  if (n === 1) {
    s += text(72, 720, 24, 'Pump Station Upgrade', true);
    s += text(72, 690, 14, 'Design Report, revision B');
    s += text(72, 640, 16, '1  Introduction', true);
    REPORT_TEXT.forEach((l, i) => (s += text(72, 612 - i * 16, 11, l)));
    s += text(72, 520, 16, '2  Design basis', true);
    [
      'The design flow is 120 litres per second at a total head of 32 metres. Each pump',
      'can deliver the full design flow. The station runs unattended, with alarms sent',
      'to the control centre. Power comes from the existing 400 V supply.',
    ].forEach((l, i) => (s += text(72, 492 - i * 16, 11, l)));
    s += text(72, 420, 13, '2.1  Hydraulics', true);
    [
      'Pipework is DN150 ductile iron. Velocities stay below 2 metres per second in',
      'every operating case, so surge protection is not required.',
    ].forEach((l, i) => (s += text(72, 396 - i * 16, 11, l)));
  } else if (n === 2) {
    s += text(72, 740, 16, '3  Equipment schedule', true);
    const cols = [72, 140, 300, 390, 460, 523];
    const rows = [
      ['Tag', 'Description', 'Rating', 'Size', 'Qty'],
      ['P-01', 'Duty pump', '45 kW', 'DN150', '1'],
      ['P-02', 'Standby pump', '45 kW', 'DN150', '1'],
      ['V-11', 'Gate valve', 'PN16', 'DN150', '2'],
      ['V-12', 'Check valve', 'PN16', 'DN150', '2'],
      ['FM-1', 'Flow meter', '0-150 l/s', 'DN150', '1'],
      ['LT-1', 'Level sensor', '0-5 m', '-', '1'],
    ];
    const top = 710;
    const h = 24;
    s += '0.8 w\n';
    for (let r = 0; r <= rows.length; r++) s += line(cols[0] ?? 72, top - r * h, 523, top - r * h);
    for (const c of cols) s += line(c, top, c, top - rows.length * h);
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        s += text((cols[c] ?? 72) + 6, top - r * h - 16, 10, cell, r === 0);
      });
    });
    s += text(72, 500, 16, '4  Conclusions', true);
    [
      'The upgrade gives the station the capacity it needs for the next 25 years. The',
      'drawings TP-101 and TP-102 show the layout. Comments on this report are welcome',
      'before the design is issued for construction.',
    ].forEach((l, i) => (s += text(72, 472 - i * 16, 11, l)));
  } else {
    s += text(72, 740, 16, 'Appendix A  Review comments', true);
    s += text(72, 712, 11, 'Reviewers add their comments to this page.');
  }
  return s;
}

/** A three-page A4 design report with headings, an equipment table and bookmarks. */
export function helpReportPdf(): Uint8Array {
  const page = (contents: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 9 0 R /F2 10 0 R >> >> /Contents ${String(contents)} 0 R >>`;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 11 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    page(4),
    flate(reportPage(1)),
    page(6),
    flate(reportPage(2)),
    page(8),
    flate(reportPage(3)),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Outlines /First 12 0 R /Last 16 0 R /Count 5 >>',
    '<< /Title (1 Introduction) /Parent 11 0 R /Next 13 0 R /Dest [3 0 R /XYZ 0 660 null] >>',
    '<< /Title (2 Design basis) /Parent 11 0 R /Prev 12 0 R /Next 15 0 R /First 14 0 R /Last 14 0 R /Count 1 /Dest [3 0 R /XYZ 0 540 null] >>',
    '<< /Title (2.1 Hydraulics) /Parent 13 0 R /Dest [3 0 R /XYZ 0 440 null] >>',
    '<< /Title (3 Equipment schedule) /Parent 11 0 R /Prev 13 0 R /Next 16 0 R /Dest [5 0 R /XYZ 0 760 null] >>',
    '<< /Title (4 Conclusions) /Parent 11 0 R /Prev 15 0 R /Dest [5 0 R /XYZ 0 520 null] >>',
  ];
  return buildPdf(objs);
}

/** A one-page A4 site inspection form: text fields, a dropdown, check boxes and a radio group. */
export function helpFormPdf(): Uint8Array {
  const FX = 200;
  const FW = 323;
  let page = text(72, 770, 20, 'Site Inspection Record', true);
  page += text(72, 748, 11, 'Pump Station Upgrade - monthly check, form IR-3');
  page += '0.5 w\n' + line(72, 736, 523, 736);
  const labels: [number, string][] = [
    [697, 'Inspector'],
    [657, 'Date'],
    [617, 'Location'],
    [567, 'Pump condition'],
    [513, 'Checks'],
    [403, 'Result'],
    [363, 'Remarks'],
  ];
  for (const [y, l] of labels) page += text(72, y, 11, l, true);
  page += text(FX + 24, 513, 11, 'Valves exercised');
  page += text(FX + 24, 483, 11, 'Alarms tested');
  page += text(FX + 24, 453, 11, 'Standby pump run');
  page += text(FX + 24, 403, 11, 'Pass');
  page += text(FX + 104, 403, 11, 'Fail');
  const tx = (name: string, tu: string, y: number, h = 24, ff = 0, ap = 18) =>
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /TU (${tu}) /Ff ${String(ff)} /DA (/Helv 11 Tf 0 g) /Rect [${String(FX)} ${String(y)} ${String(FX + FW)} ${String(y + h)}] /F 4 /P 3 0 R /MK << /BC [0.6 0.6 0.6] >> /AP << /N ${String(ap)} 0 R >> >>`;
  const cb = (name: string, tu: string, y: number) =>
    `<< /Type /Annot /Subtype /Widget /FT /Btn /T (${name}) /TU (${tu}) /V /Off /AS /Off /Rect [${String(FX)} ${String(y)} ${String(FX + 16)} ${String(y + 16)}] /F 4 /P 3 0 R /MK << /CA (4) >> /AP << /N << /Yes 19 0 R /Off 20 0 R >> >> >>`;
  const radio = (x: number, state: string) =>
    `<< /Type /Annot /Subtype /Widget /Parent 14 0 R /AS /Off /Rect [${String(x)} 400 ${String(x + 16)} 416] /F 4 /P 3 0 R /MK << /CA (l) >> /AP << /N << /${state} 19 0 R /Off 20 0 R >> >> >>`;
  const box = (w: number, h: number, body: string): PdfObject => ({
    dict: `<< /Type /XObject /Subtype /Form /BBox [0 0 ${String(w)} ${String(h)}] /Resources << /Font << /Helv 5 0 R >> >> >>`,
    stream: body,
  });
  const fields = [7, 8, 9, 10, 11, 12, 13, 14, 17].map((n) => `${String(n)} 0 R`).join(' ');
  const annots = [7, 8, 9, 10, 11, 12, 13, 15, 16, 17].map((n) => `${String(n)} 0 R`).join(' ');
  const objs: PdfObject[] = [
    `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [${fields}] /DA (/Helv 11 Tf 0 g) /DR << /Font << /Helv 5 0 R >> >> >> >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R /Helv 5 0 R >> >> /Contents 4 0 R /Annots [${annots}] >>`,
    flate(page),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    tx('inspector', 'Inspector', 690),
    tx('date', 'Date', 650),
    tx('location', 'Location', 610),
    `<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (condition) /TU (Pump condition) /Opt [(Good) (Fair) (Poor)] /DA (/Helv 11 Tf 0 g) /Rect [${String(FX)} 560 ${String(FX + 160)} 584] /F 4 /P 3 0 R /MK << /BC [0.6 0.6 0.6] >> /AP << /N 22 0 R >> >>`,
    cb('valves', 'Valves exercised', 510),
    cb('alarms', 'Alarms tested', 480),
    cb('standby', 'Standby pump run', 450),
    '<< /FT /Btn /Ff 49152 /T (result) /TU (Result) /Kids [15 0 R 16 0 R] >>',
    radio(FX, 'Pass'),
    radio(FX + 80, 'Fail'),
    tx('remarks', 'Remarks', 290, 90, 4096, 21),
    box(FW, 24, '/Tx BMC EMC'),
    box(16, 16, '0 g 1 w 0.5 0.5 15 15 re S 3 8 m 7 3 l 13 13 l S'),
    box(16, 16, '0 g 1 w 0.5 0.5 15 15 re S'),
    box(FW, 90, '/Tx BMC EMC'),
    box(160, 24, '/Tx BMC EMC'),
  ];
  return buildPdf(objs);
}
