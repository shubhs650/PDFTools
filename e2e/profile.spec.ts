import type { Page } from '@playwright/test';
import { buildPdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M3-07 (D-16, M3-Q7): the reviewer profile — asked before the first markup of
// a session, stored on this device only, the author (/T) of new annotations;
// an edit never re-authors someone else's markup (D-03).

interface Listed {
  id: string;
  author: string | null;
}

const list = (page: Page, id: string) =>
  cap(page, 'annotate', 'list', id) as Promise<Listed[] | null>;
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Who is reviewing?' });
const backstage = (page: Page) => page.getByTestId('backstage');

/** One page with a red square markup by "Old viewer" (object 4). */
function markedPdf(): Buffer {
  return Buffer.from(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>',
      '<< /Type /Annot /Subtype /Square /NM (old-1) /Rect [100 600 300 700] /T (Old viewer) /C [1 0 0] /BS << /W 4 >> /AP << /N 5 0 R >> >>',
      {
        dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 100] >>',
        stream: '1 0 0 RG 4 w 2 2 196 96 re S',
      },
    ]),
  );
}

async function openMarked(page: Page): Promise<string> {
  await page.goto('/');
  await drop(page, [{ name: 'marked.pdf', b64: markedPdf().toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(async () => (await list(page, id))?.length ?? 0).toBe(1);
  return id;
}

const create = (page: Page, id: string) =>
  cap(page, 'annotate', 'createSquare', id, 0, 50, 50) as Promise<string>;

const authorOf = async (page: Page, docId: string, id: string) =>
  (await list(page, docId))?.find((a) => a.id === id)?.author ?? null;

async function savedTail(page: Page, id: string): Promise<string> {
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as { mode: string; tail: string };
  expect(saved.mode).toBe('narrow');
  return Buffer.from(saved.tail, 'base64').toString('latin1');
}

test('first markup asks for the profile; the name is the author, saved as /T', async ({ page }) => {
  const id = await openMarked(page);
  const made = create(page, id);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Name')).toBeFocused();
  // Name is required.
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('Enter your name.');
  await dialog(page).getByLabel('Name').fill('Ana de Vries');
  await expect(dialog(page).getByLabel('Initials')).toHaveAttribute('placeholder', 'ADV');
  await dialog(page).getByLabel('Discipline').fill('Structural');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeHidden();
  const annot = await made;
  await expect.poll(() => authorOf(page, id, annot)).toBe('Ana de Vries');

  // The next markup doesn't ask again.
  const second = await create(page, id);
  await expect.poll(() => authorOf(page, id, second)).toBe('Ana de Vries');
  await expect(dialog(page)).toBeHidden();
  const tail = await savedTail(page, id);
  expect(tail.match(/\/T\s*\(Ana de Vries\)/g)?.length).toBe(2);

  // Stored on this device: a new session knows it and doesn't ask.
  await page.reload();
  const again = await openMarked(page);
  const third = await create(page, again);
  await expect.poll(() => authorOf(page, again, third)).toBe('Ana de Vries');
  expect(await cap(page, 'annotate', 'profile')).toMatchObject({
    profile: { name: 'Ana de Vries', initials: 'ADV', discipline: 'Structural', company: '' },
  });
});

test('Skip makes anonymous markups this session and asks again in the next', async ({ page }) => {
  const id = await openMarked(page);
  const made = create(page, id);
  await dialog(page).getByRole('button', { name: 'Skip for now' }).click();
  const annot = await made;
  await expect.poll(() => authorOf(page, id, annot)).toBe('Anonymous');
  const second = await create(page, id);
  await expect.poll(() => authorOf(page, id, second)).toBe('Anonymous');
  await expect(dialog(page)).toBeHidden();

  await page.reload();
  const again = await openMarked(page);
  const next = create(page, again);
  await expect(dialog(page)).toBeVisible();
  // Esc is Skip too.
  await page.keyboard.press('Escape');
  await expect.poll(async () => authorOf(page, again, await next)).toBe('Anonymous');
});

test('editing someone else’s markup keeps its author, in the store and in the file', async ({
  page,
}) => {
  const id = await openMarked(page);
  const made = create(page, id);
  await dialog(page).getByLabel('Name').fill('Ana de Vries');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await made;

  await cap(page, 'annotate', 'select', id, 0, 'old-1');
  await page.getByTestId('document-view').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => authorOf(page, id, 'old-1')).toBe('Old viewer');
  const tail = await savedTail(page, id);
  expect(tail).toMatch(/\/NM\s*\(old-1\)/);
  expect(tail).toMatch(/\/T\s*\(Old viewer\)/);
  // Undo keeps it too.
  await page.keyboard.press('Control+z');
  await expect.poll(() => authorOf(page, id, 'old-1')).toBe('Old viewer');
});

test('Settings edits the profile; Clear all local data removes it', async ({ page }) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
  await page.goto('/');
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  const section = backstage(page).getByTestId('profile-section');
  await expect(section).toContainText('No profile yet');
  await section.getByRole('button', { name: 'Edit reviewer profile…' }).click();
  const edit = page.getByRole('dialog', { name: 'Reviewer profile' });
  await edit.getByLabel('Name').fill('Bo Li');
  await edit.getByLabel('Initials').fill('BL');
  await edit.getByLabel('Company').fill('Example Engineering');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(section).toContainText('Bo Li');
  await expect(section).toContainText('Example Engineering');

  await page.reload();
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(section).toContainText('Bo Li');
  await backstage(page).getByRole('button', { name: 'Clear all local data…' }).click();
  await page
    .getByRole('dialog', { name: 'Clear all local data?' })
    .getByRole('button', { name: 'Clear data' })
    .click();
  await expect(section).toContainText('No profile yet');
  await page.reload();
  await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(section).toContainText('No profile yet');
});
