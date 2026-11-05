import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { annotatedPdf, fullFormPdf, simplePdf } from './fixtures/generate.ts';
import { THEME_KEY, cap, darkTheme, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M7-11 (ADR-023 D-42; review item 2): a light / dark theme toggle at the right
// end of the top bar, also View → Dark Theme, Ctrl+Shift+D and File → Settings
// → Appearance. Light is the default; the choice is stored on this device,
// applied before the first paint, listed on the Privacy page and reset by
// Clear all local data. Pages stay white, and what is drawn on them keeps the
// light colours.

const html = (page: Page) => page.locator('html');
const toggle = (page: Page) => page.getByTestId('theme-toggle');
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), THEME_KEY);
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const themeColor = (page: Page) => page.locator('meta[name="theme-color"]').getAttribute('content');
const backstage = (page: Page) => page.getByTestId('backstage');

const LIGHT_BG = 'rgb(243, 243, 243)';
const DARK_BG = 'rgb(31, 31, 31)';

async function settings(page: Page, name = 'Settings'): Promise<void> {
  if (!(await backstage(page).isVisible())) await page.getByTestId('file-tab').click();
  await backstage(page).getByRole('button', { name, exact: true }).click();
  await expect(backstage(page).getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openPdf(page: Page, bytes: Uint8Array, name: string): Promise<string> {
  await drop(page, [{ name, b64: Buffer.from(bytes).toString('base64') }]);
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  return (await cap(page, 'view', 'activeDocId')) as string;
}

/** Runs a command without waiting for it (a dialog's command resolves when it closes). */
function run(page: Page, id: string): void {
  void page
    .evaluate(
      (cmd) =>
        (
          window as unknown as {
            __pdftoolsTest: { capabilities: { commands: { run(id: string): Promise<boolean> } } };
          }
        ).__pdftoolsTest.capabilities.commands.run(cmd),
      id,
    )
    .catch(() => undefined);
}

test('light by default; the top-bar toggle switches at once and is remembered across reloads @smoke', async ({
  page,
  guard,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(html(page)).not.toHaveAttribute('data-theme', 'dark');
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  expect(await themeColor(page)).toBe('#0f6cbd');
  const button = toggle(page);
  await expect(button).toHaveAccessibleName('Dark Theme');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  // At the right end of the top bar, before OpenEngTools, the issue link and full screen.
  const order = await page
    .locator('.top-bar-actions [data-command]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-command')));
  expect(order).toEqual(['view.darkTheme', 'app.home', 'app.reportIssue', 'view.fullScreen']);

  await guard.startMeasuring();
  await button.click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAccessibleName('Dark Theme');
  expect(await bodyBg(page)).toBe(DARK_BG);
  expect(await themeColor(page)).toBe('#1f1f1f');
  expect(await stored(page)).toBe('dark');
  // Switching is a style change only: no long task (rule 1).
  expect(await guard.longTasksOverLimit()).toEqual([]);

  await page.reload();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');

  await toggle(page).click();
  await expect(html(page)).not.toHaveAttribute('data-theme', 'dark');
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  expect(await stored(page)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(html(page)).not.toHaveAttribute('data-theme', 'dark');
});

test('a reload in dark is dark from the first paint (no light flash)', async ({ page }) => {
  await darkTheme(page);
  // Before any page script: note the theme the moment <body> exists, which is
  // before anything can be painted.
  await page.addInitScript(() => {
    const w = window as unknown as { __themeAtBody?: string | null };
    new MutationObserver((_, obs) => {
      if (!document.querySelector('body')) return;
      w.__themeAtBody = document.documentElement.getAttribute('data-theme');
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __themeAtBody?: string }).__themeAtBody),
  ).toBe('dark');
  // Every paint so far had the dark background: the html element's colour
  // comes from the stylesheet, which blocks rendering, and the attribute was
  // there before <body>.
  expect(await bodyBg(page)).toBe(DARK_BG);
  expect(await themeColor(page)).toBe('#1f1f1f');
});

test('View → Dark Theme, Ctrl+Shift+D and Settings → Appearance switch the same theme', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'View' }).click();
  const viewButton = page
    .getByRole('toolbar', { name: 'View commands' })
    .getByRole('button', { name: 'Dark Theme' });
  await expect(viewButton).toHaveAttribute('aria-pressed', 'false');
  await viewButton.click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(viewButton).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');

  await page.locator('body').click({ position: { x: 640, y: 500 } });
  await page.keyboard.press('Control+Shift+D');
  await expect(html(page)).not.toHaveAttribute('data-theme', 'dark');
  await expect(viewButton).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Control+Shift+D');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');

  await settings(page);
  const appearance = backstage(page).getByTestId('appearance-section');
  await expect(appearance.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  const group = appearance.getByRole('group', { name: 'Theme' });
  await expect(group.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await group.getByRole('radio', { name: 'Light' }).check();
  await expect(html(page)).not.toHaveAttribute('data-theme', 'dark');
  expect(await stored(page)).toBeNull();
  await group.getByRole('radio', { name: 'Dark' }).check();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  expect(await stored(page)).toBe('dark');
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // The shortcut is in the shortcut sheet and named in Help.
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Help' }).click();
  await page.getByRole('button', { name: 'Keyboard Shortcuts' }).click();
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet.getByRole('row', { name: /Dark Theme/ })).toContainText('Ctrl+Shift+D');
});

test('Privacy lists the theme choice, and Clear all local data goes back to light', async ({
  page,
}) => {
  page.on('dialog', (d) => {
    void d.accept();
  });
  await darkTheme(page);
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await settings(page, 'Privacy');
  const row = backstage(page).getByRole('row', { name: /Light or dark theme/ });
  await expect(row).toContainText('Local storage');
  await expect(row).toContainText(THEME_KEY);
  await expect(row).toContainText('Yes');

  await settings(page);
  await backstage(page).getByRole('button', { name: 'Clear all local data…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Clear all local data?' });
  await expect(confirm).toContainText('theme choice (back to light)');
  await confirm.getByRole('button', { name: 'Clear data' }).click();
  await expect(confirm).toBeHidden();
  await expect(html(page)).not.toHaveAttribute('data-theme', 'dark');
  expect(await stored(page)).toBeNull();
  await expect(
    backstage(page).getByTestId('appearance-section').getByRole('radio', { name: 'Light' }),
  ).toBeChecked();
});

test('in dark, pages stay white and what is drawn on them keeps the light colours', async ({
  page,
}) => {
  await darkTheme(page);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  await openPdf(page, fullFormPdf(), 'form.pdf');
  const pageEl = page.locator('[data-page="0"]');
  const look = await pageEl.evaluate((el) => {
    const s = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    return {
      bg: s.backgroundColor,
      scheme: s.colorScheme,
      focus: s.getPropertyValue('--color-focus').trim(),
      rootFocus: root.getPropertyValue('--color-focus').trim(),
    };
  });
  expect(look.bg).toBe('rgb(255, 255, 255)');
  expect(look.scheme).toBe('light');
  // A white focus ring would vanish on the white page: the page keeps the light one.
  expect(look.focus).toBe('#0f6cbd');
  expect(look.rootFocus).toMatch(/^#fff(fff)?$/i);

  // Form fields (Highlight Fields on by default) look as in light.
  const field = page.locator('.form-layer .form-field').first();
  await expect(field).toBeVisible();
  expect(await field.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(227, 236, 250)',
  );
  const { violations } = await new AxeBuilder({ page }).include('.form-layer').analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test('the sticky note window and the page menu pass axe in dark', async ({ page }) => {
  await darkTheme(page);
  await page.goto('/');
  await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
  const id = await openPdf(page, simplePdf(2), 'notes.pdf');
  // The comment layer is ready (as sticky-note-popup.spec.ts waits for it).
  await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
  const content = page.locator('[data-page="0"] .page-content');

  await page.getByRole('tab', { name: 'Comment' }).click();
  const tool = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Sticky Note', exact: true });
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  let box = await content.boundingBox();
  if (!box) throw new Error('page not laid out');
  await page.mouse.click(box.x + 100 * (box.width / 595), box.y + 120 * (box.width / 595));
  const win = page.getByRole('dialog', { name: /^Sticky note by / });
  await expect(win).toBeVisible();
  await page.keyboard.type('Check weld size');
  // Yellow stays yellow, with dark text.
  const colours = await win.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, scheme: s.colorScheme };
  });
  expect(colours).toEqual({ color: 'rgb(31, 31, 31)', scheme: 'light' });
  let r = await new AxeBuilder({ page }).include('.note-popup').analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Control+Enter');

  // The page menu, away from the note.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  box = await content.boundingBox();
  if (!box) throw new Error('page not laid out');
  await page.mouse.click(box.x + box.width * 0.7, box.y + 300, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  r = await new AxeBuilder({ page }).include('[role="menu"]').analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

// Screenshots for the owner's review (M7-11 acceptance): set M7_11_SHOTS to a
// folder. The start screen, every ribbon tab, the panes, the main dialogs,
// menus, the sticky note window and the settings, in light and dark, at 1280
// and 1920 px wide.
const SHOTS = process.env.M7_11_SHOTS;
for (const theme of ['light', 'dark'] as const) {
  for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
  ] as const) {
    test(`screenshots for review: ${theme}, ${String(width)} px`, async ({ page }) => {
      test.skip(!SHOTS, 'set M7_11_SHOTS to a folder to take the review screenshots');
      test.setTimeout(240_000);
      const dir = `${SHOTS ?? ''}/${theme}-${String(width)}`;
      mkdirSync(dir, { recursive: true });
      let n = 0;
      const shot = async (name: string) => {
        n += 1;
        await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}-${name}.png` });
      };
      const settle = () => page.waitForTimeout(400);
      const close = async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      };
      await page.setViewportSize({ width, height });
      if (theme === 'dark') await darkTheme(page);
      await page.goto('/');
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await cap(page, 'annotate', 'setProfile', 'Ana de Vries');
      await shot('start-screen');
      await openPdf(page, annotatedPdf(), 'review.pdf');
      await settle();
      const tabs = ['Home', 'View', 'Comment', 'Form', 'Measure', 'Organize', 'Convert'];
      for (const tab of [...tabs, 'Protect', 'Help']) {
        if (width === 1920 && !['Home', 'Comment'].includes(tab)) continue;
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await settle();
        await shot(`tab-${tab.toLowerCase()}`);
      }
      await page.getByRole('tab', { name: 'Home', exact: true }).click();
      await page.getByTestId('theme-toggle').hover();
      await page.waitForTimeout(900);
      await shot('theme-toggle-tooltip');
      const panes =
        width === 1920
          ? ['rail.comments']
          : ['rail.bookmarks', 'rail.search', 'rail.attachments', 'rail.comments'];
      for (const pane of panes) {
        run(page, pane);
        await settle();
        await shot(`pane-${pane.slice(5)}`);
      }
      // A selected comment in the Properties pane.
      const card = page.locator('.comment-card').first();
      if (await card.isVisible()) await card.click();
      run(page, 'view.propertiesPane');
      await settle();
      await shot('properties-pane');
      const dialogs =
        width === 1920
          ? ['comment.stylesPalette']
          : [
              'comment.stylesPalette',
              'protect.signDocument',
              'protect.passwordSecurity',
              'file.print',
              'convert.ocr',
              'help.shortcuts',
            ];
      for (const d of dialogs) {
        run(page, d);
        await page.waitForTimeout(700);
        await shot(`dialog-${d.split('.')[1] ?? d}`);
        await close();
        await close();
      }
      // The page menu (back on page 1: selecting the comment went to its page).
      run(page, 'view.firstPage');
      await settle();
      const content = page.locator('[data-page="0"] .page-content');
      const box = await content.boundingBox();
      if (!box) throw new Error('page not laid out');
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5, {
        button: 'right',
      });
      await settle();
      await shot('menu-page');
      await close();
      if (width === 1280) {
        // A sticky note and its window.
        await page.getByRole('tab', { name: 'Comment', exact: true }).click();
        await page
          .getByRole('toolbar', { name: 'Comment commands' })
          .getByRole('button', { name: 'Sticky Note', exact: true })
          .click();
        await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.25);
        await expect(page.getByRole('dialog', { name: /^Sticky note by / })).toBeVisible();
        await page.keyboard.type('Check the weld size at grid C4.');
        await settle();
        await shot('sticky-note-window');
        await page.keyboard.press('Control+Enter');
        await close();
        // Form fields with Highlight Fields on.
        await openPdf(page, fullFormPdf(), 'form.pdf');
        await page.getByRole('tab', { name: 'Form', exact: true }).click();
        await settle();
        await shot('form-fields');
      }
      await page.getByTestId('file-tab').click();
      await settings(page);
      await settle();
      await shot('settings-appearance');
    });
  }
}
