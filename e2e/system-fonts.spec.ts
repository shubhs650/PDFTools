import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { asCffFont, buildCollection, withFsType } from './fixtures/fonts.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M11-08·O5 (D-54, ADR-028; rules 1, 4, 6, 12): fonts installed on this
// computer in the comment font list. Local Font Access is stubbed with
// self-made fonts (rule 13) built from the vendored library: a usable family,
// one whose license forbids embedding, one with PostScript outlines and a
// face in a collection. Nothing is listed before the click; a chosen family
// is embedded like a library font and read back while the fonts are listed;
// the browser's remembered permission lists them again at start-up.

const VENDOR = join(import.meta.dirname, '..', 'vendor', 'fonts', 'files');
const vendor = (f: string) => new Uint8Array(readFileSync(join(VENDOR, f)));
const arimo = vendor('arimo-regular.ttf');
const FILES: Record<string, Uint8Array> = {
  'Arimo-Regular': arimo,
  'Locked-Regular': withFsType(arimo, 0x0002),
  'Outline-Regular': asCffFont(arimo),
  'Cousine-Regular': buildCollection([arimo, vendor('cousine-regular.ttf')]),
};
const FACES = [
  { family: 'Plant Sans', style: 'Regular', postscriptName: 'Arimo-Regular' },
  { family: 'Locked Font', style: 'Regular', postscriptName: 'Locked-Regular' },
  { family: 'Outline Font', style: 'Regular', postscriptName: 'Outline-Regular' },
  { family: 'Plant Mono', style: 'Regular', postscriptName: 'Cousine-Regular' },
];

/**
 * Chromium's Local Font Access, stubbed: the permission starts as asked
 * ('prompt'), the first query grants it (or is refused) and the browser keeps
 * it (localStorage stands in for the site setting).
 */
async function stubLocalFonts(ctx: BrowserContext, mode: 'allow' | 'deny' = 'allow') {
  await ctx.route('**/__test-local-fonts/*', (route) => {
    const ps = decodeURIComponent(route.request().url().split('/').pop() ?? '');
    const body = FILES[ps];
    return body
      ? route.fulfill({ body: Buffer.from(body), contentType: 'font/ttf' })
      : route.fulfill({ status: 404 });
  });
  await ctx.addInitScript(
    ({ faces, mode }) => {
      const w = window as unknown as { __localFontQueries: number; queryLocalFonts: unknown };
      w.__localFontQueries = 0;
      const granted = () => localStorage.getItem('test.localFonts') === 'granted';
      w.queryLocalFonts = () => {
        w.__localFontQueries += 1;
        if (mode === 'deny') return Promise.reject(new DOMException('no', 'NotAllowedError'));
        localStorage.setItem('test.localFonts', 'granted');
        return Promise.resolve(
          faces.map((f) => ({
            ...f,
            fullName: `${f.family} ${f.style}`,
            blob: () =>
              fetch(`/__test-local-fonts/${encodeURIComponent(f.postscriptName)}`).then((r) =>
                r.blob(),
              ),
          })),
        );
      };
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d: PermissionDescriptor) =>
        (d.name as string) === 'local-fonts'
          ? Promise.resolve({ state: granted() ? 'granted' : 'prompt' } as PermissionStatus)
          : query(d);
    },
    { faces: FACES, mode },
  );
}

const queries = (page: Page) =>
  page.evaluate(() => (window as unknown as { __localFontQueries: number }).__localFontQueries);

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const FREETEXT = 3;
interface Obj {
  id: string;
  contents?: string;
  libraryFont?: string;
  fontFamily?: number;
  commit?: string;
}
const objects = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? [];
const pane = (page: Page) => page.getByTestId('properties-pane');

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  return id;
}

async function synced(page: Page, id: string, n: number) {
  await expect
    .poll(async () => {
      const all = ((await cap(page, 'annotate', 'list', id)) as Obj[] | null) ?? [];
      return all.length === n && all.every((a) => a.commit === 'synced');
    })
    .toBe(true);
}

const box = (text: string, libraryFont = '') => ({
  type: FREETEXT,
  rect: { origin: { x: 60, y: 60 }, size: { width: 320, height: 60 } },
  contents: text,
  fontFamily: 4,
  libraryFont,
  fontSize: 16,
  fontColor: '#1F3A93',
  strokeColor: '#E44234',
  strokeWidth: 1,
  color: 'transparent',
  textAlign: 0,
  verticalAlign: 0,
});

/** Opens the Properties pane's font list for the selected comment. */
async function openFontList(page: Page, id: string, annot: string, current: string) {
  await page.getByRole('tab', { name: 'View' }).click();
  const paneButton = page.getByRole('button', { name: 'Properties Pane', exact: true });
  if ((await paneButton.getAttribute('aria-pressed')) !== 'true') await paneButton.click();
  await cap(page, 'annotate', 'select', id, 0, annot);
  const button = pane(page).getByRole('button', { name: `Font ${current}` });
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('ArrowDown');
  const listbox = page.getByRole('listbox', { name: 'Font' });
  await expect(listbox).toBeFocused();
  return listbox;
}

test('fonts on this computer: listed on the click, checked, chosen, embedded, read back @smoke', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await stubLocalFonts(context);
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (/\.(ttf|otf|woff2?)(\?|$)|__test-local-fonts/u.test(r.url())) fontRequests.push(r.url());
  });
  await page.goto('/');
  const original = simplePdf(1);
  const id = await open(page, original, 'system-fonts.pdf');
  const annot = (await cap(page, 'annotate', 'create', id, 0, box('Plant 42 mm'))) as string;
  await synced(page, id, 1);

  // Nothing is read before the click (D-54).
  const listbox = await openFontList(page, id, annot, 'Helvetica');
  expect(await queries(page)).toBe(0);
  const show = listbox.getByRole('option', { name: 'Show fonts on this computer…' });
  await expect(show).toBeVisible();
  await expect(listbox.locator('[data-group]').last()).toHaveAttribute('data-group', 'system');

  // End, then Enter: the browser lists them (its prompt) and the first is active.
  await page.keyboard.press('End');
  await expect(listbox.locator('[data-active]')).toHaveAttribute('data-action', 'showSystem');
  await page.keyboard.press('Enter');
  const system = listbox.locator('[data-group="system"]');
  await expect(system.getByRole('option')).toHaveCount(4);
  expect(await queries(page)).toBe(1);
  await expect(listbox.locator('[data-active]')).toHaveAttribute('data-font', 'sys:Locked Font');

  // Checked as they come into view (End shows them all): the ones that cannot be used are
  // disabled, with the reason.
  await page.keyboard.press('End');
  await expect(listbox.locator('[data-active]')).toHaveAttribute('data-font', 'sys:Plant Sans');
  const locked = system.getByRole('option', { name: 'Locked Font' });
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  await expect(locked).toHaveAccessibleDescription("License doesn't allow embedding");
  const outline = system.getByRole('option', { name: 'Outline Font' });
  await expect(outline).toHaveAttribute('aria-disabled', 'true');
  await expect(outline).toHaveAccessibleDescription("PostScript outlines aren't supported");
  await expect(system.getByRole('option', { name: 'Plant Sans' })).not.toHaveAttribute(
    'aria-disabled',
  );
  // A disabled font is not chosen.
  await locked.click({ force: true });
  await expect(listbox).toBeVisible();
  await expect(pane(page).getByRole('button', { name: 'Font Helvetica' })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const { violations } = await new AxeBuilder({ page }).include('.ui-font-popup').analyze();
    expect(
      violations.map((v) => v.id),
      theme,
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });

  // Type-ahead reaches them too; Enter chooses Plant Sans.
  await page.keyboard.type('plant s');
  await expect(listbox.locator('[data-active]')).toHaveAttribute('data-font', 'sys:Plant Sans');
  await page.keyboard.press('Enter');
  await expect(listbox).toHaveCount(0);
  await expect.poll(async () => (await objects(page, id))[0]?.libraryFont).toBe('sys:Plant Sans');
  await expect(pane(page).getByRole('button', { name: 'Font Plant Sans' })).toBeFocused();
  await synced(page, id, 1);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);

  // Saved: the face is embedded (subset, Type0) and /DS names the family.
  const s = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(s.mode).toBe('narrow');
  const tail = Buffer.from(s.tail, 'base64').toString('latin1');
  expect(tail).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Arimo-Regular/u);
  expect(tail).toContain("font: 'Plant Sans' 16pt");
  // Rule 4: every font came from our own origin (the stub stands in for the computer).
  const origin = new URL(page.url()).origin;
  for (const u of fontRequests) expect(new URL(u).origin).toBe(origin);

  // A face of a collection.
  const mono = (await cap(page, 'annotate', 'create', id, 0, {
    ...box('Mono 42', 'sys:Plant Mono'),
    rect: { origin: { x: 60, y: 200 }, size: { width: 320, height: 60 } },
  })) as string;
  expect(mono).toBeTruthy();
  await synced(page, id, 2);
  const s2 = (await cap(page, 'save', 'verifiedSave', id)) as { tail: string };
  expect(Buffer.from(s2.tail, 'base64').toString('latin1')).toMatch(/\+Cousine-Regular/u);

  // Recently used keeps the name only.
  const recent = await page.evaluate(() => localStorage.getItem('pdftools.recentFonts'));
  expect(JSON.parse(recent ?? '[]')).toContain('sys:Plant Sans');

  // Next start: the browser remembers the permission, so they are listed without a click;
  // the reopened comment keeps its family, and an edit is drawn in it again.
  const file = Buffer.concat([
    Buffer.from(original),
    Buffer.from(s.tail, 'base64'),
    Buffer.from(s2.tail, 'base64'),
  ]);
  await page.goto('/');
  await expect.poll(() => queries(page)).toBe(1);
  const again = await open(page, file, 'system-fonts-again.pdf');
  await expect.poll(async () => (await objects(page, again)).length).toBe(2);
  const back = await objects(page, again);
  const plant = back.find((o) => o.contents === 'Plant 42 mm');
  expect(plant?.libraryFont).toBe('sys:Plant Sans');
  await cap(page, 'annotate', 'update', again, 0, plant?.id, { contents: 'Plant 43 mm' });
  await synced(page, again, 2);
  const s3 = (await cap(page, 'save', 'verifiedSave', again)) as { tail: string };
  expect(Buffer.from(s3.tail, 'base64').toString('latin1')).toMatch(/\+Arimo-Regular/u);
});

test('fonts on this computer: refused by the browser', async ({ page, context }) => {
  test.setTimeout(120_000);
  await stubLocalFonts(context, 'deny');
  await page.goto('/');
  const id = await open(page, simplePdf(1), 'denied.pdf');
  const annot = (await cap(page, 'annotate', 'create', id, 0, box('Denied'))) as string;
  await synced(page, id, 1);
  const listbox = await openFontList(page, id, annot, 'Helvetica');
  await listbox.getByRole('option', { name: 'Show fonts on this computer…' }).click();
  await expect(
    listbox.getByRole('option', {
      name: "Not allowed. Allow fonts in the browser's site settings, then choose this again.",
    }),
  ).toBeVisible();
  expect(await queries(page)).toBe(1);
  // Nothing listed, nothing chosen; the list still works.
  await expect(listbox.locator('[data-group="system"] [data-font^="sys:"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
});
