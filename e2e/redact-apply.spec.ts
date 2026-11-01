import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { adversarialPdf, HIDDEN, markedBulkPdf, SECRETS } from './fixtures/redaction.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';
import { isDict, PdfStream, PdfString, type PdfValue } from '../src/model/pdf/objects.ts';
import { PdfReader } from '../src/model/pdf/reader.ts';

// M4-17/18 (§7.9 steps 2–5, rule 8): Protect → Apply Redactions over the
// self-made adversarial file — a new, verified file is written (the open
// document is left as it is); a page the redaction cannot clean (a line
// crossing the area inside a Form XObject) fails verification and nothing is
// written; a step left out (e2e probe) fails too; Cancel writes nothing.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Protect commands' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Pending Redactions' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Apply Redactions' });

async function open(page: Page, bytes: Uint8Array, name = 'adversarial.pdf'): Promise<string> {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await drop(page, [{ name, b64: b64(bytes) }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Protect' }).click();
  return id;
}

/** Every canary found in any decoded stream or string of the file. */
async function canaries(bytes: Uint8Array, words: readonly string[]): Promise<string[]> {
  const r = await PdfReader.open(bytes);
  const found = new Set<string>();
  const dec = new TextDecoder('latin1');
  const scan = (s: string) => {
    for (const c of words) if (s.includes(c)) found.add(c);
  };
  const walk = async (v: PdfValue, depth: number): Promise<void> => {
    if (depth > 30) return;
    if (v instanceof PdfString) scan(dec.decode(v.bytes));
    else if (Array.isArray(v)) for (const x of v) await walk(x, depth + 1);
    else if (isDict(v)) for (const x of v.values()) await walk(x, depth + 1);
    else if (v instanceof PdfStream) {
      await walk(v.dict, depth + 1);
      try {
        scan(dec.decode(await r.decode(v)));
      } catch {
        scan(dec.decode(v.raw));
      }
    }
  };
  for (const num of r.xref.keys()) await walk(await r.get(num), 0).catch(() => undefined);
  return [...found];
}

async function removePage9Mark(page: Page) {
  await bar(page).getByRole('button', { name: 'Pending Redactions' }).click();
  await expect(panel(page)).toContainText('9 marks waiting to be applied.');
  await panel(page)
    .getByRole('button', { name: /^Remove mark 9\. .*page 9$/ })
    .click();
  await expect(panel(page)).toContainText('8 marks waiting to be applied.');
}

test('apply: a new verified file without any secret; the open document stays as it is @smoke', async ({
  page,
}) => {
  const id = await open(page, adversarialPdf());
  await expect(page.getByRole('button', { name: '9 redaction marks' })).toBeVisible();
  await removePage9Mark(page);
  await bar(page).getByRole('button', { name: 'Apply Redactions' }).click();
  const d = dialog(page);
  await expect(d).toContainText('8 marks on 8 pages will be applied.');
  await expect(d).toContainText('A new file is created (adversarial-redacted.pdf).');
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  await expect(d.getByTestId('redact-result')).toContainText(
    'Saved adversarial-redacted.pdf. Every check passed.',
    { timeout: 30_000 },
  );
  await expect(d).toContainText('8 marks applied on 8 pages.');
  expect((await savedFiles(page)).map((f) => f.name)).toEqual(['adversarial-redacted.pdf']);
  const out = Buffer.from((await cap(page, 'redact', 'lastOutput')) as string, 'base64');
  // Page 9 (its mark removed) holds only a line: no secret or hidden data may remain anywhere.
  expect(await canaries(new Uint8Array(out), [...SECRETS, ...HIDDEN])).toEqual([]);
  // The open document still has its marks and is not changed by Apply.
  const redacts = async () =>
    (((await cap(page, 'annotate', 'list', id)) as { type: number }[] | null) ?? []).filter(
      (a) => a.type === 28,
    ).length;
  expect(await redacts()).toBe(8);
  await d.getByRole('button', { name: 'Open Redacted File' }).click();
  await expect(page.getByRole('tab', { name: /adversarial-redacted\.pdf/ })).toBeVisible();
});

test('verification failure: nothing is written; the pages and checks are named; report offered', async ({
  page,
}) => {
  await open(page, adversarialPdf());
  await bar(page).getByRole('button', { name: 'Apply Redactions' }).click();
  const d = dialog(page);
  await expect(d).toContainText('9 marks on 9 pages will be applied.');
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  const failure = d.getByTestId('redact-failure');
  await expect(failure).toContainText('nothing was saved', { timeout: 30_000 });
  await expect(failure).toContainText('page 9: drawing (vector lines or areas)');
  expect(await savedFiles(page)).toEqual([]);
  expect(await cap(page, 'redact', 'lastOutput')).toBeNull();
  await d.getByRole('button', { name: 'Send Error Report…' }).click();
  const report = page.getByRole('dialog', { name: /error report/i });
  await expect(report).toBeVisible();
  await expect(report).not.toContainText('SECRETALPHA');
});

test('a step left out (e2e probe) fails verification; Cancel writes nothing', async ({ page }) => {
  await open(page, adversarialPdf());
  await removePage9Mark(page);
  await cap(page, 'redact', 'skip', 'recut');
  await bar(page).getByRole('button', { name: 'Apply Redactions' }).click();
  let d = dialog(page);
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  await expect(d.getByTestId('redact-failure')).toContainText('page 4: drawing', {
    timeout: 30_000,
  });
  await cap(page, 'redact', 'skip', null);
  await d.getByRole('button', { name: 'Close' }).first().click();

  // Cancel on a 200-page file with 600 marks.
  await open(page, markedBulkPdf(200, 3), 'bulk.pdf');
  await bar(page).getByRole('button', { name: 'Apply Redactions' }).click();
  d = dialog(page);
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d.getByRole('button', { name: 'Apply and Save As…' })).toBeVisible();
  await expect(d.getByRole('alert')).toHaveCount(0);
  expect(await savedFiles(page)).toEqual([]);
});
