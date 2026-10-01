import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { hasQpdf, OWNER_PW, qpdfEncrypt, USER_PW } from './fixtures/encrypted.ts';
import { extractionFixture } from './fixtures/extraction.ts';
import { buildPdf, simplePdf, type PdfObject } from './fixtures/generate.ts';
import { adversarialPdf } from './fixtures/redaction.ts';
import { tablesPdf } from './fixtures/tables.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';

// M4-22: the interop pack §M4 (e2e/interop/CHECKLIST.md §M4, ADR-001 B16):
// files made by the real app — page operations saved with Ctrl+S, a merge,
// /Redact marks, redacted outputs (plain and AES-256), a Word export, table
// and annotation workbooks, and comments transferred from Rev A to Rev B —
// each checked with qpdf where it is a PDF. With M4_INTEROP_OUT=1 they are
// written to OUT for the owner's run in Acrobat Reader and PDF-XChange.

const OUT = 'e2e/fixtures/self-made/m4-interop';
const REDACT = 28;
const SQUARE = 5;
const TEXT = 1;
const HIGHLIGHT = 9;
const RED = '#E44234';
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const rect = (x: number, y: number, w: number, h: number) => ({
  origin: { x, y },
  size: { width: w, height: h },
});

function qpdfStatus(bytes: Uint8Array, password?: string): number | null | 'absent' {
  if (!hasQpdf()) return 'absent';
  const file = join(mkdtempSync(join(tmpdir(), 'pdftools-m4-interop-')), 'f.pdf');
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', ...(password ? [`--password=${password}`] : []), file])
    .status;
}

function keep(name: string, bytes: Uint8Array): void {
  if (process.env.M4_INTEROP_OUT !== '1') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
}

/** Pages of distinct widths, each labelled "Sheet <n>". */
function sheets(n: number, label = 'Sheet'): Uint8Array {
  const objs: PdfObject[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const font = 3 + n * 2;
  const kids: string[] = [];
  for (let i = 0; i < n; i++) {
    kids.push(`${String(3 + i * 2)} 0 R`);
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      { dict: '<< >>', stream: `BT /F1 36 Tf 72 740 Td (${label} ${String(i + 1)}) Tj ET` },
    );
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(n)} >>`;
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objs);
}

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await cap(page, 'annotate', 'setProfile', 'PDFTools Interop');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

async function save(page: Page, id: string, original: Uint8Array): Promise<Buffer> {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  const file = Buffer.concat([Buffer.from(original), Buffer.from(s.tail, 'base64')]);
  expect([0, 3, 'absent']).toContain(qpdfStatus(file));
  return file;
}

/** The next showOpenFilePicker call returns these files. */
async function stubOpenPicker(page: Page, files: { name: string; b64: string }[]) {
  await page.evaluate((list) => {
    const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
    w.showOpenFilePicker = () =>
      Promise.resolve(
        list.map((f) => {
          const bin = atob(f.b64);
          const file = new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], f.name, {
            type: 'application/pdf',
          });
          return { kind: 'file', name: f.name, getFile: () => Promise.resolve(file) };
        }),
      );
  }, files);
}

test('M4 interop: page operations saved with Ctrl+S; a merge', async ({ page }) => {
  await page.goto('/');
  const original = sheets(4);
  const id = await open(page, original, 'pages.pdf');
  const run = (op: Record<string, unknown>) => cap(page, 'pages', 'run', id, op);
  expect(await run({ kind: 'rotate', pages: [0], quarter: 1 })).toBe(true);
  expect(await run({ kind: 'delete', pages: [2] })).toBe(true);
  expect(await run({ kind: 'insertBlank', at: 2, count: 1, width: 595, height: 842 })).toBe(true);
  expect(await run({ kind: 'move', pages: [3], to: 1 })).toBe(true);
  keep('pages__ctrl-s.pdf', await save(page, id, original));

  // Organize → Merge Files: a new tab, written in full.
  await stubOpenPicker(page, [
    { name: 'a.pdf', b64: b64(sheets(2, 'A')) },
    { name: 'b.pdf', b64: b64(sheets(2, 'B')) },
  ]);
  await page.getByRole('tab', { name: 'Organize' }).click();
  await page
    .getByRole('toolbar', { name: 'Organize commands' })
    .getByRole('button', { name: 'Merge Files' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Merge Files' });
  await dialog.getByRole('button', { name: 'Add Files…' }).click();
  await expect(dialog.getByText('b.pdf: 2 pages')).toBeVisible();
  await dialog.getByRole('button', { name: 'Merge' }).click();
  await expect(dialog).toBeHidden();
  const merged = (await cap(page, 'view', 'activeDocId')) as string;
  const bytes = Buffer.from((await cap(page, 'save', 'saveRewrite', merged)) as string, 'base64');
  expect([0, 3, 'absent']).toContain(qpdfStatus(bytes));
  keep('merged.pdf', bytes);
});

test('M4 interop: /Redact marks saved with Ctrl+S; redacted outputs', async ({ page }) => {
  await page.goto('/');
  const original = sheets(1, 'Confidential');
  const id = await open(page, original, 'marks.pdf');
  // A text mark over "Confidential" (one quad) and an area mark.
  const textQuad = rect(70, 92, 205, 34);
  await cap(page, 'annotate', 'create', id, 0, {
    type: REDACT,
    rect: textQuad,
    segmentRects: [textQuad],
    color: '#000000',
    strokeColor: RED,
    contents: 'Confidential',
  });
  const area = rect(72, 300, 300, 120);
  await cap(page, 'annotate', 'create', id, 0, {
    type: REDACT,
    rect: area,
    segmentRects: [area],
    color: '#000000',
    strokeColor: RED,
  });
  keep('redact-marks__ctrl-s.pdf', await save(page, id, original));

  // Apply on the adversarial file without its page 9 mark (that page fails verification by design).
  await page.goto('/');
  const adv = await open(page, adversarialPdf(), 'adversarial.pdf');
  const marks = (
    (await cap(page, 'annotate', 'list', adv)) as { id: string; page: number; type: number }[]
  )
    .filter((a) => a.type === REDACT && a.page === 8)
    .map((a) => a.id);
  await page.getByRole('tab', { name: 'Protect' }).click();
  await page
    .getByRole('toolbar', { name: 'Protect commands' })
    .getByRole('button', { name: 'Pending Redactions' })
    .click();
  await page
    .getByRole('complementary', { name: 'Pending Redactions' })
    .getByRole('button', { name: /^Remove mark 9\./ })
    .click();
  expect(marks).toHaveLength(1);
  await stubSavePicker(page);
  const apply = async (name: string, password?: string) => {
    await page
      .getByRole('toolbar', { name: 'Protect commands' })
      .getByRole('button', { name: 'Apply Redactions' })
      .click();
    const d = page.getByRole('dialog', { name: 'Apply Redactions' });
    await d.getByRole('button', { name: 'Apply and Save As…' }).click();
    await expect(d.getByTestId('redact-result')).toContainText('Every check passed.', {
      timeout: 60_000,
    });
    const out = Buffer.from((await cap(page, 'redact', 'lastOutput')) as string, 'base64');
    expect([0, 3, 'absent']).toContain(qpdfStatus(out, password));
    keep(name, out);
    await d.getByRole('button', { name: 'Close' }).first().click();
  };
  await apply('redacted.pdf');

  if (hasQpdf()) {
    await page.goto('/');
    await cap(page, 'annotate', 'setProfile', 'PDFTools Interop');
    await drop(page, [
      {
        name: 'adversarial-aes.pdf',
        b64: b64(qpdfEncrypt(adversarialPdf(), USER_PW, OWNER_PW, ['256'])),
      },
    ]);
    const pw = page.getByRole('dialog', { name: 'Password required' });
    await pw.getByLabel('Password').fill(OWNER_PW);
    await pw.getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Protect' }).click();
    await page
      .getByRole('toolbar', { name: 'Protect commands' })
      .getByRole('button', { name: 'Pending Redactions' })
      .click();
    await page
      .getByRole('complementary', { name: 'Pending Redactions' })
      .getByRole('button', { name: /^Remove mark 9\./ })
      .click();
    await stubSavePicker(page);
    await apply('redacted-aes256.pdf', USER_PW);
  }
});

test('M4 interop: Word, table and annotation workbooks', async ({ page }) => {
  await page.goto('/');
  await open(page, extractionFixture(), 'spec.pdf');
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Convert' }).click();
  const convert = page.getByRole('toolbar', { name: 'Convert commands' });
  await convert.getByRole('button', { name: 'To Word (Beta)' }).click();
  let d = page.getByRole('dialog', { name: 'Export to Word (Beta)' });
  await d.getByRole('button', { name: 'Export' }).click();
  await expect(d).toBeHidden({ timeout: 30_000 });
  const word = (await cap(page, 'extract', 'lastExport')) as { files: { b64: string }[] };
  keep('export.docx', Buffer.from(word.files[0]?.b64 ?? '', 'base64'));

  // Tables: page 1 of the table fixture (pipe chart, merged headers) → XLSX.
  await page.goto('/');
  await open(page, tablesPdf(), 'tables.pdf');
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Convert' }).click();
  await convert.getByRole('button', { name: 'Express Extract' }).click();
  d = page.getByRole('dialog', { name: 'Express Extract (Beta)' });
  await d.getByRole('button', { name: 'Find Tables' }).click();
  await expect(d.getByRole('status')).toContainText('2 tables found.', { timeout: 30_000 });
  await d.getByRole('button', { name: 'Save…' }).click();
  await expect(d).toBeHidden({ timeout: 30_000 });
  const tables = (await cap(page, 'extract', 'lastExport', 'tables')) as {
    files: { b64: string }[];
  };
  keep('tables.xlsx', Buffer.from(tables.files[0]?.b64 ?? '', 'base64'));

  // Annotations → XLSX.
  await page.goto('/');
  const id = await open(page, simplePdf(1), 'comments.pdf');
  await cap(page, 'annotate', 'create', id, 0, {
    type: SQUARE,
    rect: rect(60, 120, 200, 80),
    color: 'transparent',
    strokeColor: RED,
    strokeWidth: 2,
    contents: 'Check the weld size.',
  });
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' })
    .click();
  d = page.getByRole('dialog', { name: 'Export Annotations' });
  await d.getByLabel('Excel workbook (.xlsx)').check();
  await d.getByRole('button', { name: 'Export' }).click();
  await expect(d).toBeHidden({ timeout: 30_000 });
  const ann = (await cap(page, 'annotate', 'lastAnnotationExport')) as { b64: string };
  keep('annotations.xlsx', Buffer.from(ann.b64, 'base64'));
});

test('M4 interop: comments transferred from Rev A to Rev B', async ({ page }) => {
  await page.goto('/');
  const revA = sheets(2, 'Rev A');
  const a = await open(page, revA, 'rev-a.pdf');
  const square = (await cap(page, 'annotate', 'create', a, 0, {
    type: SQUARE,
    rect: rect(60, 200, 200, 80),
    color: 'transparent',
    strokeColor: RED,
    strokeWidth: 2,
    contents: 'Move the nozzle 50 mm east.',
  })) as string;
  await cap(page, 'annotate', 'create', a, 0, {
    type: TEXT,
    rect: rect(60, 200, 24, 24),
    inReplyToId: square,
    author: 'Bo Vendor',
    contents: 'Agreed, revised in Rev B.',
    flags: ['print', 'noZoom', 'noRotate'],
    strokeColor: '#FFE14D',
  });
  const hl = rect(70, 92, 200, 34);
  await cap(page, 'annotate', 'create', a, 1, {
    type: HIGHLIGHT,
    rect: hl,
    segmentRects: [hl],
    strokeColor: '#FFCD45',
    color: '#FFCD45',
    contents: 'Title changes in Rev B',
  });
  const revAFile = await save(page, a, revA);
  keep('transfer-rev-a__ctrl-s.pdf', revAFile);

  // Rev B: a different file; Comment → Import Comments from Rev A.
  const revB = sheets(2, 'Rev B');
  const b = await open(page, revB, 'rev-b.pdf');
  await stubOpenPicker(page, [{ name: 'rev-a.pdf', b64: b64(revAFile) }]);
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Import Comments' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Import Comments' });
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
  await expect(dialog.getByText('rev-a.pdf: 2 comments on 2 pages.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', b)) as unknown[]).length)
    .toBe(3);
  keep('transfer-rev-b__ctrl-s.pdf', await save(page, b, revB));
});
