import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { hasQpdf } from './fixtures/encrypted.ts';
import { measureManifest, measureSheetBytes } from './fixtures/measure-corpus/index.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-03: the interop file of spike S34 (M14-01) rebuilt from the real tools
// on the measure corpus floor plan (1:100): two Lengths (one with an offset,
// one with its caption In line), a Polylength, a Perimeter and a labelled
// Area, each one markup with its value in its own appearance, saved with
// Ctrl+S (narrow tail, verified) and checked with qpdf. With M14_INTEROP_OUT
// set, the file is written there for the owner's check in a second desktop
// PDF editor.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- corpus points known to exist */

interface Obj {
  id: string;
  type: number;
  contents?: string;
  measure?: { tool: string };
}

const SHEET = '01_floor_plan_1-100_mm.pdf';

async function save(page: Page, id: string, original: Uint8Array) {
  const s = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(s).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(s.tail, 'base64');
  return { file: Buffer.concat([Buffer.from(original), tail]), tail: tail.toString('latin1') };
}

test('the M14 interop file from the real tools: five measurements, one markup each', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const sheet = measureManifest().sheets.find((s) => s.file === SHEET);
  if (!sheet) throw new Error('floor plan missing');
  const item = (id: string) => {
    const it = sheet.items.find((i) => i.id === id);
    if (!it) throw new Error(id);
    // User space (y up) → the page as shown (y down).
    return it.points.map(([x, y]) => [x, sheet.height - y] as [number, number]);
  };
  const bytes = measureSheetBytes(SHEET);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: SHEET, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Measure commands' });
  const at = async ([x, y]: [number, number]) => {
    const box = await page.locator('[data-page="0"] .page-content').boundingBox();
    if (!box) throw new Error('page not laid out');
    const s = box.width / sheet.width;
    return { x: box.x + x * s, y: box.y + y * s };
  };
  const clicks = async (pts: [number, number][]) => {
    for (const p of pts) {
      const s = await at(p);
      await page.mouse.move(s.x, s.y, { steps: 3 });
      await page.mouse.click(s.x, s.y);
    }
  };
  const use = async (name: string) => {
    const b = bar.getByRole('button', { name, exact: true });
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'true');
  };
  const count = async () =>
    ((await cap(page, 'annotate', 'objects', id)) as Obj[]).filter((o) => o.measure && o.contents)
      .length;

  // Each is drawn by clicks in a free corner of the sheet (a click inside an
  // earlier measurement selects it), then set on the corpus points as a point
  // drag does, so the values are the manifest's.
  const inset = (pts: [number, number][]): [number, number][] => {
    const x0 = Math.min(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1]));
    const w = Math.max(...pts.map((p) => p[0])) - x0 || 1;
    const h = Math.max(...pts.map((p) => p[1])) - y0 || 1;
    const k = Math.min(200 / w, 150 / h);
    return pts.map(([x, y]) => [920 + (x - x0) * k, 620 + (y - y0) * k]);
  };
  const xy = ([x, y]: [number, number]) => ({ x, y });
  const newest = async (n: number) => {
    await expect.poll(count).toBe(n);
    const all = ((await cap(page, 'annotate', 'objects', id)) as Obj[]).filter((o) => o.measure);
    const m = all[all.length - 1];
    if (!m) throw new Error('measurement missing');
    return m.id;
  };
  const place = (m: string, patch: Record<string, unknown>) =>
    cap(page, 'annotate', 'update', id, 0, m, patch);

  await use('Length');
  const over = item('overall-length');
  const [a, b] = inset(over) as [[number, number], [number, number]];
  await clicks([a, b, [(a[0] + b[0]) / 2, a[1] - 30]]);
  // The offset stays 30 pt above the line when it is set on the corpus points.
  await place(await newest(1), { linePoints: { start: xy(over[0]!), end: xy(over[1]!) } });
  const diagonal = item('office-diagonal');
  await clicks(inset(diagonal));
  await page.keyboard.press('Enter');
  await place(await newest(2), {
    linePoints: { start: xy(diagonal[0]!), end: xy(diagonal[1]!) },
  });

  await use('Polylength');
  const run = inset(item('wall-run'));
  await clicks(run.slice(0, -1));
  const last = await at(run[run.length - 1]!);
  await page.mouse.move(last.x, last.y, { steps: 3 });
  await page.mouse.dblclick(last.x, last.y);
  await place(await newest(3), { vertices: item('wall-run').map(xy) });

  await use('Perimeter');
  await clicks(inset(item('office-perimeter')));
  await page.keyboard.press('Enter');
  const office = item('office-perimeter').map(xy);
  await place(await newest(4), { vertices: [...office, office[0]] });

  await use('Area');
  await clicks(inset(item('workshop-area')));
  await page.keyboard.press('Enter');
  await place(await newest(5), { vertices: item('workshop-area').map(xy) });
  await page.keyboard.press('Escape');

  const objs = (await cap(page, 'annotate', 'objects', id)) as Obj[];
  const area = objs.find((o) => o.measure?.tool === 'area');
  const diag = objs.filter((o) => o.measure?.tool === 'length')[1];
  if (!area || !diag) throw new Error('measurements missing');
  // A Label on the Area, the second Length's caption In line.
  await cap(page, 'annotate', 'update', id, 0, area.id, {
    measure: { ...area.measure, label: 'Workshop' },
  });
  await cap(page, 'annotate', 'update', id, 0, diag.id, {
    measure: { ...diag.measure, cap: 'inline' },
  });
  await expect
    .poll(
      async () =>
        ((await cap(page, 'annotate', 'objects', id)) as Obj[]).find((o) => o.id === area.id)
          ?.contents,
    )
    .toMatch(/^Workshop: [\d.,]+ mm²$/);

  const { file, tail } = await save(page, id, bytes);
  expect(tail).not.toMatch(/\/FreeText/);
  for (const it of ['LineDimension', 'PolyLineDimension', 'PolygonDimension'])
    expect(tail).toMatch(new RegExp(`/IT\\s*/${it}`));
  expect(tail).toMatch(/\/CP\s*\/Inline/);
  expect(tail).toMatch(/\/Subj\s*\(Polylength\)/);
  expect(tail).toMatch(/\/TriyaPDF/);

  if (hasQpdf()) {
    const dir = mkdtempSync(join(tmpdir(), 'm14-interop-'));
    const path = join(dir, 'interop.pdf');
    writeFileSync(path, file);
    const r = spawnSync('qpdf', ['--check', path], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }
  const out = process.env.M14_INTEROP_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'M14-03_interop_floor_plan.pdf'), file);
  }
});
