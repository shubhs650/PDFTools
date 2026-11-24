import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { cap, darkTheme } from './support/app.ts';
import { textOf } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M12-19 (D-64): the text comparison view. Document A and Document B side by
// side in continuous scroll, synchronised by content (an inserted page does
// not throw them out of step), bands across the gap, the legend and the list
// on the right. Marks by colour and shape: deleted red struck through on A,
// inserted green underlined on B, replaced amber on both, moved blue on both
// with a band, a changed figure framed. The marks belong to the view; the
// windows are live documents where every comment tool works.

type Side = 'a' | 'b';

const rows = (page: Page) => page.getByTestId('text-list-rows');
const entry = (page: Page, text: string | RegExp) =>
  rows(page).getByRole('option', { name: text }).first();
const viewport = (page: Page, side: Side) => page.getByTestId(`text-view-${side}`);
const count = (page: Page) => page.getByTestId('text-list-count');

/** Whether `inner` lies inside `outer`'s box on screen (vertically). */
async function inView(outer: Locator, inner: Locator): Promise<boolean> {
  const o = await outer.boundingBox();
  const i = await inner.boundingBox();
  return !!o && !!i && i.y >= o.y - 1 && i.y + i.height <= o.y + o.height + 1;
}

/** The page at the centre of a window's view (0-based), and how far down it (0–1). */
async function centrePage(page: Page, side: Side): Promise<{ page: number; at: number }> {
  return viewport(page, side).evaluate((vp) => {
    const v = vp.getBoundingClientRect();
    const y = v.top + vp.clientHeight / 2;
    for (const el of vp.querySelectorAll<HTMLElement>('.page[data-page]')) {
      const r = el.getBoundingClientRect();
      if (r.top <= y && r.bottom >= y)
        return { page: Number(el.dataset.page), at: (y - r.top) / r.height };
    }
    return { page: -1, at: 0 };
  });
}

/** Marks of entry `id` drawn on a side's pages. */
const marksOf = (page: Page, side: Side, id: string | null, shape?: string) =>
  viewport(page, side).locator(
    `.text-marks g[data-entry="${id ?? ''}"]${shape ? `[data-shape="${shape}"]` : ''}`,
  );

const selectedId = async (page: Page): Promise<string | null> =>
  rows(page).locator('[role="option"][aria-selected="true"]').getAttribute('data-entry');

test('pair 05: the changes are listed under the legend; a click centres each change on both sides, with its marks and band @smoke', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '05');
  await expect(page.getByTestId('text-window-a')).toContainText(
    'Document A (old): Pair 05 RevA.pdf',
  );
  await expect(page.getByTestId('text-window-b')).toContainText(
    'Document B (new): Pair 05 RevB.pdf',
  );
  // The manifest: two clauses inserted (renumbering 3.4–3.9 → 3.6–3.11, reported
  // once), the LD cap 5 % → 10 %, "not" removed from clause 5.3.
  await expect(count(page)).toHaveAttribute('data-count', '7');
  await expect(entry(page, /^Inserted, B page 3, → Clause 3\.4: ESG/)).toBeVisible();
  await expect(entry(page, /^Clauses renumbered, .*3\.4–3\.9, → 3\.6–3\.11/)).toBeVisible();
  await expect(entry(page, /^Replaced, A page 4 · B page 4, \+100 %, 5%, → 10%/)).toBeVisible();
  await expect(entry(page, /^Deleted, A page 5, not$/)).toBeVisible();
  const legend = page.locator('.text-legend');
  await expect(legend.getByRole('checkbox', { name: 'Show Deleted (1)' })).toBeChecked();
  await expect(legend.getByRole('checkbox', { name: 'Show Inserted (1)' })).toBeChecked();

  // Deleted: struck through in red on A, centred there; the band points into B.
  await entry(page, /^Deleted/).click();
  const del = await selectedId(page);
  const struck = marksOf(page, 'a', del, 'strike');
  await expect(struck).toHaveCount(1);
  await expect.poll(() => inView(viewport(page, 'a'), struck)).toBe(true);
  await expect(struck.locator('line')).toHaveAttribute('stroke', '#c00000');
  await expect(marksOf(page, 'b', del)).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('[data-testid="text-gap"] path[data-style="selected"]').getAttribute('d'),
    )
    .toMatch(/^M0,/);

  // Inserted: underlined in green on B, centred there.
  await entry(page, /^Inserted/).click();
  const ins = await selectedId(page);
  const under = marksOf(page, 'b', ins, 'underline');
  await expect(under.first()).toBeAttached();
  await expect.poll(() => inView(viewport(page, 'b'), under.first())).toBe(true);
  await expect(under.first().locator('line')).toHaveAttribute('stroke', '#008000');

  // Replaced: amber on both sides, old struck and new underlined, both in view.
  await entry(page, /5%, → 10%/).click();
  const rep = await selectedId(page);
  await expect
    .poll(() => inView(viewport(page, 'a'), marksOf(page, 'a', rep, 'strike')))
    .toBe(true);
  await expect
    .poll(() => inView(viewport(page, 'b'), marksOf(page, 'b', rep, 'underline')))
    .toBe(true);
  await expect(marksOf(page, 'a', rep, 'strike').locator('line')).toHaveAttribute(
    'stroke',
    '#c06000',
  );
});

test('pair 10: scrolling stays in step by content across the inserted page; the switch turns it off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '10');
  await expect(entry(page, /^Inserted, B page 12, → ADDENDUM 6A/)).toBeVisible();
  // Mumbai → Singapore: A page 16, B page 17 (one page added before it).
  await entry(page, /Mumbai, India, → Singapore/).click();
  await expect.poll(async () => (await centrePage(page, 'a')).page).toBe(15);
  await expect.poll(async () => (await centrePage(page, 'b')).page).toBe(16);

  // Scrolling B up a few pages: A follows by content, still one page behind.
  await viewport(page, 'b').hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await centrePage(page, 'b')).page).toBeLessThan(16);
  await expect
    .poll(async () => {
      const a = await centrePage(page, 'a');
      const b = await centrePage(page, 'b');
      // B's page 12 (index 11) is the inserted one.
      return b.page >= 12 ? b.page - a.page : null;
    })
    .toBe(1);

  // Before the inserted page the documents are page for page again.
  await entry(page, /12 months, → 24 months/).click();
  await expect.poll(async () => (await centrePage(page, 'a')).page).toBe(7);
  await expect.poll(async () => (await centrePage(page, 'b')).page).toBe(7);

  // Sync off: scrolling B leaves A where it is.
  await page.getByRole('button', { name: 'Link views', exact: true }).click();
  const before = await viewport(page, 'a').evaluate((vp) => vp.scrollTop);
  await viewport(page, 'b').hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await centrePage(page, 'b')).page).toBeGreaterThan(7);
  expect(await viewport(page, 'a').evaluate((vp) => vp.scrollTop)).toBe(before);
});

test('pair 09: a moved section is blue on both sides with its edit inside; a changed figure is framed; F8 and Shift+F8 walk the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '09');
  const moved = entry(
    page,
    /^Moved, A page 2 · B page 2, 1 edit inside, Foundation Recommendations/,
  );
  await expect(moved).toBeVisible();
  await expect(entry(page, /^In the moved text, Replaced, .*180 kPa, → 165 kPa/)).toBeVisible();
  await expect(entry(page, /^Replaced, .*-18\.8 %, 3\.2 m, → 2\.6 m/)).toBeVisible();

  await moved.click();
  const id = await selectedId(page);
  await expect(marksOf(page, 'a', id, 'fill').first()).toBeAttached();
  await expect(marksOf(page, 'b', id, 'fill').first()).toBeAttached();
  await expect(marksOf(page, 'a', id, 'fill').first().locator('rect').first()).toHaveAttribute(
    'fill',
    '#0000c0',
  );
  await expect
    .poll(() =>
      page.locator('[data-testid="text-gap"] path[data-style="selected"]').getAttribute('d'),
    )
    .toMatch(/^M0,/);

  await entry(page, /^Changed figure/).click();
  const fig = await selectedId(page);
  await expect(marksOf(page, 'a', fig, 'frame')).toHaveCount(1);
  await expect(marksOf(page, 'b', fig, 'frame')).toHaveCount(1);

  // F8 from the figure: the next entry; Shift+F8 back; from the last, F8 wraps to the first.
  const all = await rows(page)
    .locator('[role="option"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-entry')));
  const at = all.indexOf(fig);
  await page.keyboard.press('F8');
  await expect.poll(() => selectedId(page)).toBe(all[at + 1]);
  await page.keyboard.press('Shift+F8');
  await expect.poll(() => selectedId(page)).toBe(fig);
  await page.getByRole('button', { name: 'Next change' }).click();
  await expect.poll(() => selectedId(page)).toBe(all[at + 1]);
  await rows(page).locator('[role="option"]').last().click();
  await page.keyboard.press('F8');
  await expect.poll(() => selectedId(page)).toBe(all[0]);
});

test('the list: kinds switched off, search on Enter, the checked tick and the colours', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '05');
  await expect(count(page)).toHaveAttribute('data-shown', '7');
  const legend = page.locator('.text-legend');
  await legend.getByRole('checkbox', { name: /^Show Replaced/ }).uncheck();
  await expect(count(page)).toHaveAttribute('data-shown', '2');
  await expect(count(page)).toHaveText('2 of 7 shown');
  await legend.getByRole('checkbox', { name: /^Show Replaced/ }).check();

  // Search runs on Enter only (rule 3).
  const search = page.getByRole('searchbox', { name: 'Search the changes' });
  await search.fill('ESG');
  await expect(count(page)).toHaveAttribute('data-shown', '7');
  await search.press('Enter');
  await expect(count(page)).toHaveAttribute('data-shown', '1');
  await page.getByRole('button', { name: 'Clear the search' }).click();
  await expect(count(page)).toHaveAttribute('data-shown', '7');

  // The checked tick: Space in the list, or the button; Hide checked leaves them out.
  await entry(page, /^Deleted/).click();
  await rows(page).focus();
  await page.keyboard.press('Space');
  await expect(entry(page, /^Deleted, A page 5, not, checked$/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mark the change in use as checked' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('checkbox', { name: 'Hide checked' }).check();
  await expect(count(page)).toHaveAttribute('data-shown', '6');
  await page.getByRole('checkbox', { name: 'Hide checked' }).uncheck();

  // Keyboard: arrows move through the list and centre each change.
  await rows(page).focus();
  await page.keyboard.press('Home');
  const first = await selectedId(page);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedId(page)).not.toBe(first);

  // A colour from the standard swatches: the marks follow.
  await page.getByRole('button', { name: 'Colour of Deleted' }).click();
  await page.getByRole('button', { name: 'Purple', exact: true }).click();
  await entry(page, /^Deleted/).click();
  await expect(
    marksOf(page, 'a', await selectedId(page), 'strike').locator('line'),
  ).toHaveAttribute('stroke', '#800080');
});

const docsActive = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: {
              stores: { documents: { getState: () => { activeId: string | null } } };
            };
          };
        }
      ).__pdftoolsTest.capabilities.stores.documents.getState().activeId,
  );

test('both windows are live documents: comments go into each window’s own file; page turns work, view modes do not', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '05');
  await skipReviewerPrompt(page);
  const ids = {
    a: (await viewport(page, 'a').getAttribute('data-doc-id')) ?? '',
    b: (await viewport(page, 'b').getAttribute('data-doc-id')) ?? '',
  };
  const list = async (side: Side) =>
    (((await cap(page, 'annotate', 'list', ids[side])) as { type: number }[] | null) ?? []).length;
  expect(await docsActive(page)).toBe(ids.b);

  const tool = page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Rectangle', exact: true });
  for (const side of ['a', 'b'] as const) {
    await page.getByRole('tab', { name: 'Comment' }).click();
    await expect(async () => {
      if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click();
      await expect(tool).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
    }).toPass();
    const box = await viewport(page, side).boundingBox();
    if (!box) throw new Error('window not on screen');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x - 30, y - 20);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 20, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => list(side)).toBe(1);
    expect(await docsActive(page)).toBe(ids[side]);
  }
  expect(await list('a')).toBe(1);
  expect(await list('b')).toBe(1);

  // The comparison's marks are not comments.
  await expect(viewport(page, 'a').locator('.text-marks').first()).toBeAttached();
  await expect(viewport(page, 'b').locator('.annotation-body')).toHaveCount(1);

  // Page turns work (the windows scroll); the view modes keep out.
  await page.getByRole('tab', { name: 'View' }).click();
  const view = page.getByRole('toolbar', { name: 'View commands' });
  await expect(view.getByRole('button', { name: 'Single Page', exact: true })).toBeDisabled();
  await viewport(page, 'b').focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await centrePage(page, 'b')).page).toBeGreaterThan(3);
});

test('the switches run the comparison again: headers and footers, hand-drawn bands', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '05');
  const result = page.getByTestId('compare-result');
  await expect(entry(page, /^Header changed/)).toBeVisible();
  await page.getByRole('button', { name: 'Options' }).click();
  await page
    .getByRole('menuitemcheckbox', { name: 'Leave out headers and footers (experimental)' })
    .click();
  await page.keyboard.press('Escape');
  await expect(result).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  await expect(rows(page).getByRole('option', { name: /^Header changed/ })).toHaveCount(0);

  // Bands drawn by hand: the lines on every page, the fields as the keyboard path.
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Header and footer bands…' }).click();
  const bar = page.getByTestId('text-band-bar');
  await expect(bar).toBeVisible();
  await expect(viewport(page, 'a').getByTestId('text-band-a-top').first()).toBeAttached();
  await bar.getByRole('spinbutton', { name: 'Header of Document A (mm)' }).fill('30');
  await bar.getByRole('spinbutton', { name: 'Header of Document B (mm)' }).fill('30');
  await bar.getByRole('button', { name: 'Apply' }).click();
  await expect(bar).toBeHidden();
  await expect(result).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
  await expect(entry(page, /^Header changed/)).toBeVisible();
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Find headers and footers automatically' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
});

test('pair 08: scans are offered OCR for this comparison only; their changes are labelled', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '08');
  const offer = page.getByTestId('text-notice-scanned');
  await expect(offer).toContainText('2 pages are scans without text');
  await offer.getByRole('button', { name: 'Read by OCR (English)' }).click();
  await expect(page.getByTestId('compare-result')).toHaveAttribute('data-status', 'done', {
    timeout: 180_000,
  });
  await expect(page.getByTestId('text-notice-ocr')).toContainText('Scans read by OCR (English)');
  await expect(
    rows(page)
      .getByRole('option', { name: /From OCR|Possible OCR error/ })
      .first(),
  ).toBeAttached();
  // A note's × closes it for this comparison (M13-04).
  await page
    .getByTestId('text-notice-ocr')
    .getByRole('button', { name: 'Close this message' })
    .click();
  await expect(page.getByTestId('text-notice-ocr')).toHaveCount(0);
});

test('the text comparison passes axe in light and dark; the windows and the list are keyboard reachable @a11y', async ({
  page,
}) => {
  await textOf(page, '09');
  const axe = async (): Promise<void> => {
    const r = await new AxeBuilder({ page }).include('[data-testid="compare-result"]').analyze();
    expect(r.violations).toEqual([]);
  };
  await axe();
  await darkTheme(page);
  await axe();
  for (const side of ['a', 'b'] as const) {
    await viewport(page, side).focus();
    await expect(viewport(page, side)).toBeFocused();
  }
  await rows(page).focus();
  await expect(rows(page)).toBeFocused();
});
