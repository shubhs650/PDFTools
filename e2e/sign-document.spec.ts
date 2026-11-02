import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { encodePng } from '../src/workers/work/png.ts';

// M6-13 (ADR-021 D-40 b, ADR-022 decision 3; beta review C1; rules 6, 7, 9, 12):
// Protect → Sign Document. Typed (the reviewer's name in a bundled handwriting
// font), drawn and uploaded signatures and initials; placed with a click (or
// Enter / the keyboard: the middle of the page) as standard Stamp and Ink
// annotations with /Subj (Signature); saved on this device, kept over a
// reload, removed by "Clear all local data"; optionally flattened.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const STAMP = 13;
const INK = 15;

interface Obj {
  id: string;
  type: number;
  subject?: string;
  pageIndex: number;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
}

const signatures = async (page: Page, id: string) =>
  (((await cap(page, 'annotate', 'objects', id)) as Obj[] | null) ?? []).filter(
    (o) => o.subject === 'Signature',
  );

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Protect commands' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Sign Document' });

async function open(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await cap(page, 'annotate', 'setProfile', 'Ada Lovelace');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

async function openSign(page: Page) {
  await page.getByRole('tab', { name: 'Protect', exact: true }).click();
  await toolbar(page).getByRole('button', { name: 'Sign Document…' }).click();
  await expect(dialog(page)).toBeVisible();
}

/** The on-screen position of a page point (top-left origin). */
async function screenPoint(page: Page, pageIndex: number, x: number, y: number) {
  const box = await page.locator(`[data-page="${String(pageIndex)}"] .page-content`).boundingBox();
  if (!box) throw new Error(`page ${String(pageIndex)} not laid out`);
  const k = box.width / 595;
  return { x: box.x + x * k, y: box.y + y * k };
}

const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);

/** A 240 × 80 PNG on a white background with a dark scribble (Upload). */
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

test('Sign Document: type, place with a click, saved and placed again from the keyboard, drawn, saved by Ctrl+S @smoke', async ({
  page,
}) => {
  await page.goto('/');
  const source = simplePdf(1);
  const id = await open(page, source, 'contract.pdf');

  await openSign(page);
  const d = dialog(page);
  await expect(d.getByRole('note')).toContainText(
    'This is a visual signature, not a certificate-based digital signature',
  );
  // No saved signatures yet: Type, with the reviewer's name and initials.
  await expect(d.getByRole('radio', { name: 'Type' })).toBeChecked();
  await expect(d.getByLabel('Name', { exact: true })).toHaveValue('Ada Lovelace');
  await expect(d.getByLabel('Initials (optional)')).toHaveValue('AL');
  await expect(d.getByRole('radio', { name: 'Allura' })).toBeChecked();
  expect(await axe(page)).toEqual([]);

  // Place Signature (a click): the dialog closes, the next click on the page places it.
  await d.getByRole('button', { name: 'Place Signature' }).click();
  await expect(d).toBeHidden();
  const at = await screenPoint(page, 0, 300, 200);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await signatures(page, id)).length).toBe(1);
  const [typed] = await signatures(page, id);
  expect(typed).toMatchObject({ type: STAMP, pageIndex: 0 });
  // Centred on the click, inside the 150 × 50 pt box, aspect kept.
  const r = typed?.rect;
  if (!r) throw new Error('not placed');
  expect(r.origin.x + r.size.width / 2).toBeCloseTo(300, 0);
  expect(r.origin.y + r.size.height / 2).toBeCloseTo(200, 0);
  expect(Math.max(r.size.width / 150, r.size.height / 50)).toBeCloseTo(1, 1);
  // The tool turns itself off; the new signature is selected.
  await expect.poll(async () => cap(page, 'annotate', 'selected', id)).toEqual([typed.id]);

  // Saved on this device: the dialog opens on it; Place Initials from the keyboard
  // goes straight to the middle of the page.
  await openSign(page);
  await expect(d.getByRole('radio', { name: 'Saved (1)' })).toBeChecked();
  await expect(
    d.getByRole('list', { name: 'Saved on this device' }).getByRole('listitem'),
  ).toHaveCount(1);
  expect(await axe(page)).toEqual([]);
  await d.getByRole('button', { name: 'Place Initials' }).focus();
  await page.keyboard.press('Enter');
  await expect(d).toBeHidden();
  await expect.poll(async () => (await signatures(page, id)).length).toBe(2);
  const initials = (await signatures(page, id)).find((o) => o.id !== typed.id);
  const ri = initials?.rect;
  if (!ri) throw new Error('initials not placed');
  expect(initials.type).toBe(STAMP);
  expect(ri.origin.x + ri.size.width / 2).toBeCloseTo(595 / 2, 0);
  expect(ri.origin.y + ri.size.height / 2).toBeCloseTo(842 / 2, 0);
  expect(ri.size.width).toBeLessThan(r.size.width);

  // Draw: strokes on the pad become an Ink signature (not saved this time).
  await openSign(page);
  await d.getByRole('radio', { name: 'Draw' }).check();
  await d.getByRole('checkbox', { name: 'Save on this device for next time' }).uncheck();
  const pad = await d.getByTestId('sign-pad-signature').boundingBox();
  if (!pad) throw new Error('no pad');
  await page.mouse.move(pad.x + 20, pad.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++)
    await page.mouse.move(pad.x + 20 + i * 12, pad.y + 80 + 30 * Math.sin(i / 2));
  await page.mouse.up();
  await expect(d.getByRole('button', { name: 'Place Signature' })).toBeEnabled();
  await expect(d.getByRole('button', { name: 'Place Initials' })).toBeDisabled();
  await d.getByRole('button', { name: 'Place Signature' }).click();
  const at2 = await screenPoint(page, 0, 200, 120);
  await page.mouse.move(at2.x, at2.y);
  await page.mouse.click(at2.x, at2.y);
  await expect.poll(async () => (await signatures(page, id)).length).toBe(3);
  const drawn = (await signatures(page, id)).find((o) => o.type === INK);
  expect(drawn).toBeDefined();
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);

  // Ctrl+S: one narrow, verified revision; the file reopens with all three.
  await expect
    .poll(async () => {
      const list = (await cap(page, 'annotate', 'list', id)) as { commit: string }[] | null;
      return list?.every((a) => a.commit === 'synced') ?? false;
    })
    .toBe(true);
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved).toMatchObject({ mode: 'narrow', fellBack: false });
  const file = Buffer.concat([Buffer.from(source), Buffer.from(saved.tail, 'base64')]);
  const again = await open(page, new Uint8Array(file), 'signed.pdf');
  await expect.poll(async () => (await signatures(page, again)).length).toBe(3);
  const back = await signatures(page, again);
  expect(back.filter((o) => o.type === STAMP)).toHaveLength(2);
  expect(back.filter((o) => o.type === INK)).toHaveLength(1);

  // Only the typed one was saved, and it is still there after a reload.
  await page.reload();
  await open(page, simplePdf(1), 'other.pdf');
  await openSign(page);
  await expect(d.getByRole('radio', { name: 'Saved (1)' })).toBeChecked();
});

test('Sign Document: an uploaded image (white made transparent), flatten after placing, Clear all local data', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(1), 'upload.pdf');
  await openSign(page);
  const d = dialog(page);
  await d.getByRole('radio', { name: 'Image' }).check();
  await expect(
    d.getByRole('checkbox', { name: 'Make a white background transparent' }),
  ).toBeChecked();
  await d.getByLabel('Signature image (PNG or JPG)').setInputFiles({
    name: 'scribble.png',
    mimeType: 'image/png',
    buffer: Buffer.from(await scribblePng()),
  });
  await expect(d.locator('.sign-upload img').first()).toBeVisible();
  // A file that is not an image: refused with a reason.
  await d.getByLabel('Initials image (optional)').setInputFiles({
    name: 'notes.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not a picture'),
  });
  await expect(d.getByRole('alert')).toContainText('not a PNG or JPG image');
  await expect(d.getByRole('button', { name: 'Place Initials' })).toBeDisabled();
  expect(await axe(page)).toEqual([]);

  // Flatten after placing: the signature becomes page content.
  await d.getByRole('checkbox', { name: 'Flatten after placing' }).check();
  await d.getByRole('button', { name: 'Place Signature' }).click();
  const at = await screenPoint(page, 0, 300, 200);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(async () => cap(page, 'annotate', 'objects', id), { timeout: 15_000 })
    .toEqual([]);
  expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);

  // Saved: listed, then gone after Clear all local data.
  await openSign(page);
  await expect(d.getByRole('radio', { name: 'Saved (1)' })).toBeChecked();
  await d.getByRole('button', { name: 'Cancel' }).click();
  page.on('dialog', (x) => {
    void x.accept();
  });
  await page.getByTestId('file-tab').click();
  const backstage = page.getByTestId('backstage');
  await backstage.getByRole('button', { name: 'Settings', exact: true }).click();
  await backstage.getByRole('button', { name: 'Clear all local data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(confirm).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(backstage).toBeHidden();
  // The reviewer profile went too (Sign Document would ask for it): set it again.
  await cap(page, 'annotate', 'setProfile', 'Ada Lovelace');
  await openSign(page);
  await expect(d.getByRole('radio', { name: /Saved/ })).toHaveCount(0);
  await expect(d.getByRole('radio', { name: 'Type' })).toBeChecked();
});

test('a document that forbids adding comments disables Sign Document (rule 9)', async ({
  page,
}) => {
  test.skip(!hasQpdf(), 'qpdf not installed');
  await page.goto('/');
  const locked = qpdfEncrypt(simplePdf(1), USER_PW, OWNER_PW, ['256', '--annotate=n']);
  await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
  await page
    .getByRole('dialog', { name: 'Password required' })
    .getByLabel('Password')
    .fill(USER_PW);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Protect', exact: true }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Sign Document…' })).toBeDisabled();
});
