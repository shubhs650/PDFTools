import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { tablesPdf } from '../fixtures/tables.ts';
import { cap, drop } from '../support/app.ts';
import { expect, test } from '../support/fixtures.ts';
import { stubSavePicker } from '../support/savePicker.ts';

// M4-13 (§7.7, rules 1 and 2): Express Extract over 200 pages of the table
// fixture (200 tables, 40 scanned pages) while the user scrolls — detection and
// the workbook in the Work worker, no main-thread task over 100 ms (the guard).
// Numbers → test-results/m4-tables.json.

const view = (page: Page, method: string, ...args: unknown[]) => cap(page, 'view', method, ...args);

test('200 pages: Express Extract to XLSX while scrolling', async ({ page, guard }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await drop(page, [{ name: 'tables.pdf', b64: Buffer.from(tablesPdf(40)).toString('base64') }]);
  await page.locator('[data-page="0"] img.page-preview').waitFor();
  const docId = (await cap(page, 'view', 'activeDocId')) as string;
  await stubSavePicker(page);
  await cap(page, 'extract', 'warm');
  await cap(page, 'extract', 'openExpress', docId, [...Array(200).keys()]);
  const dialog = page.getByRole('dialog', { name: 'Express Extract (Beta)' });
  await guard.startMeasuring();

  const t0 = Date.now();
  await dialog.getByRole('button', { name: 'Find Tables' }).click();
  await view(page, 'reset');
  const scroll = (await view(page, 'autoScroll', 900, 2000)) as { blankFrames: number };
  await expect(dialog.getByRole('status')).toContainText('200 tables found.', { timeout: 120_000 });
  const detectMs = Date.now() - t0;
  const t1 = Date.now();
  await dialog.getByRole('button', { name: 'Save…' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  const saveMs = Date.now() - t1;
  const out = (await cap(page, 'extract', 'lastExport', 'tables')) as {
    files: { size: number }[];
  };

  const result = { detectMs, saveMs, bytes: out.files[0]?.size ?? 0, scroll };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/m4-tables.json', JSON.stringify(result, null, 2));
  test.info().annotations.push({ type: 'm4-tables', description: JSON.stringify(result) });
  expect(result.bytes).toBeGreaterThan(0);
});
