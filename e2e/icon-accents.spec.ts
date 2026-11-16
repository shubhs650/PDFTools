import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { darkTheme } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { openSample, skipReviewerPrompt } from './support/shots.ts';

// M10-08·O1 (ADR-027 D-47, review R16): about ten key tools draw their Fluent Regular
// glyph in a second colour: markup (Highlight, Sticky Note) amber, signing green,
// conversion violet, redaction red. At rest and on hover only: a pressed toggle keeps
// the brand pressed look, a disabled command stays grey, forced-colors uses the system's.

/** A token's value as the browser resolves it (rgb(...)). */
const resolved = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

const iconColour = (button: Locator) =>
  button.evaluate((b) => {
    const svg = b.querySelector('svg');
    return svg ? getComputedStyle(svg).color : null;
  });

const command = (page: Page, tab: string, id: string) =>
  page.getByRole('toolbar', { name: `${tab} commands` }).locator(`button[data-command="${id}"]`);

const openTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

for (const theme of ['light', 'dark'] as const)
  test(`key tools carry a colour accent, never when disabled or pressed (${theme}) @smoke`, async ({
    page,
  }) => {
    if (theme === 'dark') await darkTheme(page);
    await page.goto('/');
    await skipReviewerPrompt(page);
    const disabled = await resolved(page, '--color-text-disabled');
    const neutral = await resolved(page, '--color-icon');
    const markup = await resolved(page, '--color-icon-markup');
    const sign = await resolved(page, '--color-icon-sign');
    const convert = await resolved(page, '--color-icon-convert');
    const redact = await resolved(page, '--color-icon-redact');
    const selectedText = await resolved(page, '--color-selected-text');
    expect(new Set([neutral, markup, sign, convert, redact]).size).toBe(5);

    // No document: the commands are disabled, so the accent stays out (Q3).
    const highlight = command(page, 'Home', 'comment.highlight');
    await expect(highlight).toHaveAttribute('aria-disabled', 'true');
    expect(await iconColour(highlight)).toBe(disabled);

    await openSample(page, 2);
    await expect(highlight).not.toHaveAttribute('aria-disabled', 'true');
    expect(await iconColour(highlight)).toBe(markup);
    expect(await iconColour(command(page, 'Home', 'comment.stickyNote'))).toBe(markup);
    expect(await iconColour(command(page, 'Home', 'protect.signDocument'))).toBe(sign);
    // Everything else keeps the one icon colour.
    expect(await iconColour(command(page, 'Home', 'home.hand'))).toBe(neutral);
    expect(await iconColour(command(page, 'Home', 'comment.rectangle'))).toBe(neutral);

    // Hover keeps the accent; pressed takes the brand pressed look (and the Filled glyph).
    await highlight.hover();
    expect(await iconColour(highlight)).toBe(markup);
    await highlight.click();
    await expect(highlight).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(600, 600);
    await expect.poll(() => iconColour(highlight)).toBe(selectedText);
    await expect(highlight.locator('svg')).not.toHaveAttribute('data-icon-accent', /./);
    await highlight.click();
    await expect(highlight).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => iconColour(highlight)).toBe(markup);

    await openTab(page, 'Protect');
    for (const id of [
      'protect.markRedaction',
      'protect.markRedactionArea',
      'protect.applyRedactions',
    ]) {
      const b = command(page, 'Protect', id);
      // Apply Redactions waits for a mark: disabled, so grey.
      const off = (await b.getAttribute('aria-disabled')) === 'true';
      expect(await iconColour(b), id).toBe(off ? disabled : redact);
    }
    expect(await iconColour(command(page, 'Protect', 'protect.signatures'))).toBe(sign);

    await openTab(page, 'Convert');
    for (const id of ['convert.ocr', 'convert.word', 'convert.expressExtract']) {
      const b = command(page, 'Convert', id);
      const off = (await b.getAttribute('aria-disabled')) === 'true';
      expect(await iconColour(b), id).toBe(off ? disabled : convert);
    }

    const { violations } = await new AxeBuilder({ page })
      .include('[role="region"][aria-label="Ribbon"]')
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });

test('forced-colors: accented icons use the same system colour as the rest', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  await skipReviewerPrompt(page);
  await openSample(page, 1);
  const hand = await iconColour(command(page, 'Home', 'home.hand'));
  expect(await iconColour(command(page, 'Home', 'comment.highlight'))).toBe(hand);
  expect(await iconColour(command(page, 'Home', 'protect.signDocument'))).toBe(hand);
});
