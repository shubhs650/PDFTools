import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { hasQpdf } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import {
  annotationsOf,
  diffAnnot,
  hasPdftoppm,
  pixelDiff,
  renderPages,
  stripAnnotations,
} from './support/annotDiff.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';

// M8-01 (ADR-025): the JSON comment round trip is lossless. Every comment of
// our interop files (made in the app, saved with Ctrl+S) and of a file of
// properties set in the app is exported as JSON v2 with the Export dialog,
// imported with the Import dialog into the same file without its comments,
// saved with Ctrl+S, and compared with the original: every annotation by /NM,
// key by key, streams (appearances, pictures, attached files) by their data;
// and pixel by pixel when pdftoppm is there.

const FIXTURES = [
  'm3-interop/types__ctrl-s.pdf', // every M3 tool, the stamp included
  'm3-interop/replies-states__ctrl-s.pdf',
  'm3-interop/measure-page__ctrl-s.pdf', // measurements with their labels
  'm6-interop/comments-m6__ctrl-s.pdf', // Attach File, callout, rotation, styles
  'm7-interop/default-styles__ctrl-s.pdf',
  'm7-interop/paste-image__ctrl-s.pdf',
  'm7-interop/sticky-note-popups__ctrl-s.pdf',
  'm7-interop/text-colors__ctrl-s.pdf',
  'm7-interop/text-comments__ctrl-s.pdf',
];

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

/** The next showOpenFilePicker call returns this file. */
async function stubPicker(page: Page, name: string, bytes: Uint8Array, type: string) {
  await page.evaluate(
    ([n, data, mime]) => {
      const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
      w.showOpenFilePicker = () => {
        const bin = atob(data);
        const file = new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], n, { type: mime });
        return Promise.resolve([{ kind: 'file', name: n, getFile: () => Promise.resolve(file) }]);
      };
    },
    [name, b64(bytes), type] as const,
  );
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Comment commands' });

const synced = async (page: Page, id: string, count?: number) =>
  expect
    .poll(async () => {
      const all = ((await cap(page, 'annotate', 'list', id)) as { commit?: string }[] | null) ?? [];
      return (
        all.length > 0 &&
        (count === undefined || all.length === count) &&
        all.every((a) => a.commit === 'synced')
      );
    })
    .toBe(true);

async function saveBytes(page: Page, id: string, base: Uint8Array): Promise<Buffer> {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  return Buffer.concat([Buffer.from(base), Buffer.from(s.tail, 'base64')]);
}

/** Comment → Export Comments → JSON, as the user does it; the file's bytes. */
async function exportJson(page: Page): Promise<Buffer> {
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Comment' }).click();
  await bar(page).getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' }).click();
  const exp = page.getByRole('dialog', { name: 'Export Annotations' });
  await exp.getByLabel('JSON (.json) — can be imported again').check();
  await exp.getByRole('button', { name: 'Export' }).click();
  await expect(exp).toBeHidden();
  const f = (await cap(page, 'annotate', 'lastAnnotationExport')) as { b64: string } | null;
  if (!f) throw new Error('no export');
  return Buffer.from(f.b64, 'base64');
}

/** Comment → Import Comments with a JSON file; the dialog's preview text. */
async function importJson(page: Page, json: Uint8Array): Promise<string> {
  await stubPicker(page, 'source (annotations).json', json, 'application/json');
  await page.getByRole('tab', { name: 'Comment' }).click();
  await bar(page).getByRole('button', { name: 'Import Comments' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Comments' });
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
  const status = dialog.getByRole('status');
  await expect(status).toContainText(/will be imported|Nothing to import/u);
  const text = (await status.textContent()) ?? '';
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog).toBeHidden();
  return text;
}

/** Exports `original`'s comments, imports them into it without comments, saves; the differences. */
async function roundTrip(page: Page, original: Uint8Array) {
  await open(page, original, 'source.pdf');
  const json = await exportJson(page);
  const stripped = stripAnnotations(original);
  const id = await open(page, stripped, 'target.pdf');
  const preview = await importJson(page, json);
  expect(preview).not.toContain('Skipped');
  await synced(page, id);
  const saved = await saveBytes(page, id, stripped);

  const before = annotationsOf(original);
  const after = annotationsOf(saved);
  const lost: string[] = [];
  for (const a of before.values()) {
    const d = diffAnnot(a, after.get(a.nm));
    if (d === 'missing') lost.push(`${a.subtype} ${a.nm}: missing`);
    else for (const x of d) lost.push(`${a.subtype} ${a.nm} ${x.key}`);
  }
  const pixels: number[] = [];
  if (hasPdftoppm()) {
    const pb = renderPages(saved);
    renderPages(original).forEach((p, i) => pixels.push(pixelDiff(p, pb[i] ?? Buffer.alloc(0))));
  }
  return { json, before, after, lost, pixels };
}

for (const fixture of FIXTURES) {
  test(`JSON round trip keeps every comment exactly: ${fixture}`, async ({ page }) => {
    test.skip(!hasQpdf(), 'needs qpdf');
    await page.goto('/');
    const r = await roundTrip(page, readFileSync(`e2e/fixtures/self-made/${fixture}`));
    expect(r.after.size).toBe(r.before.size);
    expect(r.lost).toEqual([]);
    for (const p of r.pixels) expect(p).toBe(0);
  });
}

test('@smoke JSON round trip keeps every property set in the app; a v1 file still imports', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'needs qpdf');
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  const blank = simplePdf(1);
  const id = await open(page, blank, 'props.pdf');
  const rect = (x: number, y: number, w = 120, h = 60) => ({
    origin: { x, y },
    size: { width: w, height: h },
  });
  const make = (o: Record<string, unknown>) => cap(page, 'annotate', 'create', id, 0, o);
  // Square: dashed, multiply, 50 %, locked and read only, subject, fill.
  await make({
    type: 5,
    rect: rect(40, 40),
    color: '#ffff00',
    strokeColor: '#ff0000',
    strokeWidth: 3,
    strokeStyle: 2,
    strokeDashArray: [6, 3],
    opacity: 0.5,
    blendMode: 1,
    flags: ['print', 'locked', 'readOnly'],
    subject: 'Dashed square',
    contents: 'Locked and multiplied',
  });
  // Circle: cloudy, intensity 2.
  await make({
    type: 6,
    rect: rect(200, 40),
    color: 'transparent',
    strokeColor: '#00aa00',
    strokeWidth: 2,
    strokeStyle: 6,
    cloudyBorderIntensity: 2,
    contents: 'Cloudy',
  });
  // Line: open and closed arrows, dashed.
  await make({
    type: 4,
    rect: rect(40, 140, 200, 40),
    linePoints: { start: { x: 50, y: 150 }, end: { x: 230, y: 170 } },
    lineEndings: { start: 4, end: 5 },
    color: '#0000ff',
    strokeColor: '#0000ff',
    strokeWidth: 2,
    strokeStyle: 2,
    strokeDashArray: [4, 2],
    contents: 'Arrow line',
  });
  // Typewriter, Courier bold, right-aligned.
  await make({
    type: 3,
    intent: 'FreeTextTypeWriter',
    rect: rect(40, 220, 200, 24),
    contents: 'Typewriter text',
    fontFamily: 1,
    fontSize: 14,
    fontColor: '#000000',
    textAlign: 2,
    color: 'transparent',
  });
  // Text box: blue Times bold on a red border, filled, centred, bottom (ADR-024).
  await make({
    type: 3,
    rect: rect(40, 260, 220, 80),
    contents: 'Blue text on a red border',
    fontFamily: 9,
    fontSize: 12,
    fontColor: '#0000ff',
    strokeColor: '#ff0000',
    strokeWidth: 2,
    color: '#ffffcc',
    textAlign: 1,
    verticalAlign: 2,
  });
  // Sticky note, orange, no zoom / no rotate.
  await make({
    type: 1,
    rect: rect(300, 40, 20, 20),
    color: '#ffa500',
    contents: 'A note',
    flags: ['noZoom', 'noRotate'],
  });
  await synced(page, id, 6);
  const original = await saveBytes(page, id, blank);
  await page.goto('/');
  const r = await roundTrip(page, original);
  expect(r.before.size).toBe(6);
  expect(r.after.size).toBe(6);
  expect(r.lost).toEqual([]);
  for (const p of r.pixels) expect(p).toBe(0);

  // The same comments as JSON v1 (no comments PDF): re-created, still imported.
  const v1 = JSON.parse(r.json.toString('utf8')) as Record<string, unknown>;
  expect(v1.version).toBe(2);
  expect(typeof v1.pdf).toBe('string');
  delete v1.pdf;
  delete v1.pdfPages;
  v1.version = 1;
  const target = await open(page, stripAnnotations(original), 'v1.pdf');
  const preview = await importJson(page, Buffer.from(JSON.stringify(v1)));
  expect(preview).toContain('6 comments will be imported');
  await synced(page, target, 6);
});
