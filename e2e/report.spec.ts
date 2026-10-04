import AxeBuilder from '@axe-core/playwright';
import type { Page, Request } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';

// M2-17 (D-22, §10.2, rules 4 and 10): the error report is opt-in. The dialog
// shows the exact payload; Submit posts that JSON to the same-origin
// /api/report and nothing else; offline it fails gracefully with "Copy
// report". Help → Help is bundled and offline.

const reportDialog = (page: Page) => page.getByRole('dialog', { name: 'Send Error Report' });

/** Captures posts to /api/report and answers them with `status`. */
async function mockEndpoint(page: Page, status = 204): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route('**/api/report', async (route) => {
    seen.push(route.request());
    await route.fulfill({ status });
  });
  return seen;
}

async function helpCommand(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Help' }).click();
  await page.getByRole('toolbar', { name: 'Help commands' }).getByRole('button', { name }).click();
}

test('a caught error offers a report; the dialog shows the exact, sanitized payload; Send posts exactly that', async ({
  page,
}) => {
  const posts = await mockEndpoint(page);
  await page.goto('/');
  await expect(page.locator('html[data-crash-probe="ready"]')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('pdftools:crash')));
  const alert = page.getByTestId('error-boundary');
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Send Error Report…' }).click();
  const d = reportDialog(page);
  await expect(d).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  const payload = d.getByTestId('report-payload');
  const shown = JSON.parse(await payload.inputValue()) as {
    error: { code: string; where: string; stack: string[] };
    feature: string;
    description: string;
    session: string;
  };
  expect(shown.feature).toBe('app');
  expect(shown.error.code).toBe('internal');
  expect(shown.error.where).toBe('app');
  expect(shown.error.stack[0]).toBe('at readPage (/assets/index-abc123.js:1:2345)');
  const text = await payload.inputValue();
  // Nothing of the message or the paths in the stack survives (rule 10).
  expect(text).not.toMatch(/Confidential|alice|bid|contract|secret|example\.com|\.pdf|\.dwg/);

  await d
    .getByRole('textbox', { name: 'What were you doing? (optional)' })
    .fill('Opened a drawing');
  await expect(payload).toHaveValue(/"description": "Opened a drawing"/);
  expect(posts).toHaveLength(0); // nothing is sent before Send

  const exact = await payload.inputValue();
  await d.getByRole('button', { name: 'Send' }).click();
  await expect(d.getByRole('status')).toHaveText('Thank you. The report was sent.');
  expect(posts).toHaveLength(1);
  const post = posts[0];
  expect(post?.method()).toBe('POST');
  expect(new URL(post?.url() ?? '').pathname).toBe('/api/report');
  expect(post?.headers()['content-type']).toBe('application/json');
  expect(post?.postData()).toBe(exact);
  await d.getByRole('button', { name: 'Close' }).first().click();
  await expect(d).toHaveCount(0);
});

test('Help → Send Error Report offline: a localized message and Copy report; nothing sent', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const posts = await mockEndpoint(page);
  await page.goto('/');
  await helpCommand(page, 'Send Error Report');
  const d = reportDialog(page);
  const shown = JSON.parse(await d.getByTestId('report-payload').inputValue()) as {
    error: unknown;
    feature: string;
  };
  expect(shown.error).toBeNull();
  expect(shown.feature).toBe('help');

  await context.setOffline(true);
  await d.getByRole('button', { name: 'Send' }).click();
  await expect(d.getByRole('alert')).toHaveText(/You're offline/);
  expect(posts).toHaveLength(0);
  await d.getByRole('button', { name: 'Copy report' }).click();
  await expect(d.getByRole('status')).toHaveText(/copied/);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(await d.getByTestId('report-payload').inputValue());
  await context.setOffline(false);
});

test('a failing or rate-limited endpoint shows why, and Copy report', async ({ page }) => {
  await mockEndpoint(page, 429);
  await page.goto('/');
  await helpCommand(page, 'Send Error Report');
  const d = reportDialog(page);
  await d.getByRole('button', { name: 'Send' }).click();
  await expect(d.getByRole('alert')).toHaveText(/Too many reports/);
  await expect(d.getByRole('button', { name: 'Copy report' })).toBeVisible();
});

test('Help → Help: bundled help with a way to the shortcut sheet', async ({ page }) => {
  await page.goto('/');
  await helpCommand(page, 'Help');
  const d = page.getByRole('dialog', { name: 'PDFTools Help' });
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading', { name: 'Printing' })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  await d.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

// Preview review UI04: Help and the shortcut sheet take their keys from the
// same keymap and name the platform's modifier.
for (const [platform, mod] of [
  ['Win32', 'Ctrl'],
  ['MacIntel', 'Cmd'],
] as const) {
  test(`Help and the shortcut sheet both say ${mod} on ${platform}`, async ({ page }) => {
    await page.addInitScript((p) => {
      Object.defineProperty(navigator, 'platform', { get: () => p });
    }, platform);
    await page.goto('/');
    await helpCommand(page, 'Help');
    const d = page.getByRole('dialog', { name: 'PDFTools Help' });
    await expect(d.getByRole('heading', { name: 'Opening files' })).toBeVisible();
    await expect(d).toContainText(`Press ${mod}+O`);
    await expect(d).toContainText(`${mod}+S adds your changes`);
    await expect(d).not.toContainText(mod === 'Cmd' ? 'Ctrl+' : 'Cmd+');
    // The review workflow is documented, with the Delete key.
    await expect(d.getByRole('heading', { name: 'Reviewing comments' })).toBeVisible();
    await expect(d).toContainText('Comment → Delete or the Delete key');
    for (const heading of ['Comment transfer', 'Measuring', 'Extracting tables', 'Redacting'])
      await expect(d.getByRole('heading', { name: heading })).toBeVisible();
    await d.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet.getByRole('row', { name: /^Open/ })).toContainText(`${mod}+O`);
  });
}
