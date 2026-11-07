// Help in its own window (M9, ADR-026 D-46): F1, Help → Help and a dialog's
// "?" open /help at the right topic in one reused window; the page has a
// contents list, search on Enter only (rule 3), screenshots that load, and it
// works offline once the app is ready offline.
import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { simplePdf } from './fixtures/generate.ts';
import { cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

const helpWindow = (context: BrowserContext, action: () => Promise<unknown>) =>
  Promise.all([context.waitForEvent('page'), action()]).then(([p]) => p);

const topic = (help: Page) => help.locator('article.help-topic');

async function openDoc(page: Page): Promise<void> {
  await drop(page, [{ name: 'plan.pdf', b64: Buffer.from(simplePdf(2)).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
}

test('F1, Help → Help and a dialog\'s "?" open Help at the right topic, in one window @smoke', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Alex Morgan');
  await openDoc(page);

  // F1 on the Measure tab: the Measure chapter.
  await page.getByRole('tab', { name: 'Measure', exact: true }).click();
  await page.getByTestId('document-view').focus();
  const help = await helpWindow(context, () => page.keyboard.press('F1'));
  await help.waitForLoadState();
  await expect(help).toHaveURL(/\/help#measure-tools$/);
  await expect(help).toHaveTitle('Measuring distance, perimeter and area – Triya PDF Help');
  await expect(topic(help).getByRole('heading', { level: 1 })).toHaveText(
    'Measuring distance, perimeter and area',
  );
  await expect(
    help
      .getByRole('navigation', { name: 'Contents' })
      .getByRole('link', { name: 'Measuring distance, perimeter and area' }),
  ).toHaveAttribute('aria-current', 'page');

  // A dialog's "?" goes to the dialog's topic, in the same window.
  await page.bringToFront();
  await page.getByRole('tab', { name: 'Protect', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Protect commands' })
    .getByRole('button', { name: 'Password Security…' })
    .click();
  const d = page.getByRole('dialog', { name: 'Password Security' });
  await d.getByRole('button', { name: 'Help for this dialog' }).click();
  await expect(help).toHaveURL(/\/help#passwords$/);
  await expect(topic(help).getByRole('heading', { level: 1 })).toHaveText(
    'Passwords and permissions',
  );
  expect(context.pages()).toHaveLength(2);

  // F1 with a dialog open: the dialog's topic too.
  await d.getByRole('button', { name: 'Close' }).first().click();
  await page
    .getByRole('toolbar', { name: 'Protect commands' })
    .getByRole('button', { name: 'Sign Document…' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Sign Document' })).toHaveAttribute(
    'data-help-topic',
    'signing',
  );
  await page.keyboard.press('F1');
  await expect(help).toHaveURL(/\/help#signing$/);
  await page.keyboard.press('Escape');

  // Help → Help on the Help tab: the start page.
  await page.getByRole('tab', { name: 'Help', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Help commands' })
    .getByRole('button', { name: 'Help' })
    .click();
  await expect(help).toHaveURL(/\/help#welcome$/);
  expect(context.pages()).toHaveLength(2);
});

test('the Help page: contents, pager, search on Enter only, screenshots and lightbox @smoke', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/help#welcome');
  const nav = page.getByRole('navigation', { name: 'Contents' });
  await expect(nav.getByRole('link')).toHaveCount(43);
  await expect(topic(page).getByRole('heading', { level: 1 })).toHaveText('Welcome to Triya PDF');

  // Contents and the pager move between topics.
  await nav.getByRole('link', { name: 'Bookmarks' }).click();
  await expect(page).toHaveURL(/#bookmarks$/);
  await expect(topic(page).getByRole('heading', { level: 1 })).toHaveText('Bookmarks');
  await page
    .getByRole('navigation', { name: 'Previous and next topic' })
    .getByRole('link', { name: /Next/ })
    .click();
  await expect(page).toHaveURL(/#comment-tab$/);

  // Search runs on Enter, not while typing.
  const box = page.getByRole('searchbox', { name: 'Search Help' });
  await box.fill('redact');
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { name: /Results for/ })).toHaveCount(0);
  await box.press('Enter');
  const results = page.locator('.help-results');
  await expect(results.getByRole('heading', { name: 'Results for “redact”' })).toBeVisible();
  await results.getByRole('link', { name: 'Redacting' }).click();
  await expect(page).toHaveURL(/#redaction$/);
  await expect(topic(page).getByRole('heading', { level: 1 })).toHaveText('Redacting');
  await box.fill('zzqqxx');
  await box.press('Enter');
  await expect(results).toContainText('Nothing in Help matches');

  // Every screenshot of every topic loads.
  for (const id of await nav
    .getByRole('link')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
    await page.goto(`/help${id}`);
    await expect(topic(page)).toHaveAttribute('data-topic', id.slice(1));
    const imgs = topic(page).locator('.help-shot-open img');
    for (const img of await imgs.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(
          () =>
            img.evaluate(
              (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
            ),
          { message: id },
        )
        .toBe(true);
      await expect(img).toHaveAttribute('alt', /\S/);
    }
  }

  // A screenshot opens full size; Esc closes it.
  await page.goto('/help#comment-tab');
  await topic(page)
    .getByRole('button', { name: /^Show full size:/ })
    .first()
    .click();
  const lightbox = page.locator('dialog.help-lightbox');
  await expect(lightbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();
});

for (const [platform, mod] of [
  ['Win32', 'Ctrl'],
  ['MacIntel', 'Cmd'],
] as const) {
  test(`Help names the keys of ${platform} (${mod}), from the keymap`, async ({ page }) => {
    await page.addInitScript((p) => {
      Object.defineProperty(navigator, 'platform', { get: () => p });
    }, platform);
    await page.goto('/help#saving');
    await expect(topic(page)).toContainText(`${mod}+S`);
    await expect(topic(page)).not.toContainText(mod === 'Cmd' ? 'Ctrl+' : 'Cmd+');
    await page.goto('/help#keyboard-shortcuts');
    await expect(
      page.getByTestId('help-shortcuts').getByRole('row', { name: /^Open/ }),
    ).toContainText(`${mod}+O`);
  });
}

for (const [variant, url] of [
  ['light', '/help#comment-styles'],
  ['dark', '/help#comment-styles'],
  ['pseudo-locale', '/help?locale=pseudo#comment-styles'],
] as const) {
  test(`the Help page is accessible (${variant})`, { tag: '@a11y' }, async ({ page }) => {
    if (variant === 'dark') await darkTheme(page);
    await page.goto(url);
    await expect(topic(page)).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    await page.getByRole('searchbox').fill('page');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.locator('.help-results')).toBeVisible();
    const after = await new AxeBuilder({ page }).analyze();
    expect(after.violations.map((v) => v.id)).toEqual([]);
  });
}

test(
  'Help works offline once the app is ready offline',
  { tag: '@offline' },
  async ({ page, context }) => {
    await page.goto('/?sw');
    await expect(
      page.getByRole('contentinfo', { name: 'Status bar' }).getByText('✓ Ready offline'),
    ).toBeVisible({ timeout: 60_000 });
    await context.setOffline(true);
    try {
      const help = await context.newPage();
      await help.goto('/help#ocr');
      await expect(topic(help).getByRole('heading', { level: 1 })).toBeVisible();
      const img = topic(help).locator('.help-shot-open img').first();
      await expect
        .poll(() =>
          img.evaluate(
            (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .toBe(true);
    } finally {
      await context.setOffline(false);
    }
  },
);
