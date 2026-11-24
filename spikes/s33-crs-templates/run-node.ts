// Spike S33 (M13-06, D-71): project CRS templates with ExcelJS, in Node.
// Makes the self-made templates, checks what survives a load and write, runs
// the fills (pre-drawn rows, inserted rows, sheet copies per page and per
// document, pictures), times 2,000 rows, and opens every result in
// LibreOffice (PDF + recalculated copy) and openpyxl when they are installed.
//
//   node --expose-gc --import ./spikes/shared/ts-ext.ts spikes/s33-crs-templates/run-node.ts
//
// Writes spikes/s33-crs-templates/out/ (templates/, results/, lo/, s33-results.json).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { checkWorkbook, inventory } from './check';
import { workbookKind } from './detect';
import { keepWidth9, sheetName } from './engine';
import { commentsA, commentsB, fillGroups, fillOne, load, specA, specB, write } from './scenarios';
import { A, asXlsm, asXltx, B, fakeXls, templateA, templateB, withTextBox } from './templates';

const here = new URL('.', import.meta.url).pathname;
const OUT = `${here}out`;
const T = `${OUT}/templates`;
const R = `${OUT}/results`;
rmSync(OUT, { recursive: true, force: true });
for (const d of [T, R]) mkdirSync(d, { recursive: true });
const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const results: Record<string, unknown> = { exceljs: '4.4.0', date: new Date().toISOString() };
const sheetXml = (b: Uint8Array, n = 1) =>
  strFromU8(unzipSync(b)[`xl/worksheets/sheet${String(n)}.xml`] ?? new Uint8Array());
const ms = (t0: number) => Math.round(performance.now() - t0);
const gc = () => (globalThis as { gc?: () => void }).gc?.();

// 1. Templates -------------------------------------------------------------
const tA = await templateA(ExcelJS);
const tB = await templateB(ExcelJS);
const templates: Record<string, Uint8Array> = {
  'A-project-form.xlsx': tA,
  'B-one-row-form.xlsx': tB,
  'A-project-form.xltx': asXltx(tA),
  'A-project-form.xlsm': asXlsm(tA),
  'old-binary.xls': fakeXls(),
  'A-with-text-box.xlsx': withTextBox(tA),
};
if (has('python3')) {
  const p = spawnSync('python3', ['-I', `${here}rich_template.py`, `${T}/C-rich-parts.xlsx`]);
  if (p.status === 0) {
    templates['C-rich-parts.xlsx'] = readFileSync(`${T}/C-rich-parts.xlsx`);
    templates['C-rich-parts-default-ns.xlsx'] = readFileSync(`${T}/C-rich-parts-default-ns.xlsx`);
  } else results.richTemplate = `skipped: ${p.stderr.toString().slice(0, 200)}`;
}
for (const [n, b] of Object.entries(templates)) writeFileSync(`${T}/${n}`, b);

// 2. What kind of file ------------------------------------------------------
results.kinds = Object.fromEntries(Object.entries(templates).map(([n, b]) => [n, workbookKind(b)]));

// Does ExcelJS load it at all?
const loads: Record<string, string> = {};
for (const [n, b] of Object.entries(templates)) {
  try {
    await new ExcelJS.Workbook().xlsx.load(b.slice().buffer);
    loads[n] = 'loads';
  } catch (e) {
    loads[n] = `load fails: ${(e as Error).message.slice(0, 80)}`;
  }
}
results.loads = loads;

// 3. What survives a plain load and write (nothing filled) -------------------
const survival: Record<string, unknown> = {};
for (const n of [
  'A-project-form.xlsx',
  'A-project-form.xltx',
  'A-with-text-box.xlsx',
  'C-rich-parts.xlsx',
  'A-project-form.xlsm',
]) {
  const src = templates[n];
  if (!src) continue;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(src.slice().buffer); // straight ExcelJS, even for .xlsm (to see what it drops)
  const raw = new Uint8Array(await wb.xlsx.writeBuffer());
  // The same with the spike's fixes (width 9 kept from the load on, drop-down
  // ranges, recalculation), loaded afresh.
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(src.slice().buffer);
  for (const ws of wb2.worksheets) keepWidth9(ws);
  const fixed = await write(wb2);
  const before = inventory(src);
  const after = inventory(fixed);
  const lost = Object.fromEntries(
    Object.keys(before)
      .filter((k) => (before[k] ?? 0) !== (after[k] ?? 0))
      .map((k) => [k, `${String(before[k])} → ${String(after[k])}`]),
  );
  const plainAfter = inventory(raw);
  survival[n] = {
    changed: lost,
    changedPlainExcelJS: Object.fromEntries(
      Object.keys(before)
        .filter((k) => (before[k] ?? 0) !== (plainAfter[k] ?? 0))
        .map((k) => [k, `${String(before[k])} → ${String(plainAfter[k])}`]),
    ),
    problemsPlainExcelJS: checkWorkbook(raw),
    problemsWithFixes: checkWorkbook(fixed),
  };
  writeFileSync(`${R}/roundtrip-${n.replace(/\.\w+$/u, '')}.xlsx`, fixed);
}
results.survival = survival;

// 4. Fills -------------------------------------------------------------------
const fills: Record<string, unknown> = {};
const save = (name: string, bytes: Uint8Array, extra: Record<string, unknown>) => {
  writeFileSync(`${R}/${name}.xlsx`, bytes);
  fills[name] = { ...extra, bytes: bytes.length, problems: checkWorkbook(bytes) };
};
{
  const r = await fillOne(ExcelJS, tA, A.sheet, specA(), commentsA(10));
  save('A-10-fits-pre-drawn', r.bytes, { result: r.result });
}
{
  const r = await fillOne(ExcelJS, tA, A.sheet, specA(), commentsA(40));
  save('A-40-inserted-rows', r.bytes, { result: r.result });
}
{
  const r = await fillOne(ExcelJS, asXltx(tA), A.sheet, specA(), commentsA(18));
  save('A-18-from-xltx', r.bytes, { result: r.result, kind: workbookKind(r.bytes) });
}
{
  const r = await fillOne(ExcelJS, tB, B.sheet, specB(), commentsB(12));
  save('B-12-one-start-row', r.bytes, { result: r.result });
}
{
  const r = await fillOne(ExcelJS, tB, B.sheet, specB(), commentsB(1));
  save('B-1-no-insert', r.bytes, { result: r.result });
}
{
  // One sheet per commented page (C5): page labels, one forbidden, one long, one repeated.
  const pages = [
    { name: 'A-101', rows: commentsA(5, 1) },
    { name: 'B:102/Section*?', rows: commentsA(30, 2) },
    { name: 'GA drawing – nozzle orientation detail sheet 3', rows: commentsA(1, 3, 1) },
    { name: 'a-101', rows: commentsA(3, 4) },
    { name: 'History', rows: commentsA(2, 5) },
  ];
  const r = await fillGroups(ExcelJS, tA, A.sheet, pages, () => specA());
  save('A-per-page', r.bytes, {
    names: r.names,
    results: r.results.map((x) => ({ inserted: x.inserted, rows: x.rows })),
  });
}
{
  // One sheet per document (C15), each with its own detail cells.
  const docs = [
    {
      name: 'PA-1200-ME-DWG-0042_RevB pump skid GA',
      rows: commentsA(8, 1),
      details: {
        [A.details.docNo]: 'PA-1200-ME-DWG-0042',
        [A.details.rev]: 'B',
        [A.details.title]: 'Pump skid GA',
      },
    },
    {
      name: 'PA-1200-PI-DWG-0107_Rev0 isometric',
      rows: commentsA(22, 1),
      details: {
        [A.details.docNo]: 'PA-1200-PI-DWG-0107',
        [A.details.rev]: '0',
        [A.details.title]: 'Isometric line 6"-P-1007',
      },
    },
  ];
  const r = await fillGroups(ExcelJS, tA, A.sheet, docs, () => specA());
  save('A-per-document', r.bytes, {
    names: r.names,
    results: r.results.map((x) => ({ inserted: x.inserted, rows: x.rows })),
  });
}
{
  // The text-box template: filled; the shape is lost (see survival).
  const r = await fillOne(
    ExcelJS,
    templates['A-with-text-box.xlsx'] ?? tA,
    A.sheet,
    specA(),
    commentsA(20),
  );
  save('A-20-text-box-template', r.bytes, { result: r.result });
}
{
  // For the record: ExcelJS's own insertRows (style 'i') on the same template.
  const wb = await load(ExcelJS, tA);
  const ws = wb.getWorksheet(A.sheet);
  if (!ws) throw new Error('no sheet');
  ws.insertRows(
    A.lastPreDrawn + 1,
    Array.from({ length: 25 }, () => []),
    'i',
  );
  const raw = new Uint8Array(await wb.xlsx.writeBuffer());
  const m = ws.model as unknown as { pageSetup: { printArea?: string } };
  writeFileSync(`${R}/naive-exceljs-insertRows.xlsx`, raw);
  const formulas = (b: Uint8Array) => (sheetXml(b).match(/<f>/gu) ?? []).length;
  fills['naive-exceljs-insertRows'] = {
    problems: checkWorkbook(raw),
    mergesInFile: [...sheetXml(raw).matchAll(/<mergeCell ref="(A5\d:[A-K]\d+)"/gu)].map(
      (x) => x[1],
    ),
    printArea: m.pageSetup.printArea,
    formulaCells: `${String(formulas(tA))} → ${String(formulas(raw))}`,
    totalFormulaK4: ws.getCell('K4').formula,
    newRow30: {
      daysOpenFormula: (ws.getCell('K30').formula as string | undefined) ?? null,
      statusDropDown:
        (ws.getCell('I30').dataValidation as ExcelJS.DataValidation | undefined)?.type ?? null,
      borderE30:
        (ws.getCell('E30').border as Partial<ExcelJS.Borders> | undefined)?.left?.style ?? null,
    },
  };
}
{
  // ExcelJS squeezes per-cell drop-downs into ranges after sorting the cells
  // as text: a range crossing row 9→10 is written twice, overlapping.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DV');
  for (let r = 5; r <= 14; r++)
    ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
  const raw = new Uint8Array(await wb.xlsx.writeBuffer());
  const fixed = await write(wb);
  writeFileSync(`${R}/dv-rows-5-14-plain-exceljs.xlsx`, raw);
  fills['dv-text-sort'] = {
    plain: {
      sqref: [...sheetXml(raw).matchAll(/sqref="([^"]+)"/gu)].map((x) => x[1]),
      problems: checkWorkbook(raw),
    },
    withFix: {
      sqref: [...sheetXml(fixed).matchAll(/sqref="([^"]+)"/gu)].map((x) => x[1]),
      problems: checkWorkbook(fixed),
    },
  };
}
results.fills = fills;

// 5. Sheet names --------------------------------------------------------------
const names = [
  'A-101',
  'B:102/Section*?',
  "'quoted'",
  '[draft]',
  'x'.repeat(40),
  'History',
  'history',
  '',
];
const taken = new Set<string>();
results.sheetNames = names.map((n) => {
  const out = sheetName(n, taken);
  taken.add(out.toLowerCase());
  let exceljs: string;
  try {
    const ws = new ExcelJS.Workbook().addWorksheet(n);
    exceljs = `accepted as "${ws.name}"`;
  } catch (e) {
    exceljs = `throws: ${(e as Error).message.slice(0, 60)}`;
  }
  return { input: n, ours: out, exceljs };
});

// 6. Time and memory: 2,000 rows -------------------------------------------------
const perf: Record<string, unknown> = {};
async function timed(label: string, run: () => Promise<Uint8Array>) {
  gc();
  const heap0 = process.memoryUsage().heapUsed;
  let peak = heap0;
  const tick = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 5);
  const t0 = performance.now();
  const bytes = await run();
  const total = ms(t0);
  clearInterval(tick);
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  writeFileSync(`${R}/${label}.xlsx`, bytes);
  perf[label] = {
    ms: total,
    heapPeakMB: Math.round((peak - heap0) / 1e6),
    rssMB: Math.round(process.memoryUsage().rss / 1e6),
    fileMB: Math.round(bytes.length / 1e4) / 100,
    problems: checkWorkbook(bytes).length,
  };
}
const phases: Record<string, number> = {};
await timed('perf-2000-rows-200-pictures', async () => {
  let t = performance.now();
  const wb = await load(ExcelJS, tA);
  phases.load = ms(t);
  const ws = wb.getWorksheet(A.sheet);
  if (!ws) throw new Error('no sheet');
  t = performance.now();
  const { fillSheet } = await import('./engine');
  fillSheet(wb, ws, specA(), commentsA(2000, 1, 10));
  phases.fill = ms(t);
  t = performance.now();
  const b = await write(wb);
  phases.write = ms(t);
  return b;
});
perf.phases2000 = phases;
await timed(
  'perf-2000-rows-no-pictures',
  async () => (await fillOne(ExcelJS, tA, A.sheet, specA(), commentsA(2000, 1, 0))).bytes,
);
await timed(
  'perf-2000-rows-2000-pictures',
  async () => (await fillOne(ExcelJS, tA, A.sheet, specA(), commentsA(2000, 1, 1))).bytes,
);
await timed('perf-2000-rows-50-sheets', async () => {
  const groups = Array.from({ length: 50 }, (_, g) => ({
    name: `Page ${String(g + 1)}`,
    rows: commentsA(40, g + 1, 10),
  }));
  return (await fillGroups(ExcelJS, tA, A.sheet, groups, () => specA())).bytes;
});
results.perf = perf;

// 7. Other readers ----------------------------------------------------------------
const files = readdirSync(R).filter((f) => f.endsWith('.xlsx'));
if (has('soffice')) {
  mkdirSync(`${OUT}/lo`, { recursive: true });
  mkdirSync(`${OUT}/lo-xlsx`, { recursive: true });
  const sample = files.filter((f) => !f.startsWith('perf-'));
  const t0 = performance.now();
  execFileSync(
    'soffice',
    [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      `${OUT}/lo`,
      ...sample.map((f) => `${R}/${f}`),
    ],
    { stdio: 'ignore' },
  );
  execFileSync(
    'soffice',
    [
      '--headless',
      '--convert-to',
      'xlsx',
      '--outdir',
      `${OUT}/lo-xlsx`,
      ...sample.map((f) => `${R}/${f}`),
    ],
    { stdio: 'ignore' },
  );
  const lo: Record<string, unknown> = { ms: ms(t0) };
  for (const f of sample) {
    const pdf = `${OUT}/lo/${f.replace(/\.xlsx$/u, '.pdf')}`;
    const pages =
      existsSync(pdf) && has('pdfinfo')
        ? Number(/Pages:\s+(\d+)/u.exec(execFileSync('pdfinfo', [pdf]).toString())?.[1] ?? 0)
        : existsSync(pdf)
          ? -1
          : 0;
    lo[f] = { pdfPages: pages };
    if (pages && has('pdftoppm'))
      execFileSync('pdftoppm', [
        '-r',
        '60',
        '-png',
        '-f',
        '1',
        '-l',
        '1',
        pdf,
        pdf.replace(/\.pdf$/u, ''),
      ]);
  }
  // Formulas after LibreOffice worked them out again: totals and references must follow the rows.
  const calc: Record<string, unknown> = {};
  for (const f of [
    'A-40-inserted-rows.xlsx',
    'B-12-one-start-row.xlsx',
    'A-per-page.xlsx',
    'A-per-document.xlsx',
  ]) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(readFileSync(`${OUT}/lo-xlsx/${f}`)).buffer);
    const res = (s: string, a: string) => {
      const c = wb.getWorksheet(s)?.getCell(a);
      const v = c?.value as { result?: unknown } | null | undefined;
      return v && typeof v === 'object' && 'result' in v ? v.result : (v ?? null);
    };
    calc[f] = Object.fromEntries(
      wb.worksheets.flatMap((ws) =>
        ws.name === 'Lists'
          ? []
          : ws.name === 'Notes'
            ? [[`${ws.name}!A3`, res(ws.name, 'A3')]]
            : ws.name === B.sheet
              ? [
                  [
                    `${ws.name}!C${String(B.totalsRow + 11)}`,
                    res(ws.name, `C${String(B.totalsRow + 11)}`),
                  ],
                ]
              : [
                  [`${ws.name}!K4 total`, res(ws.name, 'K4')],
                  [`${ws.name}!K6 open`, res(ws.name, 'K6')],
                  [`${ws.name}!K10 days open`, res(ws.name, 'K10')],
                ],
      ),
    );
  }
  lo.recalculated = calc;
  results.libreoffice = lo;
} else results.libreoffice = 'skipped (no soffice)';

if (has('python3')) {
  const py = `
import json, sys, warnings, openpyxl
out = {}
for f in sys.argv[1:]:
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        try:
            wb = openpyxl.load_workbook(f)
            out[f.split("/")[-1]] = {"sheets": wb.sheetnames, "warnings": sorted({str(x.message)[:90] for x in w})}
        except Exception as e:
            out[f.split("/")[-1]] = {"error": str(e)[:200]}
print(json.dumps(out))
`;
  const p = spawnSync('python3', [
    '-I',
    '-c',
    py,
    ...files.filter((f) => !f.startsWith('perf-')).map((f) => `${R}/${f}`),
  ]);
  results.openpyxl =
    p.status === 0 ? JSON.parse(p.stdout.toString()) : p.stderr.toString().slice(0, 300);
} else results.openpyxl = 'skipped (no python3)';

writeFileSync(`${OUT}/s33-results.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
