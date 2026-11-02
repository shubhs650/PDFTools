import type { Page } from '@playwright/test';
import { hasQpdf, qpdfEncrypt } from './fixtures/encrypted.ts';
import {
  NEEDLE,
  fullFormPdf,
  outlinedPdf,
  richOutlinePdf,
  snapSheet,
} from './fixtures/generate.ts';
import { reviewSourcePdf } from './fixtures/comments.ts';
import { tablesPdf } from './fixtures/tables.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';
import { printCalls, stubFramePrint } from './support/printStub.ts';
import { savedFiles, stubSavePicker } from './support/savePicker.ts';

// M1-25 (§9, D-17): the service worker precaches the core at install and the
// rest after the first render; offline, a reload opens, renders, saves and
// recovers with zero outbound requests. The e2e build registers the service
// worker only with `?sw`.

const status = (page: Page) => page.getByRole('contentinfo', { name: 'Status bar' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');

test(
  'first visit: "Preparing offline… n %" then "✓ Ready offline"; offline: reload, open, render, save and recover with zero outbound requests',
  { tag: '@offline' },
  async ({ page, context, pdfs }) => {
    // Every status-bar text shown, so the short "Preparing offline…" phase is seen too.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __statusSeen: string[] }).__statusSeen = seen;
      new MutationObserver(() => {
        const t = document.querySelector('footer.status-bar')?.textContent ?? '';
        if (t && seen.at(-1) !== t) seen.push(t);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.goto('/?sw');
    await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });
    const seen = await page.evaluate(
      () => (window as unknown as { __statusSeen: string[] }).__statusSeen,
    );
    expect(seen.some((t) => /Preparing offline… \d+/.test(t))).toBe(true);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    const outbound: string[] = [];
    page.on('requestfailed', (r) => {
      if (/^https?:/.test(r.url())) outbound.push(`failed ${r.url()}`);
    });
    page.on('response', (r) => {
      if (/^https?:/.test(r.url()) && !r.fromServiceWorker()) outbound.push(r.url());
    });
    try {
      await page.reload();
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await expect(status(page).getByText('✓ Ready offline')).toBeVisible();

      const [id] = (await cap(page, 'open', 'openHandles', [
        { name: 'offline.pdf', b64: pdfs.contract(20).toString('base64') },
      ])) as string[];
      if (!id) throw new Error('not opened');
      await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();

      expect(await cap(page, 'save', 'addSquares', id, 2)).toBeNull();
      await page.keyboard.press('Control+S');
      await expect(tabs(page).first()).toHaveAccessibleName('offline.pdf');

      expect(await cap(page, 'save', 'addSquares', id, 1, 2)).toBeNull();
      await expect
        .poll(async () => ((await cap(page, 'storage', 'list')) as unknown[]).length, {
          timeout: 10_000,
        })
        .toBe(1);
      expect(outbound).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  },
);

test(
  'M2 offline: protected open, search, panes, form fill + save, print, print-ready export; a report fails gracefully; zero outbound requests',
  { tag: '@offline' },
  async ({ page, context, pdfs }) => {
    test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixture');
    test.setTimeout(120_000);
    await stubFramePrint(page);
    await page.goto('/?sw');
    await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });

    await context.setOffline(true);
    const outbound: string[] = [];
    page.on('requestfailed', (r) => {
      if (/^https?:/.test(r.url())) outbound.push(`failed ${r.url()}`);
    });
    page.on('response', (r) => {
      if (/^https?:/.test(r.url()) && !r.fromServiceWorker()) outbound.push(r.url());
    });
    const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
    try {
      await page.reload();
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await stubSavePicker(page);

      // Protected open (M2-03).
      const locked = qpdfEncrypt(pdfs.contract(12), 'user-pw', 'owner-pw', ['256']);
      await drop(page, [{ name: 'locked.pdf', b64: b64(locked) }]);
      const prompt = page.getByRole('dialog', { name: 'Password required' });
      await prompt.getByLabel('Password').fill('user-pw');
      await prompt.getByRole('button', { name: 'Open' }).click();
      await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();

      // Quick Find (M2-07) and the Thumbnails pane (M2-08).
      await page.getByTestId('document-view').focus();
      await page.keyboard.press('Control+F');
      const find = page.getByRole('region', { name: 'Find in document' });
      await find.getByRole('searchbox', { name: 'Find' }).fill(NEEDLE);
      await find.getByRole('searchbox', { name: 'Find' }).press('Enter');
      await expect(find.getByRole('status')).toHaveText(/of \d+/, { timeout: 20_000 });
      await find.getByRole('searchbox', { name: 'Find' }).press('Escape');
      const rail = page.getByRole('complementary', { name: 'Navigation panes' });
      // Thumbnails is the pane shown by default.
      const thumbs = rail.getByRole('button', { name: 'Thumbnails' });
      if ((await thumbs.getAttribute('aria-pressed')) !== 'true') await thumbs.click();
      await expect(
        page
          .getByRole('listbox', { name: 'Page thumbnails' })
          .getByRole('option')
          .first()
          .locator('img'),
      ).toBeVisible();

      // Bookmarks pane (M2-10).
      await drop(page, [{ name: 'outlined.pdf', b64: b64(outlinedPdf()) }]);
      await expect(page.getByRole('tab', { name: 'outlined.pdf' })).toBeVisible();
      await rail.getByRole('button', { name: 'Bookmarks' }).click();
      await expect(
        page.getByRole('tree', { name: 'Bookmarks' }).getByRole('treeitem').first(),
      ).toBeVisible();

      // Form fill + Ctrl+S (M2-14), then print (M2-15) and export (M2-16).
      const [formId] = (await cap(page, 'open', 'openHandles', [
        { name: 'form.pdf', b64: b64(fullFormPdf()) },
      ])) as string[];
      if (!formId) throw new Error('not opened');
      const name = page.getByRole('textbox', { name: 'name field' });
      await name.fill('Offline');
      await name.press('Enter');
      await expect(tabs(page).last()).toHaveAccessibleName(/unsaved/);
      await page.keyboard.press('Control+S');
      const growth = page.getByRole('dialog', { name: 'Save optimized instead?' });
      await expect(
        growth.or(page.getByRole('tab', { name: 'form.pdf', exact: true })),
      ).toBeVisible();
      if (await growth.isVisible()) await growth.getByRole('button', { name: 'Just save' }).click();
      await expect(page.getByRole('tab', { name: 'form.pdf', exact: true })).toBeVisible();

      await page.keyboard.press('Control+P');
      const print = page.getByRole('dialog', { name: 'Print' });
      await print.getByRole('button', { name: 'Print', exact: true }).click();
      await expect.poll(() => printCalls(page)).toBe(1);

      await page.getByTestId('file-tab').click();
      const backstage = page.getByTestId('backstage');
      await backstage.getByRole('button', { name: 'Export Print-Ready PDF' }).first().click();
      await backstage
        .getByRole('region')
        .getByRole('button', { name: 'Export Print-Ready PDF' })
        .click();
      const exportDialog = page.getByRole('dialog', { name: 'Export Print-Ready PDF' });
      await exportDialog.getByRole('button', { name: 'Export…' }).click();
      await expect(exportDialog).toHaveCount(0);
      expect((await savedFiles(page)).map((f) => f.name)).toEqual(['form (print-ready).pdf']);

      // The error report can't be sent offline: a message and Copy report (M2-17).
      await page.getByRole('tab', { name: 'Help' }).click();
      await page
        .getByRole('toolbar', { name: 'Help commands' })
        .getByRole('button', { name: 'Send Error Report' })
        .click();
      const report = page.getByRole('dialog', { name: 'Send Error Report' });
      // Nothing left the device before the user's own Send.
      expect(outbound).toEqual([]);
      await report.getByRole('button', { name: 'Send' }).click();
      await expect(report.getByRole('alert')).toHaveText(/You're offline/);
      await expect(report.getByRole('button', { name: 'Copy report' })).toBeVisible();
      // Send may try its one same-origin POST (browsers differ on navigator.onLine
      // while offline); it fails, and nothing else is requested.
      expect(outbound.filter((u) => !/^failed https?:\/\/[^/]+\/api\/report$/.test(u))).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  },
);

test(
  'M3 offline: markups, a snapped measurement, a stamp, the CRS export and Ctrl+S; zero outbound requests',
  { tag: '@offline' },
  async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('/?sw');
    await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });

    await context.setOffline(true);
    const outbound: string[] = [];
    page.on('requestfailed', (r) => {
      if (/^https?:/.test(r.url())) outbound.push(`failed ${r.url()}`);
    });
    page.on('response', (r) => {
      if (/^https?:/.test(r.url()) && !r.fromServiceWorker()) outbound.push(r.url());
    });
    try {
      await page.reload();
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await stubSavePicker(page);
      await cap(page, 'annotate', 'setProfile', 'Offline Reviewer');
      await drop(page, [{ name: 'sheet.pdf', b64: Buffer.from(snapSheet()).toString('base64') }]);
      await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
      const id = (await cap(page, 'view', 'activeDocId')) as string;
      await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();

      // Annotation (M3-05) and a dynamic stamp (M3-14; its font from the cache).
      await cap(page, 'annotate', 'createSquare', id, 0, 60, 60);
      expect(await cap(page, 'annotate', 'stamp', id, 0, 300, 80)).not.toBeNull();

      // A page scale, snapping on (Work + Snap workers), a measurement on the rectangle's edge.
      const measure = page.getByRole('toolbar', { name: 'Measure commands' });
      await page.getByRole('tab', { name: 'Measure' }).click();
      await measure.getByRole('button', { name: 'Set Scale' }).click();
      const dialog = page.getByRole('dialog', { name: 'Set scale' });
      await dialog.getByLabel('Real').fill('100');
      await dialog.getByLabel('Units').selectOption({ label: 'Metres' });
      await dialog.getByRole('button', { name: 'Apply' }).click();
      await page.getByTestId('snap-toggle').click();
      await expect
        .poll(
          async () =>
            ((await cap(page, 'annotate', 'snap')) as { pages: Record<string, string> }).pages[
              `${id}/0`
            ],
          { timeout: 20_000 },
        )
        .toBe('ready');
      await measure.getByRole('button', { name: 'Distance', exact: true }).click();
      const box = await page.locator('[data-page="0"] .page-content').boundingBox();
      if (!box) throw new Error('page not laid out');
      const k = box.width / 600;
      const at = (x: number, y: number) => ({ x: box.x + x * k, y: box.y + (600 - y) * k });
      const a = at(402, 448);
      const b = at(498, 452);
      await page.mouse.move(a.x, a.y, { steps: 3 });
      await expect(page.getByTestId('snap-marker')).toBeVisible();
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 6 });
      await page.mouse.up();
      await expect
        .poll(async () =>
          ((await cap(page, 'annotate', 'list', id)) as { contents: string | null }[]).some(
            (o) => o.contents === '3.53 m',
          ),
        )
        .toBe(true);
      await page.keyboard.press('Escape');

      // The CRS workbook (ExcelJS from the cache) and Ctrl+S.
      await page.getByRole('tab', { name: 'Comment' }).click();
      await page
        .getByRole('toolbar', { name: 'Comment commands' })
        .getByRole('button', { name: 'Export CRS' })
        .click();
      const crs = page.getByRole('dialog', { name: 'Export Comment Review Sheet' });
      await crs.getByRole('button', { name: 'Export' }).click();
      await expect(crs).toBeHidden({ timeout: 30_000 });
      await page.getByTestId('document-view').focus();
      await page.keyboard.press('Control+S');
      await expect(tabs(page).first()).toHaveAccessibleName('sheet.pdf');
      expect((await savedFiles(page)).map((f) => f.name)).toContain('sheet (CRS).xlsx');
      expect(outbound).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  },
);

test(
  'M4 offline: tables, a page operation, comment import and a verified redaction; zero outbound requests',
  { tag: '@offline' },
  async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('/?sw');
    await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });

    await context.setOffline(true);
    const outbound: string[] = [];
    page.on('requestfailed', (r) => {
      if (/^https?:/.test(r.url())) outbound.push(`failed ${r.url()}`);
    });
    page.on('response', (r) => {
      if (/^https?:/.test(r.url()) && !r.fromServiceWorker()) outbound.push(r.url());
    });
    try {
      await page.reload();
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await stubSavePicker(page);
      await cap(page, 'annotate', 'setProfile', 'Offline Reviewer');
      await drop(page, [{ name: 'tables.pdf', b64: Buffer.from(tablesPdf()).toString('base64') }]);
      await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
      const id = (await cap(page, 'view', 'activeDocId')) as string;
      await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();

      // Tables (M4-13): PDF Oxide and ExcelJS from the cache.
      await page.getByRole('tab', { name: 'Convert' }).click();
      await page
        .getByRole('toolbar', { name: 'Convert commands' })
        .getByRole('button', { name: 'Express Extract' })
        .click();
      const express = page.getByRole('dialog', { name: 'Express Extract (Beta)' });
      await express.getByRole('button', { name: 'Find Tables' }).click();
      await expect(express.getByRole('status')).toContainText('2 tables found.', {
        timeout: 30_000,
      });
      await express.getByRole('button', { name: 'Save…' }).click();
      await expect(express).toBeHidden({ timeout: 30_000 });

      // A page operation (M4-09).
      expect(await cap(page, 'pages', 'run', id, { kind: 'rotate', pages: [3], quarter: 1 })).toBe(
        true,
      );

      // Comment import from another PDF (M4-20).
      await page.evaluate((data) => {
        const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
        w.showOpenFilePicker = () => {
          const bin = atob(data);
          const file = new File([Uint8Array.from(bin, (c) => c.charCodeAt(0))], 'rev-a.pdf', {
            type: 'application/pdf',
          });
          return Promise.resolve([
            { kind: 'file', name: 'rev-a.pdf', getFile: () => Promise.resolve(file) },
          ]);
        };
      }, Buffer.from(reviewSourcePdf()).toString('base64'));
      await page.getByRole('tab', { name: 'Comment', exact: true }).click();
      await page
        .getByRole('toolbar', { name: 'Comment commands' })
        .getByRole('button', { name: 'Import Comments' })
        .click();
      const imp = page.getByRole('dialog', { name: 'Import Comments' });
      await imp.getByRole('button', { name: 'Choose PDF or JSON…' }).click();
      await expect(imp.getByText('rev-a.pdf: 3 comments on 3 pages.')).toBeVisible();
      await imp.getByRole('button', { name: 'Import' }).click();
      await expect(imp).toBeHidden();
      await expect
        .poll(async () => ((await cap(page, 'annotate', 'list', id)) as unknown[]).length)
        .toBeGreaterThan(0);

      // A redaction mark on the prose page and Apply (M4-16 … M4-18): verified, then written.
      const area = { origin: { x: 60, y: 60 }, size: { width: 300, height: 60 } };
      await cap(page, 'annotate', 'create', id, 4, {
        type: 28,
        rect: area,
        segmentRects: [area],
        color: '#000000',
        strokeColor: '#D93025',
      });
      await page.getByRole('tab', { name: 'Protect' }).click();
      await page
        .getByRole('toolbar', { name: 'Protect commands' })
        .getByRole('button', { name: 'Apply Redactions' })
        .click();
      const apply = page.getByRole('dialog', { name: 'Apply Redactions' });
      await apply.getByRole('button', { name: 'Apply and Save As…' }).click();
      await expect(apply.getByTestId('redact-result')).toContainText('Every check passed.', {
        timeout: 60_000,
      });
      await apply.getByRole('button', { name: 'Close' }).first().click();

      // Ctrl+S of the open document (narrow, verified).
      await page.getByTestId('document-view').focus();
      await page.keyboard.press('Control+S');
      await expect(tabs(page).first()).toHaveAccessibleName('tables.pdf');
      expect((await savedFiles(page)).map((f) => f.name)).toEqual(
        expect.arrayContaining(['tables tables.xlsx', 'tables-redacted.pdf']),
      );
      expect(outbound).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  },
);

// M6-15: the beta-review features with the network off — Sign Document (the
// bundled handwriting fonts from the cache), Attach File, a form field, a
// bookmark, Flatten Comments, Password Security (made and checked in the
// workers) and a verified save — with zero outbound requests.
test(
  'M6 offline: sign, attach a file, a form field, a bookmark, flatten, password security; zero outbound requests',
  { tag: '@offline' },
  async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('/?sw');
    await expect(status(page).getByText('✓ Ready offline')).toBeVisible({ timeout: 60_000 });

    await context.setOffline(true);
    const outbound: string[] = [];
    page.on('requestfailed', (r) => {
      if (/^https?:/.test(r.url())) outbound.push(`failed ${r.url()}`);
    });
    page.on('response', (r) => {
      if (/^https?:/.test(r.url()) && !r.fromServiceWorker()) outbound.push(r.url());
    });
    try {
      await page.reload();
      await expect(page.getByTestId('start-screen')).toBeVisible();
      await stubSavePicker(page);
      await cap(page, 'annotate', 'setProfile', 'Offline Reviewer');
      await drop(page, [
        { name: 'outline.pdf', b64: Buffer.from(richOutlinePdf()).toString('base64') },
      ]);
      await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
      const id = (await cap(page, 'view', 'activeDocId')) as string;
      await expect.poll(() => cap(page, 'annotate', 'list', id)).not.toBeNull();
      await page.getByTestId('document-view').focus();
      await page.keyboard.press('ControlOrMeta+0');
      const at = async (x: number, y: number) => {
        const box = await page.locator('[data-page="0"] .page-content').boundingBox();
        if (!box) throw new Error('page not laid out');
        const k = box.width / 595;
        return { x: box.x + x * k, y: box.y + y * k };
      };
      const objects = async () =>
        ((await cap(page, 'annotate', 'objects', id)) as
          { type: number; subject?: string }[] | null) ?? [];

      // Sign Document (M6-13): a typed signature in a bundled font, placed with a click.
      await page.getByRole('tab', { name: 'Protect', exact: true }).click();
      const protect = page.getByRole('toolbar', { name: 'Protect commands' });
      await protect.getByRole('button', { name: 'Sign Document…' }).click();
      const sign = page.getByRole('dialog', { name: 'Sign Document' });
      await expect(sign.getByRole('radio', { name: 'Type' })).toBeChecked();
      await sign.getByRole('checkbox', { name: 'Save on this device for next time' }).uncheck();
      await sign.getByRole('button', { name: 'Place Signature' }).click();
      await expect(sign).toBeHidden();
      const s = await at(400, 700);
      await page.mouse.move(s.x, s.y);
      await page.mouse.click(s.x, s.y);
      await expect
        .poll(async () => (await objects()).filter((o) => o.subject === 'Signature').length)
        .toBe(1);

      // Attach File (M6-10).
      await page.evaluate(() => {
        const w = window as unknown as { showOpenFilePicker: () => Promise<unknown[]> };
        w.showOpenFilePicker = () => {
          const file = new File([new TextEncoder().encode('a,b\n1,2\n')], 'calc.csv');
          return Promise.resolve([
            { kind: 'file', name: 'calc.csv', getFile: () => Promise.resolve(file) },
          ]);
        };
      });
      await page.getByRole('tab', { name: 'Comment', exact: true }).click();
      const comment = page.getByRole('toolbar', { name: 'Comment commands' });
      await comment.getByRole('button', { name: 'Attach File', exact: true }).click();
      const a = await at(480, 300);
      await page.mouse.click(a.x, a.y);
      await expect.poll(async () => (await objects()).filter((o) => o.type === 17).length).toBe(1);
      await page.getByTestId('document-view').focus();
      await page.keyboard.press('Escape');

      // A text field (M6-14): Enter on the page puts one in the middle.
      await page.getByRole('tab', { name: 'Form', exact: true }).click();
      await page
        .getByRole('toolbar', { name: 'Form commands' })
        .getByRole('button', { name: 'Text Field', exact: true })
        .click();
      await page.getByTestId('document-view').focus();
      await page.keyboard.press('Enter');
      await expect
        .poll(async () => ((await cap(page, 'save', 'widgets', id, 0)) as unknown[]).length)
        .toBe(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      // A bookmark (M6-11): written by the Work worker's outline writer.
      const rail = page
        .getByRole('complementary', { name: 'Navigation panes' })
        .getByRole('button', { name: 'Bookmarks' });
      if ((await rail.getAttribute('aria-pressed')) !== 'true') await rail.click();
      const tree = page.getByRole('tree', { name: 'Bookmarks' });
      await tree.getByRole('treeitem', { name: 'Last', exact: true }).focus();
      await page.keyboard.press('Insert');
      const title = tree.getByRole('textbox', { name: 'Bookmark title' });
      await expect(title).toBeFocused();
      await title.fill('Offline bookmark');
      await title.press('Enter');
      await expect(tree.getByRole('treeitem', { name: 'Offline bookmark' })).toBeFocused();

      // Flatten Comments (M6-09): the signature and the attachment become page content.
      await page.getByRole('tab', { name: 'Comment', exact: true }).click();
      await comment.getByRole('button', { name: 'Flatten Comments' }).click();
      const flatten = page.getByRole('dialog', { name: 'Flatten Comments' });
      await flatten.getByRole('button', { name: 'Flatten', exact: true }).click();
      await expect(flatten).toHaveCount(0);
      await expect
        .poll(async () => (await objects()).filter((o) => o.subject === 'Signature').length)
        .toBe(0);

      // A verified save of everything (the same route as Ctrl+S).
      expect(await cap(page, 'save', 'verifiedSave', id)).toMatchObject({ fellBack: false });

      // Password Security (M6-12): made on a copy, checked in the Work worker, written.
      await page.getByRole('tab', { name: 'Protect', exact: true }).click();
      await protect.getByRole('button', { name: 'Password Security…' }).click();
      const pw = page.getByRole('dialog', { name: 'Password Security' });
      await pw.getByLabel('Open password', { exact: true }).fill('offline-pw');
      await pw.getByLabel('Confirm open password').fill('offline-pw');
      await pw.getByRole('button', { name: 'Apply and Save As…' }).click();
      await expect(pw.getByTestId('security-result')).toContainText('Every check passed.', {
        timeout: 30_000,
      });
      expect((await savedFiles(page)).map((f) => f.name)).toContain('outline-protected.pdf');
      expect(await cap(page, 'annotate', 'errors', '')).toEqual([]);
      expect(outbound).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  },
);
