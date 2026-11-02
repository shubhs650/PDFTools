import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { flattenSourcePdf } from './fixtures/comments.ts';
import { hasQpdf } from './fixtures/encrypted.ts';
import { annotatedPdf, richOutlinePdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';
import { encodePng } from '../src/workers/work/png.ts';

// M6-15: the interop pack §M6 (e2e/interop/CHECKLIST.md §M6, ADR-001 B16,
// ADR-021, ADR-022), with M5-05's OCR item: files made by the real app —
// comments with M6's default styles and properties, an attached file, a
// flattened copy, an edited outline, the five form field types (blank and
// filled), visual signatures, password-protected and unprotected copies and
// an English OCR layer — each saved with Ctrl+S (or written as a new file by
// the feature) and checked with qpdf. With M6_INTEROP_OUT=1 they are written
// to OUT for the owner's run in Acrobat Reader and PDF-XChange.

const OUT = 'e2e/fixtures/self-made/m6-interop';
const AUTHOR = 'PDFTools Interop';
export const OPEN_PW = 'open-pw';
export const PERM_PW = 'perm-pw';
const T = { TEXT: 1, FREETEXT: 3, SQUARE: 5, STAMP: 13, INK: 15, FILE: 17 };
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const rect = (x: number, y: number, w: number, h: number) => ({
  origin: { x, y },
  size: { width: w, height: h },
});
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-m6-interop-'));
let seq = 0;

/** qpdf --check: 0 clean, 3 warnings only; null when qpdf refused (or 'absent'). */
function qpdfStatus(bytes: Uint8Array, password?: string): number | null | 'absent' {
  if (!hasQpdf()) return 'absent';
  const file = join(tmp, `f${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', ...(password ? [`--password=${password}`] : []), file])
    .status;
}

function keep(name: string, bytes: Uint8Array): void {
  if (process.env.M6_INTEROP_OUT !== '1') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), bytes);
}

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await cap(page, 'annotate', 'setProfile', AUTHOR);
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  // Fit Page: every page point the tests click is on screen.
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('ControlOrMeta+0');
  return id;
}

/** Every annotation committed to PDFium (the plugin's commit is async). */
async function settled(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => {
      const list = (await cap(page, 'annotate', 'list', id)) as { commit: string }[] | null;
      return list?.every((a) => a.commit === 'synced') ?? false;
    })
    .toBe(true);
}

/** Ctrl+S (narrow, verified) appended to the original; qpdf-checked. */
async function save(page: Page, id: string, original: Uint8Array): Promise<Buffer> {
  await settled(page, id);
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  const file = Buffer.concat([Buffer.from(original), Buffer.from(s.tail, 'base64')]);
  expect([0, 3, 'absent']).toContain(qpdfStatus(file));
  return file;
}

/** The page's box once the layout has settled (opening a pane re-fits the zoom). */
async function pageBox(page: Page, pageIndex = 0) {
  const content = page.locator(`[data-page="${String(pageIndex)}"] .page-content`);
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await content.boundingBox());
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
  const box = await content.boundingBox();
  if (!box) throw new Error('page not laid out');
  return box;
}

async function at(page: Page, x: number, y: number, pageIndex = 0) {
  const box = await pageBox(page, pageIndex);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

async function clickAt(page: Page, x: number, y: number) {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

const commands = (page: Page, tab: string) =>
  page.getByRole('toolbar', { name: `${tab} commands` });

async function tool(page: Page, tab: string, name: string) {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  const b = commands(page, tab).getByRole('button', { name, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** Esc out of any text being edited and back to the Select tool. */
async function done(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');
}

const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as
    | { id: string; type: number; intent?: string; subject?: string; stateModel?: string }[]
    | null) ?? [];

test('M6 interop: default styles, the property grid, an attached file; a flattened copy', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const original = simplePdf(2);
  const id = await open(page, original, 'comments.pdf');
  await expect.poll(() => cap(page, 'annotate', 'toolDefaultsLoaded')).toBe(true);

  // M6-03: drawn with the tools, so the defaults apply (red, 1 pt, 10 pt text).
  await tool(page, 'Comment', 'Rectangle');
  await drag(page, [60, 60], [200, 130]);
  await tool(page, 'Comment', 'Arrow');
  await drag(page, [240, 130], [340, 70]);
  await tool(page, 'Comment', 'Text Box');
  await clickAt(page, 380, 70);
  await done(page);
  await tool(page, 'Comment', 'Callout');
  for (const [x, y] of [
    [120, 220],
    [200, 190],
    [300, 180],
  ] as const)
    await clickAt(page, x, y);
  await done(page);
  await expect.poll(async () => (await objects(page, id)).length).toBe(4);
  // Their text, set as the Properties pane's Comment text sets it.
  for (const o of await objects(page, id))
    if (o.type === T.FREETEXT)
      await cap(page, 'annotate', 'update', id, 0, o.id, {
        contents: o.intent === 'FreeTextCallout' ? 'Default callout' : 'Default text box',
      });

  // M6-10: Attach File (a click on the page picks the file).
  await page.evaluate(() => {
    const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
    w.showOpenFilePicker = () => {
      const file = new File([new TextEncoder().encode('tag,size\nP-101,DN150\n')], 'calc.csv');
      return Promise.resolve([
        { kind: 'file', name: 'calc.csv', getFile: () => Promise.resolve(file) },
      ]);
    };
  });
  const attach = commands(page, 'Comment').getByRole('button', {
    name: 'Attach File',
    exact: true,
  });
  await attach.click();
  await expect(attach).toHaveAttribute('aria-pressed', 'true');
  await clickAt(page, 480, 520);
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.type === T.FILE).length)
    .toBe(1);
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');
  await expect(attach).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await objects(page, id)).length).toBe(5);

  // M6-06: the property grid's keys, set as the pane sets them.
  await cap(page, 'annotate', 'create', id, 0, {
    type: T.SQUARE,
    rect: rect(60, 300, 160, 80),
    color: '#00FF00',
    strokeColor: '#0000FF',
    strokeWidth: 3,
    strokeStyle: 2, // dashed
    strokeDashArray: [6, 3],
    opacity: 0.5,
    blendMode: 1, // Multiply
    rotation: 30,
    subject: 'Rotated, dashed, multiply',
    contents: 'Rotated 30°, dashed 3 pt blue, green fill, 50 % opacity, Multiply.',
  });
  const box = (await cap(page, 'annotate', 'create', id, 0, {
    type: T.FREETEXT,
    rect: rect(300, 300, 220, 80),
    contents: 'Times bold italic 14 pt, centred, middle',
    fontFamily: 10, // Times-BoldItalic
    fontSize: 14,
    fontColor: '#123456',
    color: 'transparent',
    strokeColor: '#FF0000',
    strokeWidth: 1,
    textAlign: 1,
    verticalAlign: 1,
  })) as string;
  await cap(page, 'annotate', 'create', id, 0, {
    type: T.SQUARE,
    rect: rect(60, 440, 160, 60),
    color: 'transparent',
    strokeColor: '#FF0000',
    strokeWidth: 1,
    flags: [],
    contents: 'Does not print (Printable off).',
  });
  // Marked (a hidden state reply) and Locked from the Properties pane.
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Properties Pane' }).click();
  await cap(page, 'annotate', 'selectMany', id, [box]);
  const pane = page.getByTestId('properties-pane');
  await pane.getByLabel('Marked', { exact: true }).check();
  await expect
    .poll(async () => (await objects(page, id)).filter((o) => o.stateModel === 'Marked').length)
    .toBe(1);
  await pane.getByLabel('Locked', { exact: true }).check();
  await expect(pane.getByRole('status')).toHaveText(
    'This comment is locked. Clear Locked to change it.',
  );

  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);
  keep('comments-m6__ctrl-s.pdf', await save(page, id, original));

  // M6-09: Flatten Comments (all pages) on the flatten fixture, then Ctrl+S.
  await page.goto('/');
  const source = flattenSourcePdf();
  const fl = await open(page, source, 'flatten.pdf');
  await page.getByRole('tab', { name: 'Comment', exact: true }).click();
  await commands(page, 'Comment').getByRole('button', { name: 'Flatten Comments' }).click();
  const dialog = page.getByRole('dialog', { name: 'Flatten Comments' });
  await dialog.getByRole('button', { name: 'Flatten', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '4 comments flattened.' })).toBeVisible();
  keep('flattened__ctrl-s.pdf', await save(page, fl, source));
});

test('M6 interop: an edited outline saved with Ctrl+S', async ({ page }) => {
  await page.goto('/');
  const source = richOutlinePdf();
  const id = await open(page, source, 'outline.pdf');
  const tree = page.getByRole('tree', { name: 'Bookmarks' });
  const item = (name: string) => tree.getByRole('treeitem', { name, exact: true });
  const rename = async (text: string) => {
    const field = tree.getByRole('textbox', { name: 'Bookmark title' });
    await expect(field).toBeFocused();
    await field.fill(text);
    await field.press('Enter');
    await expect(item(text)).toBeFocused();
  };
  const rail = page
    .getByRole('complementary', { name: 'Navigation panes' })
    .getByRole('button', { name: 'Bookmarks' });
  if ((await rail.getAttribute('aria-pressed')) !== 'true') await rail.click();
  await expect(tree).toBeVisible();
  const pageNo = page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });

  // New bookmark to page 2 (from the view), renamed; a child under it.
  await pageNo.fill('2');
  await pageNo.press('Enter');
  await item('Named destination').focus();
  await page.keyboard.press('Insert');
  await rename('Section 2 (new)');
  await item('Section 2 (new)').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Bookmark menu' });
  await menu.getByRole('menuitem', { name: 'New Child Bookmark' }).click();
  await rename('Child of section 2');
  // Rename an existing one (F2) and move "Last" up one place (Alt+Shift+Up).
  await item('Web link').focus();
  await page.keyboard.press('F2');
  await rename('Website — Δ');
  await item('Last').focus();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  // Properties: blue, bold, Fit Width.
  await item('Section 2 (new)').focus();
  await page.keyboard.press('Alt+Enter');
  const props = page.getByRole('dialog', { name: 'Bookmark Properties' });
  await expect(props).toBeVisible();
  await props.getByLabel('Colour').fill('#0000ff');
  await props.getByLabel('Bold').check();
  await props.getByLabel('Zoom', { exact: true }).selectOption({ label: 'Fit Width' });
  await props.getByRole('button', { name: 'OK' }).click();
  await expect(props).toHaveCount(0);
  // Delete but Retain Children on the red closed parent.
  await item('Red bold, closed').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Delete but Retain Children' }).click();
  await expect(item('Child of closed')).toHaveAttribute('aria-level', '1');
  keep('bookmarks__ctrl-s.pdf', await save(page, id, source));
});

test('M6 interop: the five form field types, blank and filled', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const source = simplePdf(1);
  const id = await open(page, source, 'form.pdf');
  const props = page.getByTestId('field-properties');
  const set = async (label: string, value: string) => {
    const f = props.getByLabel(label, { exact: true });
    await f.fill(value);
    await f.press('Tab');
  };
  await tool(page, 'Form', 'Text Field');
  await drag(page, [100, 100], [300, 124]);
  await set('Name', 'customer');
  await set('Tooltip', 'Customer name');
  await set('Default value', 'n/a');
  await props.getByRole('checkbox', { name: 'Required' }).check();
  await tool(page, 'Form', 'Check Box');
  await clickAt(page, 110, 160);
  await set('Tooltip', 'Hydrotest witnessed');
  // Three radio buttons in one group; the third is deleted again (orphan check).
  await tool(page, 'Form', 'Radio Button');
  await clickAt(page, 110, 200);
  await clickAt(page, 150, 200);
  await clickAt(page, 190, 200);
  await settled(page, id);
  await page.keyboard.press('Escape');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Delete');
  await tool(page, 'Form', 'Dropdown');
  await drag(page, [100, 240], [260, 262]);
  await set('Items (one per line)', 'DN50\nDN80\nDN100');
  await set('Tooltip', 'Nominal size');
  await tool(page, 'Form', 'List Box');
  await drag(page, [100, 290], [260, 350]);
  await set('Items (one per line)', 'Carbon steel\nStainless 316\nDuplex');
  await settled(page, id);
  // Row tab order on the page.
  await page.keyboard.press('Escape');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Escape');
  const panel = page.getByTestId('tab-order-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Tab order', { exact: true }).selectOption({ label: 'Row order' });
  await expect(panel.getByRole('listitem').first()).toHaveText('1. customer');
  const blank = await save(page, id, source);
  expect(blank.toString('latin1')).not.toMatch(/\/JavaScript|\/JS\b/);
  keep('forms__ctrl-s.pdf', blank);

  // Filled in the app and saved again (a second revision).
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Customer name' }).fill('Ada Lovelace');
  await page.getByRole('textbox', { name: 'Customer name' }).press('Enter');
  await page.locator('[data-field="Check Box1"]').check();
  await page.locator('[data-field="Group1"]').nth(1).check();
  await page.locator('[data-field="Dropdown1"]').selectOption({ label: 'DN80' });
  await expect
    .poll(async () => {
      const w = (await cap(page, 'save', 'widgets', id, 0)) as { name: string; value: string }[];
      return w.find((x) => x.name === 'customer')?.value;
    })
    .toBe('Ada Lovelace');
  keep('forms-filled__ctrl-s.pdf', await save(page, id, blank));
});

/** A 240 × 80 PNG on white with a dark scribble (an uploaded signature). */
function scribblePng(): Promise<Uint8Array> {
  const w = 240;
  const h = 80;
  const rgba = new Uint8Array(w * h * 4).fill(255);
  for (let x = 10; x < 230; x++) {
    const y = Math.round(40 + 20 * Math.sin(x / 15));
    for (let dy = -2; dy <= 2; dy++) {
      const i = ((y + dy) * w + x) * 4;
      rgba[i] = 20;
      rgba[i + 1] = 20;
      rgba[i + 2] = 80;
    }
  }
  return encodePng(rgba, w, h);
}

test('M6 interop: typed, drawn and image signatures, one flattened', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const source = simplePdf(1);
  const id = await open(page, source, 'signed.pdf');
  const d = page.getByRole('dialog', { name: 'Sign Document' });
  const openSign = async () => {
    await page.getByRole('tab', { name: 'Protect', exact: true }).click();
    await commands(page, 'Protect').getByRole('button', { name: 'Sign Document…' }).click();
    await expect(d).toBeVisible();
  };
  const signatures = async () => (await objects(page, id)).filter((o) => o.subject === 'Signature');

  // Image, flattened after placing (page content, not a comment).
  await openSign();
  await d.getByRole('checkbox', { name: 'Save on this device for next time' }).uncheck();
  await d.getByRole('radio', { name: 'Image' }).check();
  await d.getByLabel('Signature image (PNG or JPG)').setInputFiles({
    name: 'scribble.png',
    mimeType: 'image/png',
    buffer: Buffer.from(await scribblePng()),
  });
  await expect(d.locator('.sign-upload img').first()).toBeVisible();
  await d.getByRole('checkbox', { name: 'Flatten after placing' }).check();
  await d.getByRole('button', { name: 'Place Signature' }).click();
  await clickAt(page, 150, 700);
  // Flattened: the scribble is page content (a dark pixel down the middle), no comment.
  const inked = async () => {
    for (let y = 680; y <= 722; y++) {
      const [r = 255] = (await cap(page, 'pages', 'pixel', id, 0, 150, y)) as number[];
      if (r < 128) return true;
    }
    return false;
  };
  await expect.poll(inked, { timeout: 15_000 }).toBe(true);
  await expect.poll(signatures).toEqual([]);

  // Typed (a stamp) and its initials, each placed with a click.
  await openSign();
  await d.getByRole('radio', { name: 'Type' }).check();
  await d.getByRole('checkbox', { name: 'Save on this device for next time' }).uncheck();
  await d.getByRole('checkbox', { name: 'Flatten after placing' }).uncheck();
  await d.getByRole('button', { name: 'Place Signature' }).click();
  await clickAt(page, 420, 700);
  await expect.poll(async () => (await signatures()).length).toBe(1);
  await openSign();
  await d.getByRole('radio', { name: 'Type' }).check();
  await d.getByLabel('Initials (optional)').fill('PI');
  await expect(d.getByRole('button', { name: 'Place Initials' })).toBeEnabled();
  await d.getByRole('button', { name: 'Place Initials' }).click();
  await clickAt(page, 520, 760);
  await expect.poll(async () => (await signatures()).length).toBe(2);

  // Drawn (ink).
  await openSign();
  await d.getByRole('radio', { name: 'Draw' }).check();
  const pad = await d.getByTestId('sign-pad-signature').boundingBox();
  if (!pad) throw new Error('no pad');
  await page.mouse.move(pad.x + 20, pad.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++)
    await page.mouse.move(pad.x + 20 + i * 12, pad.y + 80 + 30 * Math.sin(i / 2));
  await page.mouse.up();
  await d.getByRole('button', { name: 'Place Signature' }).click();
  await clickAt(page, 420, 600);
  await expect.poll(async () => (await signatures()).length).toBe(3);
  const types = (await signatures()).map((o) => o.type).sort();
  expect(types).toEqual([T.STAMP, T.STAMP, T.INK]);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);
  keep('signatures__ctrl-s.pdf', await save(page, id, source));
});

test('M6 interop: password-protected copies and Remove Security', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf checks the outputs');
  test.setTimeout(120_000);
  const bar = commands(page, 'Protect');
  const d = page.getByRole('dialog', { name: 'Password Security' });
  const out = async () =>
    Buffer.from((await cap(page, 'security', 'lastOutput')) as string, 'base64');
  const protect = async (name: string, opts: { open?: string; perm?: string; deny?: string[] }) => {
    await page.goto('/');
    await open(page, annotatedPdf(), `${name}.pdf`);
    await stubSavePicker(page);
    await page.getByRole('tab', { name: 'Protect', exact: true }).click();
    await bar.getByRole('button', { name: 'Password Security…' }).click();
    await expect(d).toBeVisible();
    if (opts.open) {
      await d.getByLabel('Require a password to open the document').check();
      await d.getByLabel('Open password', { exact: true }).fill(opts.open);
      await d.getByLabel('Confirm open password').fill(opts.open);
    } else {
      await d.getByLabel('Require a password to open the document').uncheck();
    }
    if (opts.perm) {
      await d
        .getByLabel('Restrict printing, changes and copying with a permissions password')
        .check();
      await d.getByLabel('Permissions password', { exact: true }).fill(opts.perm);
      await d.getByLabel('Confirm permissions password').fill(opts.perm);
      for (const label of opts.deny ?? []) await d.getByLabel(label, { exact: true }).uncheck();
    }
    await d.getByRole('button', { name: 'Apply and Save As…' }).click();
    await expect(d.getByTestId('security-result')).toContainText('Every check passed.', {
      timeout: 30_000,
    });
    return out();
  };

  // Both passwords; printing, copying and changing denied (comments and forms allowed).
  const both = await protect('both', {
    open: OPEN_PW,
    perm: PERM_PW,
    deny: ['Printing', 'Copying text and images', 'Changing the document'],
  });
  expect([0, 3]).not.toContain(qpdfStatus(both));
  expect([0, 3]).toContain(qpdfStatus(both, OPEN_PW));
  expect([0, 3]).toContain(qpdfStatus(both, PERM_PW));
  keep('protected-open-and-permissions.pdf', both);

  // Permissions password only: opens without a password, nothing but printing allowed.
  const perm = await protect('perm', {
    perm: PERM_PW,
    deny: [
      'Copying text and images',
      'Changing the document',
      'Page changes (assembly)',
      'Comments',
      'Filling in forms',
    ],
  });
  expect([0, 3]).toContain(qpdfStatus(perm));
  keep('protected-permissions-only.pdf', perm);

  // Open password only.
  const openOnly = await protect('open', { open: OPEN_PW });
  expect([0, 3]).not.toContain(qpdfStatus(openOnly));
  expect([0, 3]).toContain(qpdfStatus(openOnly, OPEN_PW));
  keep('protected-open-only.pdf', openOnly);

  // Remove Security from the both-passwords file (opened with the permissions password).
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', AUTHOR);
  await drop(page, [{ name: 'protected.pdf', b64: b64(both) }]);
  const prompt = page.getByRole('dialog', { name: 'Password required' });
  await prompt.getByLabel('Password').fill(PERM_PW);
  await prompt.getByLabel('Password').press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Protect', exact: true }).click();
  await bar.getByRole('button', { name: 'Remove Security' }).click();
  const r = page.getByRole('dialog', { name: 'Remove Security' });
  await r.getByRole('button', { name: 'Remove and Save As…' }).click();
  await expect(r.getByTestId('security-result')).toContainText(
    'It opens without a password and has no restrictions.',
    { timeout: 30_000 },
  );
  const plain = await out();
  expect([0, 3]).toContain(qpdfStatus(plain));
  keep('unprotected.pdf', plain);
});

test('M6 interop (M5-05): an English OCR layer saved with Ctrl+S', async ({ page, pdfs }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const scan = await pdfs.scanned();
  const id = await open(page, scan, 'scan.pdf');
  await page.getByRole('tab', { name: 'Convert' }).click();
  await commands(page, 'Convert').getByRole('button', { name: 'Recognize Text (OCR)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognize Text (OCR)' });
  await dialog.getByRole('button', { name: 'Recognize' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => cap(page, 'ocr', 'busy'), { timeout: 120_000 }).toBe(false);
  expect(await cap(page, 'ocr', 'last')).toMatchObject({ recognized: 3, skipped: 1 });
  keep('ocr-english__ctrl-s.pdf', await save(page, id, scan));
});
