import { mkdirSync, writeFileSync } from 'node:fs';
import { markedBulkPdf } from '../fixtures/redaction.ts';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { savedFiles, stubSavePicker } from '../support/savePicker.ts';

// M4-18 (§7.9, rules 1 and 2): Apply Redactions on 200 pages with 600 marks —
// apply, sanitize, two rewrites and the verification in the Work worker —
// with no main-thread task over 100 ms (the guard). Numbers →
// test-results/m4-redact.json.

test('200 pages, 600 marks: apply + verify, no long tasks', async ({ page, guard }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [
    { name: 'bulk.pdf', b64: Buffer.from(markedBulkPdf(200, 3)).toString('base64') },
  ]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  await stubSavePicker(page);
  await page.getByRole('tab', { name: 'Protect' }).click();
  await guard.startMeasuring();

  await page
    .getByRole('toolbar', { name: 'Protect commands' })
    .getByRole('button', { name: 'Apply Redactions' })
    .click();
  const d = page.getByRole('dialog', { name: 'Apply Redactions' });
  await expect(d).toContainText('600 marks on 200 pages will be applied.');
  const t0 = Date.now();
  await d.getByRole('button', { name: 'Apply and Save As…' }).click();
  await expect(d.getByTestId('redact-result')).toContainText('Every check passed.', {
    timeout: 120_000,
  });
  const ms = Date.now() - t0;
  const [saved] = await savedFiles(page);

  const result = { ms, bytes: saved?.bytes ?? 0 };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m4-redact.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm4-redact', description: JSON.stringify(result) });
  expect(result.bytes).toBeGreaterThan(0);
});
