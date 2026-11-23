import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { cap, darkTheme } from './support/app.ts';
import { overlayDrawn, overlayOf, textOf } from './support/compare.ts';
import { expect, test } from './support/fixtures.ts';
import { stubSavePicker } from './support/savePicker.ts';
import { skipReviewerPrompt } from './support/shots.ts';

// M12-15 (D-62, Q15, Q16, Q43): review across revisions. The reviewer goes
// through the old revision's comments and closes each out against the new one:
// Addressed, Carried Over (copied to the matching spot of the new revision
// first) or Changed Differently. A close-out sets the comment to Completed with
// an automatic reply naming the outcome and the new file, and puts a green
// check highlight on it, grouped with the comment; Reopen takes them back.
// Copy to New Revision (and back) and paste between the windows land on the
// matching spot, through the sheet's alignment or the matching text.

type Role = 'overlay' | 'a' | 'b';

const win = (page: Page, role: Role) => page.getByTestId(`review-window-${role}`);
const viewport = (page: Page, role: Role) => win(page, role).locator('.viewport');

interface Obj {
  id: string;
  type: number;
  pageIndex: number;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
  contents?: string;
  author?: string;
  inReplyToId?: string;
  replyType?: number;
  state?: string;
  opacity?: number;
  blendMode?: number;
  strokeColor?: string;
}

const objects = async (page: Page, docId: string): Promise<Obj[]> =>
  ((await cap(page, 'annotate', 'objects', docId)) as Obj[] | null) ?? [];

async function docId(page: Page, role: Role): Promise<string> {
  const id = await viewport(page, role).getAttribute('data-doc-id');
  if (!id) throw new Error(`no document in window ${role}`);
  return id;
}

// PdfAnnotationSubtype values.
const T = { TEXT: 1, FREETEXT: 3, SQUARE: 5, POLYGON: 7, HIGHLIGHT: 9 };
// PdfAnnotationReplyType.Group, PdfBlendMode.Multiply.
const GROUP = 2;
const MULTIPLY = 1;

const pane = (page: Page) => page.getByTestId('closeout-pane');
const row = (page: Page, id: string) => pane(page).locator(`.closeout-row[data-id="${id}"]`);
const action = (page: Page, name: string) =>
  page.getByTestId('closeout-actions').getByRole('button', { name, exact: true });

async function showList(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close-out list' }).click();
  await expect(pane(page)).toBeVisible();
}

/** The parts a close-out added to comment `id` of document `doc`. */
async function parts(page: Page, doc: string, id: string): Promise<Obj[]> {
  return (await objects(page, doc)).filter(
    (o) => o.inReplyToId === id && o.id.startsWith('closeout-'),
  );
}

/** Where an annotation's body is on screen (its centre). */
async function centreOn(body: Locator): Promise<{ x: number; y: number }> {
  const b = await body.boundingBox();
  if (!b) throw new Error('not on screen');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** A point's offset from the centre of its window's viewport (CSS px). */
async function fromCentre(page: Page, role: Role, p: { x: number; y: number }) {
  const v = await viewport(page, role).boundingBox();
  if (!v) throw new Error(`window ${role} not on screen`);
  return { dx: p.x - (v.x + v.width / 2), dy: p.y - (v.y + v.height / 2) };
}

test("closes out the old revision's comments, following the owner's three cases (pair 19) @smoke", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '19');
  await skipReviewerPrompt(page, 'Ana de Vries');
  const a = await docId(page, 'a');
  const b = await docId(page, 'b');
  await expect.poll(async () => (await objects(page, a)).length).toBeGreaterThan(5);
  expect(await objects(page, b)).toEqual([]);

  // The list: every checker comment of Rev A; the see-through check marks close nothing.
  await showList(page);
  const ids = await pane(page)
    .locator('.closeout-row')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  expect(ids).toEqual(['C1-cloud', 'C1-text', 'C2-cloud', 'C3-note', 'C4-note']);
  await expect(pane(page).getByTestId('closeout-counts')).toHaveText('5 open, 0 closed');

  // Case 1, addressed (Rev B has W360x51): one click.
  await row(page, 'C1-cloud').click();
  await expect(row(page, 'C1-cloud')).toHaveAttribute('aria-selected', 'true');
  // Picking a row selects the comment in Document A.
  await expect
    .poll(async () => (await cap(page, 'annotate', 'selected', a)) as string[])
    .toEqual(['C1-cloud']);
  await action(page, 'Addressed').click();
  await expect(row(page, 'C1-cloud')).toHaveAttribute('data-state', 'addressed');
  await expect(row(page, 'C1-cloud')).toContainText('Addressed');
  const c1 = await parts(page, a, 'C1-cloud');
  expect(c1).toHaveLength(3);
  expect(c1.find((p) => p.id.startsWith('closeout-state-'))?.state).toBe('Completed');
  expect(c1.find((p) => p.id.startsWith('closeout-addressed-'))?.contents).toBe(
    'Addressed in Pair 19 RevB.pdf',
  );
  const check = c1.find((p) => p.type === T.HIGHLIGHT);
  expect(check?.replyType).toBe(GROUP);
  expect(check?.blendMode).toBe(MULTIPLY);
  expect(check?.opacity).toBeLessThan(0.7);
  expect(check?.strokeColor?.toLowerCase()).toBe('#00ff00');
  // The check highlight covers the comment.
  const cloud = (await objects(page, a)).find((o) => o.id === 'C1-cloud');
  if (!cloud || !check) throw new Error('missing');
  expect(check.rect.origin.x).toBeLessThanOrEqual(cloud.rect.origin.x);
  expect(check.rect.origin.y).toBeLessThanOrEqual(cloud.rect.origin.y);
  expect(check.rect.size.width).toBeGreaterThanOrEqual(cloud.rect.size.width);

  // Case 2, changed differently (Rev B made it 1200x600): the reviewer marks the right
  // value on the new revision, then closes the old comment out. The colour is changed first.
  await cap(page, 'annotate', 'createSquare', b, 0, 300, 200);
  await expect.poll(async () => (await objects(page, b)).length).toBe(1);
  await pane(page).getByRole('button', { name: 'Check highlight colour' }).click();
  await page.getByRole('button', { name: 'Light green', exact: true }).click();
  await row(page, 'C2-cloud').click();
  await action(page, 'Changed Differently').click();
  await expect(row(page, 'C2-cloud')).toHaveAttribute('data-state', 'changed');
  const c2 = await parts(page, a, 'C2-cloud');
  expect(c2.find((p) => p.id.startsWith('closeout-changed-'))?.contents).toBe(
    'Changed differently in Pair 19 RevB.pdf',
  );
  expect(c2.find((p) => p.type === T.HIGHLIGHT)?.strokeColor?.toLowerCase()).toBe('#80ff80');

  // Case 3, not incorporated (C3 and C4): Carried Over copies the comment, with its
  // designer's reply, to the same spot of Rev B, then closes it out.
  for (const id of ['C3-note', 'C4-note']) {
    await row(page, id).click();
    await action(page, 'Carried Over').click();
    await expect(row(page, id)).toHaveAttribute('data-state', 'carried');
  }
  await expect(pane(page).getByTestId('closeout-counts')).toHaveText('1 open, 4 closed');
  const onB = await objects(page, b);
  const old = await objects(page, a);
  for (const id of ['C3-note', 'C4-note']) {
    const src = old.find((o) => o.id === id);
    const copy = onB.find(
      (o) => o.type === T.TEXT && !o.inReplyToId && o.contents === src?.contents,
    );
    if (!src || !copy) throw new Error(`${id} not carried over`);
    // Pair 19's revisions share their frame: the alignment puts it on the same spot.
    expect(Math.abs(copy.rect.origin.x - src.rect.origin.x)).toBeLessThan(1.5);
    expect(Math.abs(copy.rect.origin.y - src.rect.origin.y)).toBeLessThan(1.5);
    // The copy is not closed out on the new revision.
    expect(onB.some((o) => o.inReplyToId === copy.id && o.id.startsWith('closeout-'))).toBe(false);
  }
  expect(onB.some((o) => o.contents === 'Spacing is 1667 c/c, as shown. No change.')).toBe(true);
  expect(
    (await parts(page, a, 'C3-note')).find((p) => p.id.startsWith('closeout-carried-'))?.contents,
  ).toBe('Carried over to Pair 19 RevB.pdf');

  // Filters.
  await pane(page).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(pane(page).locator('.closeout-row')).toHaveCount(1);
  await pane(page).getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(pane(page).locator('.closeout-row')).toHaveCount(4);
  await pane(page).getByRole('button', { name: 'All', exact: true }).click();

  // The states reach the CRS export: Status Completed, the automatic reply in Replies.
  await stubSavePicker(page);
  await viewport(page, 'a').focus();
  await page.getByRole('tab', { name: 'Comment' }).click();
  await page
    .getByRole('toolbar', { name: 'Comment commands' })
    .getByRole('button', { name: 'Export CRS' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Export Comment Review Sheet' });
  await dialog.getByLabel('CSV (.csv, no snapshots)').check();
  await dialog.getByRole('button', { name: 'Export' }).click();
  await expect(dialog).toBeHidden();
  const f = (await cap(page, 'annotate', 'lastCrs')) as { b64: string } | null;
  const csv = Buffer.from(f?.b64 ?? '', 'base64')
    .subarray(3)
    .toString('utf8');
  const line = (needle: string) => csv.split('\r\n').find((l) => l.includes(needle)) ?? '';
  expect(line('C1: Beam B/2-3 W310x39')).toContain('Addressed in Pair 19 RevB.pdf');
  expect(line('C1: Beam B/2-3 W310x39')).toContain('Completed');
  expect(line('C3: Bay 2-3')).toContain('Carried over to Pair 19 RevB.pdf');
  expect(line('C1: Beam B/2-3 overstressed, use')).not.toContain('Completed');
  // The check highlights are part of their comments, not rows of their own.
  expect(csv).not.toContain('closeout-');

  // Reopen takes a close-out back; Ctrl+Z in A brings it back as one step.
  await row(page, 'C1-cloud').click();
  await action(page, 'Reopen').click();
  await expect(row(page, 'C1-cloud')).toHaveAttribute('data-state', 'open');
  expect(await parts(page, a, 'C1-cloud')).toEqual([]);
  await viewport(page, 'a').focus();
  await page.keyboard.press('Control+z');
  await expect(row(page, 'C1-cloud')).toHaveAttribute('data-state', 'addressed');
  expect(await parts(page, a, 'C1-cloud')).toHaveLength(3);

  // The list by keyboard: arrows move and show the comment.
  await pane(page).getByTestId('closeout-list').focus();
  await page.keyboard.press('Home');
  await expect(row(page, 'C1-cloud')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'C1-text')).toHaveAttribute('aria-selected', 'true');
});

test('Copy to New Revision lands on the matching spot through the alignment; paste between the windows too (pair 03: scale and shift)', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '03');
  await skipReviewerPrompt(page);
  // Sheet 2: B is A at 98.2 %, centred.
  await page
    .getByTestId('overlay-sheets')
    .getByRole('option', { name: /^Sheet 2/u })
    .click();
  await overlayDrawn(page);
  const a = await docId(page, 'a');
  const b = await docId(page, 'b');
  // A rectangle on A, shown in A's window (the windows are linked: the same spot of the drawing).
  const id = (await cap(page, 'annotate', 'createSquare', a, 1, 400, 300)) as string;
  await expect.poll(async () => (await objects(page, a)).length).toBe(1);
  await cap(page, 'annotate', 'select', a, 1, id);
  const body = win(page, 'a').locator(`.annotation-body[data-annotation-id="${id}"]`);
  await expect(body).toBeVisible();

  // The comment menu in A: Copy to New Revision.
  const box = await body.boundingBox();
  if (!box) throw new Error('not on screen');
  await page.mouse.click(box.x + 1.5, box.y + box.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Comment' });
  await expect(menu.getByRole('menuitem', { name: 'Copy to Old Revision' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Copy to New Revision' }).click();
  await expect.poll(async () => (await objects(page, b)).length).toBe(1);
  const copy = (await objects(page, b))[0];
  if (!copy) throw new Error('no copy');
  // It sits on the same spot of the drawing: as far from B's window centre as the
  // original is from A's (the windows are linked at matching zoom).
  const inA = await fromCentre(page, 'a', await centreOn(body));
  const copyBody = win(page, 'b').locator(`.annotation-body[data-annotation-id="${copy.id}"]`);
  await expect(copyBody).toBeVisible();
  const inB = await fromCentre(page, 'b', await centreOn(copyBody));
  expect(Math.abs(inA.dx - inB.dx)).toBeLessThan(4);
  expect(Math.abs(inA.dy - inB.dy)).toBeLessThan(4);
  // Pair 03's B is A scaled: the copy is scaled with the drawing, not just moved.
  const src = (await objects(page, a))[0];
  if (!src) throw new Error('no original');
  expect(Math.abs(copy.rect.size.width - src.rect.size.width)).toBeGreaterThan(1);

  // Paste between the windows: copied in B, pasted in A, it lands on the original's spot.
  await cap(page, 'annotate', 'select', b, 1, copy.id);
  await viewport(page, 'b').focus();
  await page.keyboard.press('Control+c');
  await viewport(page, 'a').focus();
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await objects(page, a)).length).toBe(2);
  const back = (await objects(page, a)).find((o) => o.id !== id);
  if (!back) throw new Error('no paste');
  expect(Math.abs(back.rect.origin.x - src.rect.origin.x)).toBeLessThan(1.5);
  expect(Math.abs(back.rect.origin.y - src.rect.origin.y)).toBeLessThan(1.5);
  expect(Math.abs(back.rect.size.width - src.rect.size.width)).toBeLessThan(1.5);
});

test('text comparison: Copy to New Revision lands on the matching text; the close-out list works there too (text pair 09)', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await textOf(page, '09');
  await skipReviewerPrompt(page);
  const a = (await page.getByTestId('text-view-a').getAttribute('data-doc-id')) ?? '';
  const b = (await page.getByTestId('text-view-b').getAttribute('data-doc-id')) ?? '';
  // A rectangle part way down A's second page.
  const id = (await cap(page, 'annotate', 'createSquare', a, 1, 80, 400)) as string;
  await expect.poll(async () => (await objects(page, a)).length).toBe(1);

  // Zoomed in, so that the documents are taller than their windows (B follows A's zoom).
  const va = await page.getByTestId('text-view-a').boundingBox();
  if (!va) throw new Error('no window');
  await page.mouse.move(va.x + va.width / 2, va.y + va.height / 2);
  await page.keyboard.down('Control');
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForTimeout(500);

  await showList(page);
  await row(page, id).click();
  // Picking it centres its text on both sides.
  const body = page
    .getByTestId('text-view-a')
    .locator(`.annotation-body[data-annotation-id="${id}"]`);
  await expect(body).toBeVisible();
  await action(page, 'Copy to New Revision').click();
  await expect.poll(async () => (await objects(page, b)).length).toBe(1);
  const copy = (await objects(page, b))[0];
  if (!copy) throw new Error('no copy');
  // The copy sits on B's matching text: picking the comment centred its text on both
  // sides, so the copy is as far from B's window centre as the comment is from A's.
  const copyBody = page
    .getByTestId('text-view-b')
    .locator(`.annotation-body[data-annotation-id="${copy.id}"]`);
  await expect(copyBody).toBeVisible();
  const centre = async (testId: string, p: { x: number; y: number }) => {
    const v = await page.getByTestId(testId).boundingBox();
    if (!v) throw new Error(`no window ${testId}`);
    return p.y - (v.y + v.height / 2);
  };
  // (Both windows show the same zoom: the same offset is the same text.)
  await expect
    .poll(async () => {
      const inA = await centre('text-view-a', await centreOn(body));
      const inB = await centre('text-view-b', await centreOn(copyBody));
      return Math.abs(inA - inB);
    })
    .toBeLessThan(6);
  // Its x is kept.
  expect(copy.rect.origin.x).toBeCloseTo(80, 0);

  // Close-out in a text comparison: Carried Over copies once more and closes it out.
  await action(page, 'Carried Over').click();
  await expect(row(page, id)).toHaveAttribute('data-state', 'carried');
  await expect
    .poll(async () => (await objects(page, b)).filter((o) => o.type === T.SQUARE).length)
    .toBe(2);
});

test('the close-out list passes axe in light and dark, with a comment closed out; it is keyboard reachable @a11y', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await overlayOf(page, '19');
  await skipReviewerPrompt(page);
  // The toggle is reached by Tab like the other head buttons.
  const toggle = page.getByRole('button', { name: 'Close-out list' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(pane(page)).toBeVisible();
  await row(page, 'C1-cloud').click();
  await action(page, 'Addressed').click();
  await expect(row(page, 'C1-cloud')).toHaveAttribute('data-state', 'addressed');
  const axe = async (): Promise<void> => {
    const r = await new AxeBuilder({ page }).include('[data-testid="closeout-pane"]').analyze();
    expect(r.violations).toEqual([]);
  };
  await axe();
  await darkTheme(page);
  await axe();
  // Into the list and its buttons by keyboard.
  await pane(page).getByTestId('closeout-list').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'C1-text')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(pane(page).locator(':focus')).toHaveCount(1);
});
