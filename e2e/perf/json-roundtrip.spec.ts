import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { stubSavePicker } from '../support/savePicker.ts';

// M8-01 (ADR-025, rule 1): 1,000 comments exported as JSON v2 (records in
// pieces on the main thread with yields; the comments PDF and its base64 in
// the Work worker) and imported into the 2,000-page stand-in (the comments
// PDF is checked and copied in the Work worker, applied by the Render
// worker). No main-thread task > 100 ms.

test('JSON v2: 1,000 comments exported, then imported into the 2,000-page stand-in, no long tasks', async ({
  page,
  pdfs,
  guard,
}) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Perf');
  await drop(page, [{ name: 'marked.pdf', b64: pdfs.markedContract(200, 5).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const src = (await cap(page, 'view', 'activeDocId')) as string;
  await expect
    .poll(
      async () => ((await cap(page, 'annotate', 'list', src)) as unknown[] | null)?.length ?? 0,
      { timeout: 120_000 },
    )
    .toBe(1000);
  await stubSavePicker(page);
  await cap(page, 'view', 'settle', 400);
  const bar = page.getByRole('toolbar', { name: 'Comment commands' });
  const exportJson = async () => {
    await page.getByRole('tab', { name: 'Comment' }).click();
    await bar.getByRole('button', { name: 'Export Comments (CSV / XLSX / JSON)' }).click();
    const exp = page.getByRole('dialog', { name: 'Export Annotations' });
    await exp.getByLabel('JSON (.json) — can be imported again').check();
    await exp.getByRole('button', { name: 'Export' }).click();
    await expect(exp).toBeHidden({ timeout: 120_000 });
  };
  // A first export becomes the import source, handed over in the page before
  // measuring (decoding test data is not app work).
  await exportJson();
  await page.evaluate(async () => {
    const t = (window as unknown as { __pdftoolsTest: { capabilities: Record<string, unknown> } })
      .__pdftoolsTest.capabilities;
    const annotate = t.annotate as { lastAnnotationExport: () => Promise<{ b64: string }> };
    const f = await annotate.lastAnnotationExport();
    const bin = atob(f.b64);
    const file = new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], 'marked.json', {
      type: 'application/json',
    });
    const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
    w.showOpenFilePicker = () =>
      Promise.resolve([
        { kind: 'file', name: 'marked.json', getFile: () => Promise.resolve(file) },
      ]);
  });
  await cap(page, 'view', 'settle', 400);
  await guard.startMeasuring();
  const t0 = Date.now();
  await exportJson();
  const exportMs = Date.now() - t0;

  await drop(page, [{ name: 'contract.pdf', b64: pdfs.contract(2000).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview').first()).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  await cap(page, 'view', 'settle', 400);
  const t1 = Date.now();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await bar.getByRole('button', { name: 'Import Comments' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Comments' });
  await dialog.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
  await expect(dialog.getByRole('status')).toContainText('1,000 comments will be imported', {
    timeout: 60_000,
  });
  const previewMs = Date.now() - t1;
  const t2 = Date.now();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect.poll(() => cap(page, 'pages', 'busy'), { timeout: 60_000 }).toBe(false);
  await expect
    .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[] | null)?.length, {
      timeout: 120_000,
    })
    .toBe(1000);
  test
    .info()
    .annotations.push(
      { type: 'json-export-1000-ms', description: String(exportMs) },
      { type: 'json-import-preview-ms', description: String(previewMs) },
      { type: 'json-import-1000-ms', description: String(Date.now() - t2) },
    );
  await page.locator('[data-page="0"] img.page-preview').first().waitFor();
  await cap(page, 'view', 'settle', 400);
});
