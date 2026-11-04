import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { OWNER_PW, USER_PW, hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import { reviewSourcePdf as sourcePdf } from './fixtures/comments.ts';
import { markedContractPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';

// M4-20 (§7.1, ADR-018): Comment → Import Comments from another PDF (object
// copy: appearances, replies and states travel as they are) or from our JSON
// v1 export (re-created); filters, page mapping, a preview of what is
// skipped, one undo step, a narrow verified save that reopens; a restricted
// source is refused (rule 9); the dialog works by keyboard alone.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

interface Listed {
  id: string;
  page: number;
  author: string | null;
}

const list = async (page: Page, id: string) =>
  ((await cap(page, 'annotate', 'list', id)) as Listed[] | null) ?? [];

async function open(page: Page, bytes: Uint8Array, name = 'target.pdf'): Promise<string> {
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
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

const commentBar = (page: Page) => page.getByRole('toolbar', { name: 'Comment commands' });

async function openDialog(page: Page) {
  await page.getByRole('tab', { name: 'Comment' }).click();
  await commentBar(page).getByRole('button', { name: 'Import Comments' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Comments' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('from a PDF: filters, missing page, one undo step, saved narrow and reopened', async ({
  page,
}) => {
  await page.goto('/');
  const id = await open(page, simplePdf(2));
  await stubPicker(page, 'rev-a.pdf', sourcePdf(), 'application/pdf');
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
  await expect(dialog.getByText('rev-a.pdf: 3 comments on 3 pages.')).toBeVisible();
  await expect(dialog.getByText('Statuses: Accepted: 1.')).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText(
    '2 comments will be imported (4 annotations',
  );
  await expect(dialog.getByRole('status')).toContainText('1 on a page this document doesn');
  // Only Ana's comments (Bo's reply comes with hers).
  await dialog.getByLabel('Bo (1)').uncheck();
  await expect(dialog.getByRole('status')).toContainText(
    '1 comment will be imported (3 annotations',
  );
  expect((await new AxeBuilder({ page }).include('.ui-dialog').analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await list(page, id)).map((a) => a.id).sort())
    .toEqual(['src-reply', 'src-square', 'src-state']);
  // The Comments pane numbers it.
  await commentBar(page).getByRole('button', { name: 'Comments Pane' }).click();
  await expect(page.getByRole('complementary', { name: 'Navigation panes' })).toContainText(
    'Check weld size',
  );

  // One undo step; redo brings it back.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect.poll(async () => (await list(page, id)).length).toBe(0);
  await page.getByRole('button', { name: 'Redo' }).first().click();
  await expect.poll(async () => (await list(page, id)).length).toBe(3);

  // Ctrl+S (the verified flow): one narrow revision, reopened with the thread.
  const saved = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(saved.mode).toBe('narrow');
  expect(saved.fellBack).toBe(false);
  const file = Buffer.concat([Buffer.from(simplePdf(2)), Buffer.from(saved.tail, 'base64')]);
  if (hasQpdf()) {
    const f = join(mkdtempSync(join(tmpdir(), 'transfer-e2e-')), 'saved.pdf');
    writeFileSync(f, file);
    expect(spawnSync('qpdf', ['--check', f]).status).toBe(0);
  }
  const [again] = (await cap(page, 'open', 'openHandles', [
    { name: 'saved.pdf', b64: file.toString('base64') },
  ])) as string[];
  if (!again) throw new Error('not reopened');
  await expect
    .poll(async () =>
      (await list(page, again)).map((a) => `${a.id}:${a.author ?? ''}:${String(a.page)}`).sort(),
    )
    .toEqual(['src-reply:Bo:0', 'src-square:Ana:0', 'src-state:Ana:0']);
});

test('a restricted source needs its owner password', async ({ page }) => {
  test.skip(!hasQpdf(), 'qpdf makes the encrypted file');
  await page.goto('/');
  const id = await open(page, simplePdf(3));
  const locked = qpdfEncrypt(sourcePdf(), USER_PW, OWNER_PW, ['256', '--extract=n']);
  await stubPicker(page, 'locked.pdf', locked, 'application/pdf');
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
  await dialog.getByLabel('Password for locked.pdf').fill(USER_PW);
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByRole('alert')).toContainText("doesn't allow its comments to be copied");
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await dialog.getByLabel('Password for locked.pdf').fill(OWNER_PW);
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByText('locked.pdf: 3 comments on 3 pages.')).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('3 comments will be imported');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(async () => (await list(page, id)).length).toBe(5);
});

test('from our JSON export, by keyboard: shifted a page; a newer version is refused', async ({
  page,
}) => {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  // A JSON v1 export of 2 pages × 3 rectangles (M4-08).
  const src = await open(page, markedContractPdf(2, 3), 'pump.pdf');
  await expect.poll(async () => (await list(page, src)).length).toBe(6);
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Comment' }).click();
  await commentBar(page)
    .getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' })
    .click();
  const exp = page.getByRole('dialog', { name: 'Export Annotations' });
  await exp.getByLabel('JSON (.json) — can be imported again').check();
  await exp.getByRole('button', { name: 'Export' }).click();
  await expect(exp).toBeHidden();
  const f = (await cap(page, 'annotate', 'lastAnnotationExport')) as { b64: string } | null;
  if (!f) throw new Error('no export');
  const json = Buffer.from(f.b64, 'base64');

  const id = await open(page, simplePdf(2));
  // A newer version first: refused with a message.
  const newer = JSON.parse(json.toString('utf8')) as { version: number };
  newer.version = 2;
  await stubPicker(page, 'newer.json', Buffer.from(JSON.stringify(newer)), 'application/json');
  await page.getByRole('tab', { name: 'Comment' }).click();
  const button = commentBar(page).getByRole('button', { name: 'Import Comments' });
  await button.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Import Comments' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('made by a newer version of Triya PDF');

  await stubPicker(page, 'pump (annotations).json', json, 'application/json');
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('pump (annotations).json: 6 comments on 2 pages.')).toBeVisible();
  // Shifted by one page: page 2's comments have nowhere to go.
  await dialog.getByLabel('Shifted by a number of pages').focus();
  await page.keyboard.press('Space');
  const shift = dialog.getByLabel('Pages to shift (negative: earlier)');
  await shift.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('1');
  await expect(dialog.getByRole('status')).toContainText('3 comments will be imported');
  await expect(dialog.getByRole('status')).toContainText("3 on pages this document doesn't have");
  await dialog.getByRole('button', { name: 'Import', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await list(page, id)).map((a) => a.page)).toEqual([1, 1, 1]);
  // Imported again: already there.
  await stubPicker(page, 'pump (annotations).json', json, 'application/json');
  const again = await openDialog(page);
  await again.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
  await expect(again.getByRole('status')).toContainText('3 already in this document');
});
