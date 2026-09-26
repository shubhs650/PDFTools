import type { Page } from '@playwright/test';
import { cap } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M1-24: OPFS crash recovery. Edits come from the e2e save probe; a page
// reload stands in for a crash (the beforeunload prompt is accepted).

interface Snapshot {
  fp: string;
  originalBytes: number;
  tailBytes: number;
  ui: Record<string, unknown> | null;
}

const pageBox = (page: Page) =>
  page
    .getByRole('contentinfo', { name: 'Status bar' })
    .getByRole('textbox', { name: 'Page number' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const snapshots = async (page: Page) => (await cap(page, 'storage', 'list')) as Snapshot[];

async function openHandle(page: Page, name: string, bytes: Buffer): Promise<string> {
  const before = await tabs(page).count();
  const [id] = (await cap(page, 'open', 'openHandles', [
    { name, b64: bytes.toString('base64') },
  ])) as string[];
  if (!id) throw new Error('not opened');
  await expect(tabs(page)).toHaveCount(before + 1);
  return id;
}

const squares = async (page: Page, id: string) =>
  (
    (await cap(page, 'save', 'workDigest', id, [0])) as {
      pages: { annots: { subtype: number }[] }[];
    }
  ).pages[0]?.annots.filter((a) => a.subtype === 5).length ?? 0;

const activeId = async (page: Page) =>
  ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;

/** `beforeunload` would ask (a synthetic event is cancelled by our handler). */
const unloadAsks = (page: Page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
});

test('opening writes nothing; an edit is snapshotted ~5 s later; reload → Recover restores the edit and the page', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const id = await openHandle(page, 'report.pdf', pdfs.simple(5));
  expect(await snapshots(page)).toEqual([]);
  expect(await unloadAsks(page)).toBe(false);

  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  await pageBox(page).fill('4');
  await pageBox(page).press('Enter');
  await expect(pageBox(page)).toHaveValue('4');
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
  expect(await unloadAsks(page)).toBe(true);
  await expect.poll(() => snapshots(page), { timeout: 10_000 }).toHaveLength(1);
  const [snap] = await snapshots(page);
  expect(snap?.tailBytes).toBeGreaterThan(0);
  expect(snap?.ui).toMatchObject({ name: 'report.pdf', page: 3 });

  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved changes?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('report.pdf');
  await dialog.getByRole('button', { name: 'Recover report.pdf' }).click();
  await expect(dialog).toBeHidden();
  await expect(tabs(page).first()).toHaveAccessibleName('report.pdf, unsaved changes');
  const rid = await activeId(page);
  expect(await squares(page, rid)).toBe(2);
  await expect(pageBox(page)).toHaveValue('4');
});

test('Discard clears the snapshot; a later launch offers nothing', async ({ page, pdfs }) => {
  await page.goto('/');
  const id = await openHandle(page, 'drop-me.pdf', pdfs.simple(1));
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await expect.poll(() => snapshots(page), { timeout: 10_000 }).toHaveLength(1);

  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved changes?' });
  await dialog.getByRole('button', { name: 'Discard changes to drop-me.pdf' }).click();
  await expect(dialog).toBeHidden();
  expect(await snapshots(page)).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('a successful save clears the snapshot; beforeunload stops asking', async ({ page, pdfs }) => {
  await page.goto('/');
  const id = await openHandle(page, 'saved.pdf', pdfs.contract(20));
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await expect.poll(() => snapshots(page), { timeout: 10_000 }).toHaveLength(1);
  await page.keyboard.press('Control+S');
  await expect(tabs(page).first()).toHaveAccessibleName('saved.pdf');
  await expect.poll(() => snapshots(page)).toEqual([]);
  expect(await unloadAsks(page)).toBe(false);
});

test('Recover re-links to the unchanged file from the recent list: Ctrl+S writes the recovered and new changes', async ({
  page,
  pdfs,
}) => {
  await page.goto('/');
  const original = pdfs.contract(20);
  const id = await openHandle(page, 'linked.pdf', original);
  expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
  await expect.poll(() => snapshots(page), { timeout: 10_000 }).toHaveLength(1);

  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Recover unsaved changes?' });
  await dialog.getByRole('button', { name: 'Recover linked.pdf' }).click();
  await expect(tabs(page).first()).toHaveAccessibleName('linked.pdf, unsaved changes');
  const rid = await activeId(page);
  expect(await cap(page, 'save', 'addSquares', rid, 1, 2)).toBeNull();
  await page.keyboard.press('Control+S');
  await expect(tabs(page).first()).toHaveAccessibleName('linked.pdf');

  const saved = Buffer.from(
    (await cap(page, 'open', 'readFile', 'linked.pdf')) as string,
    'base64',
  );
  expect(saved.subarray(0, original.length).equals(original)).toBe(true);
  expect((saved.toString('latin1').match(/\/Subtype\s*\/Square/g) ?? []).length).toBe(3);
  await expect.poll(() => snapshots(page)).toEqual([]);
});
