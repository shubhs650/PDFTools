import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasQpdf } from './fixtures/encrypted.ts';
import { measureSheetPath } from './fixtures/measure-corpus/index.ts';
import {
  FLOOR,
  PIPES,
  countDoors,
  holes,
  item,
  measureTool,
  objects,
  openMeasurementsPane,
  placeMeasure,
  setMeasure,
  steadyPage,
} from './help-shots/measureScenes.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M14-11 (plan M14 §11, Q35): the owner's hand-check file. One PDF holding every
// measuring tool, placed by the real tools on the measure corpus (self-made,
// M14-01): page 1 the floor plan (1:100) with Count, two Lengths (one with its
// dimension line set sideways, one with its caption In line), Polylength,
// Perimeter, a labelled Area, a Volume with two cutouts and the summary table;
// page 2 the pipe run (1:50) with Length, Polylength, Angle, Radius (an arc by
// three points and a full circle) and Diameter. The Excel export is attached.
// Saved with Ctrl+S's route and checked with qpdf. With M14_OWNER_PACK_OUT set,
// the file is written there for the owner to open in Acrobat Reader, the second
// desktop editor and the Chrome or Edge viewer (docs/acceptance/M14.md).
/* eslint-disable @typescript-eslint/no-non-null-assertion -- corpus items known to exist */

const NAME = 'M14_owner_pack.pdf';

test('the owner pack: every measuring tool in one file, saved and checked', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf joins the two corpus sheets into one file');
  test.setTimeout(300_000);

  // The floor plan and the pipe run as one two-page file (each page keeps its /VP).
  const dir = mkdtempSync(join(tmpdir(), 'm14-owner-'));
  const joined = join(dir, 'joined.pdf');
  const q = spawnSync(
    'qpdf',
    [
      '--empty',
      '--pages',
      measureSheetPath(FLOOR.name),
      measureSheetPath(PIPES.name),
      '--',
      joined,
    ],
    { encoding: 'utf8' },
  );
  expect(q.status, q.stderr).toBe(0);
  const bytes = new Uint8Array(readFileSync(joined));

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name: NAME, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Control+0');
  await page.evaluate(() =>
    (
      window as unknown as {
        __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
      }
    ).__pdftoolsTest.capabilities.commands.run('view.propertiesPane'),
  );
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  await steadyPage(page);

  // --- Page 1: the floor plan ---------------------------------------------------
  // The doors first: a click inside an earlier area would select it.
  await countDoors(page, id);
  await page.keyboard.press('Escape');
  await placeMeasure(page, FLOOR, id, 'Length', item(FLOOR, 'overall-length'), {
    offset: 30,
    text: /^24,000 mm$/,
  });
  const diagonal = await placeMeasure(page, FLOOR, id, 'Length', item(FLOOR, 'office-diagonal'), {
    text: /^10,817 mm$/,
  });
  await setMeasure(page, id, diagonal.id, { cap: 'inline' });
  await placeMeasure(page, FLOOR, id, 'Polylength', item(FLOOR, 'wall-run'), {
    text: /^23,000 mm$/,
  });
  await placeMeasure(page, FLOOR, id, 'Perimeter', item(FLOOR, 'office-perimeter'), {
    text: /^30,000 mm$/,
  });
  const shop = await placeMeasure(page, FLOOR, id, 'Area', item(FLOOR, 'workshop-area'), {
    text: /^114\.00 m²$/,
  });
  await setMeasure(page, id, shop.id, { label: 'Workshop' });

  // Volume: the depth before drawing, then two cutouts with the tool.
  await measureTool(page, 'Volume');
  await page.getByLabel('Depth unit', { exact: true }).selectOption({ label: 'Millimetres' });
  const depth = page.getByLabel('Depth', { exact: true });
  await depth.fill('250');
  await depth.press('Enter');
  const slab = await placeMeasure(page, FLOOR, id, 'Volume', item(FLOOR, 'slab-volume'), {
    text: /^20\.25 m³$/,
  });
  await page.keyboard.press('Escape');
  await cap(page, 'annotate', 'select', id, 0, slab.id);
  await measureTool(page, 'Cutout');
  const cuts = holes(FLOOR, 'slab-volume');
  for (const hole of cuts) {
    for (const [x, y] of hole) {
      const box = await page.locator('[data-page="0"] .page-content').boundingBox();
      const s = box!.width / FLOOR.width;
      await page.mouse.move(box!.x + x * s, box!.y + y * s, { steps: 3 });
      await page.mouse.click(box!.x + x * s, box!.y + y * s);
    }
    await page.keyboard.press('Enter');
  }
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === slab.id)?.measure?.holes)
    .toHaveLength(2);
  await page.keyboard.press('Escape');
  await setMeasure(page, id, slab.id, {
    holes: cuts.map((h) => h.map(([x, y]) => ({ x, y }))),
  });
  await expect
    .poll(async () => (await objects(page, id)).find((o) => o.id === slab.id)?.contents)
    .toBe('17.69 m³');

  // --- Page 2: the pipe run -----------------------------------------------------
  await page.locator('[data-page="1"]').scrollIntoViewIfNeeded();
  await steadyPage(page, 1);
  const on2 = { pageIndex: 1, free: [120, 640, 160, 120] as [number, number, number, number] };
  await placeMeasure(page, PIPES, id, 'Length', item(PIPES, 'first-leg'), {
    ...on2,
    offset: 20,
    text: /^6,000 mm$/,
  });
  await placeMeasure(page, PIPES, id, 'Polylength', item(PIPES, 'run-length'), {
    ...on2,
    text: /^15,000 mm$/,
  });
  await placeMeasure(page, PIPES, id, 'Angle', item(PIPES, 'deflection-B'), {
    ...on2,
    text: /^∠ 37\.5°$/,
  });
  await placeMeasure(page, PIPES, id, 'Radius', item(PIPES, 'flange-radius'), {
    ...on2,
    text: /^R 300(\.0+)? mm$/,
  });
  await measureTool(page, 'Radius');
  await page
    .getByTestId('tool-properties')
    .getByLabel('Pick by')
    .selectOption({ label: 'Three points on the curve' });
  await placeMeasure(page, PIPES, id, 'Radius', item(PIPES, 'bend-radius-B', 'onCircle'), {
    ...on2,
    text: /^R 1,200(\.0+)? mm$/,
  });
  await measureTool(page, 'Diameter');
  await page
    .getByTestId('tool-properties')
    .getByLabel('Pick by')
    .selectOption({ label: 'Centre, then a point on the edge' });
  await placeMeasure(page, PIPES, id, 'Diameter', item(PIPES, 'tank-diameter'), {
    ...on2,
    text: /^Ø 3,000(\.0+)? mm$/,
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Every kind at least once: 13 measurements on page 1 (7 counts), 6 on page 2.
  const tools = (await objects(page, id)).map((o) => o.measure?.tool).filter(Boolean);
  for (const t of [
    'length',
    'polylength',
    'perimeter',
    'area',
    'volume',
    'angle',
    'radius',
    'diameter',
    'count',
  ])
    expect(tools, t).toContain(t);
  expect(tools).toHaveLength(19);

  // The summary of all pages on page 1, and the Excel export attached.
  await page.locator('[data-page="0"]').scrollIntoViewIfNeeded();
  await steadyPage(page);
  const pane = await openMeasurementsPane(page);
  await pane.getByRole('radio', { name: 'All pages' }).check();
  await pane.getByRole('button', { name: 'Place summary' }).click();
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.type === 3).length)
    .toBe(1);
  await pane.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export measurements' });
  await dialog.getByRole('radio', { name: 'All pages' }).check();
  await dialog.getByLabel('Include pictures').check();
  await dialog.getByLabel('Save as a file').uncheck();
  await dialog.getByLabel('Attach to this PDF').check();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('measure-attached')).toHaveText(/Attached to this PDF as/u);

  // Saved by Ctrl+S's route, verified, and checked with qpdf.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    fellBack: boolean;
    tail: string;
  };
  expect(saved.fellBack).toBe(false);
  const tail = Buffer.from(saved.tail, 'base64');
  // Both save modes (narrow, keep-all) append an incremental tail to the file.
  const file = Buffer.concat([Buffer.from(bytes), tail]);
  const text = file.toString('latin1');
  for (const it of ['LineDimension', 'PolyLineDimension', 'PolygonDimension'])
    expect(text).toMatch(new RegExp(`/IT\\s*/${it}`));
  expect(text).toMatch(/\/CP\s*\/Inline/);
  expect(text).toMatch(/\/Subj\s*\(Count\)/);
  expect(text).toMatch(/\/Subj\s*\(Angle\)/);
  expect(text).toMatch(/\/EmbeddedFile/);
  expect(text).toMatch(/\/TriyaPDF/);
  const out = join(dir, NAME);
  writeFileSync(out, file);
  const check = spawnSync('qpdf', ['--check', out], { encoding: 'utf8' });
  expect(check.status, check.stdout + check.stderr).toBe(0);

  const target = process.env.M14_OWNER_PACK_OUT;
  if (target) {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, NAME), file);
  }
});
