import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  OWNER_PW,
  USER_PW,
  encryptedVariants,
  hasQpdf,
  qpdfEncrypt,
} from './fixtures/encrypted.ts';
import { fullFormPdf, simplePdf } from './fixtures/generate.ts';
import { cap, drop } from './support/app.ts';
import { expect, test } from './support/fixtures.ts';

// M2-03: protected PDFs (D-19, §7.12, rule 9, ADR-013). Fixtures are self-made
// and encrypted by qpdf at test time (CI installs it; M1-07).

test.skip(!hasQpdf(), 'qpdf is needed to make the encrypted fixtures');

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open documents' }).getByRole('tab');
const passwordDialog = (page: Page) => page.getByRole('dialog', { name: 'Password required' });
const unlockDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Unlock with owner password' });
const banner = (page: Page) => page.getByRole('region', { name: 'Document restrictions' });
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** R6 with a user password; print, copy, modify, annotate and form filling denied. */
const restrictedR6 = (): Uint8Array => {
  const v = encryptedVariants(fullFormPdf()).find((x) => x.name === 'R6-aes-256');
  if (!v) throw new Error('R6 fixture');
  return v.bytes;
};

async function axeClean(page: Page, selector: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).include(selector).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

test('open password: wrong, then right; the document opens restricted with a banner @smoke', async ({
  page,
}) => {
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(restrictedR6()) }]);
  const dialog = passwordDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('locked.pdf');
  const field = dialog.getByLabel('Password');
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');
  await axeClean(page, '[role="dialog"]');

  await field.fill('not-it');
  await field.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('That password is not correct. Try again.');
  await expect(dialog.getByLabel('Password')).toHaveValue(''); // a fresh field for the retry

  await dialog.getByLabel('Password').fill(USER_PW);
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(dialog).toBeHidden();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAccessibleName('locked.pdf');
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();

  await expect(banner(page)).toContainText('printing');
  await expect(banner(page)).toContainText('filling in forms');
  await axeClean(page, '.permission-banner');
});

test('Cancel on the password prompt opens nothing and shows no error', async ({ page }) => {
  await page.goto('/');
  await drop(page, [{ name: 'locked.pdf', b64: b64(restrictedR6()) }]);
  await passwordDialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(passwordDialog(page)).toBeHidden();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('owner password: restricted edits are refused until Unlock; then the banner goes and Unlock is disabled', async ({
  page,
}) => {
  const owner = encryptedVariants(fullFormPdf()).find((x) => x.name === 'R6-owner-only');
  if (!owner) throw new Error('fixture');
  await page.goto('/');
  await drop(page, [{ name: 'restricted.pdf', b64: b64(owner.bytes) }]);
  await expect(passwordDialog(page)).toHaveCount(0); // no open password
  await expect(tabs(page)).toHaveCount(1);
  await expect(banner(page)).toBeVisible();
  const id = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;

  // Rule 9 in the Render worker: the flags refuse annotations (PDFium Security = 5).
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBe('pdfium:5');

  await page.getByRole('tab', { name: 'Protect' }).click();
  const unlock = page
    .getByRole('toolbar', { name: 'Protect commands' })
    .getByRole('button', { name: 'Unlock with Owner Password' });
  await expect(unlock).not.toHaveAttribute('aria-disabled', 'true');

  await banner(page).getByRole('button', { name: 'Unlock…' }).click();
  const dialog = unlockDialog(page);
  await expect(dialog).toBeVisible();
  await axeClean(page, '[role="dialog"]');
  await dialog.getByLabel('Owner password').fill('wrong');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('That owner password is not correct.');
  // (The modal hides the page from the accessibility tree meanwhile.)
  await expect(page.locator('.permission-banner')).toBeVisible();

  await dialog.getByLabel('Owner password').fill(OWNER_PW);
  await dialog.getByLabel('Owner password').press('Enter');
  await expect(dialog).toBeHidden();
  await expect(banner(page)).toBeHidden();
  await expect(unlock).toHaveAttribute('aria-disabled', 'true');
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
});

/** Every place the app stores data (§10.3) searched for `needles` (Latin-1 and UTF-16LE). */
function findInStorage(page: Page, needles: string[]): Promise<string[]> {
  return page.evaluate(async (words) => {
    const found: string[] = [];
    const latin1 = (b: ArrayBuffer): string => {
      let s = '';
      const u = new Uint8Array(b);
      for (let i = 0; i < u.length; i += 0x8000)
        s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return s;
    };
    const check = (where: string, text: string): void => {
      for (const w of words) {
        const utf16 = Array.from({ length: w.length }, (_, i) => `${w.charAt(i)}\0`).join('');
        if (text.includes(w) || text.includes(utf16)) found.push(`${where}: ${w}`);
      }
    };
    const json = (v: unknown): string =>
      JSON.stringify(v, (_k, x: unknown) => (x instanceof ArrayBuffer ? latin1(x) : x));
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(info.name ?? '');
        r.onsuccess = () => {
          resolve(r.result);
        };
        r.onerror = () => {
          reject(new Error('idb'));
        };
      });
      for (const store of db.objectStoreNames) {
        const all = await new Promise<unknown[]>((resolve) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => {
            resolve(r.result as unknown[]);
          };
        });
        check(`idb ${info.name}/${store}`, json(all));
      }
      db.close();
    }
    const walk = async (dir: FileSystemDirectoryHandle, path: string): Promise<void> => {
      for await (const [name, h] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, `${path}/${name}`);
        else {
          const f = await (h as FileSystemFileHandle).getFile();
          check(`opfs ${path}/${name}`, latin1(await f.arrayBuffer()));
        }
      }
    };
    await walk(await navigator.storage.getDirectory(), '');
    check('localStorage', json(Object.entries(localStorage)));
    check('sessionStorage', json(Object.entries(sessionStorage)));
    return found;
  }, needles);
}

test('passwords are never stored: after an edit and its recovery snapshot, nothing holds them; Recover asks again', async ({
  page,
}) => {
  page.on('dialog', (d) => {
    void d.accept(); // beforeunload on reload
  });
  const user = 'user-secret-4711';
  const ownerPw = 'owner-secret-0815';
  // Everything allowed except printing, so the edit is possible and Unlock has work to do.
  const bytes = qpdfEncrypt(simplePdf(2), user, ownerPw, ['256', '--print=none']);
  await page.goto('/');
  await cap(page, 'open', 'state'); // waits until the test hook's open capability exists
  // Through a file handle, so the recent list (IndexedDB) records it as well.
  await page.evaluate(
    ({ name, data }) => {
      const hook = (
        window as unknown as {
          __pdftoolsTest: {
            capabilities: Record<string, Record<string, (...a: unknown[]) => unknown>>;
          };
        }
      ).__pdftoolsTest;
      void hook.capabilities.open?.openHandles?.([{ name, b64: data }]);
    },
    { name: 'secret.pdf', data: b64(bytes) },
  );
  await passwordDialog(page).getByLabel('Password').fill(user);
  await passwordDialog(page).getByRole('button', { name: 'Open' }).click();
  await expect(tabs(page)).toHaveCount(1);
  await banner(page).getByRole('button', { name: 'Unlock…' }).click();
  await unlockDialog(page).getByLabel('Owner password').fill(ownerPw);
  await unlockDialog(page).getByRole('button', { name: 'Unlock' }).click();
  await expect(banner(page)).toBeHidden();

  const id = ((await cap(page, 'open', 'state')) as { activeId: string }).activeId;
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  await expect
    .poll(async () => ((await cap(page, 'storage', 'list')) as unknown[]).length, {
      timeout: 10_000,
    })
    .toBe(1);
  expect(await findInStorage(page, [user, ownerPw])).toEqual([]);
  // Negative control: the scan does find a planted value.
  await page.evaluate((v) => {
    sessionStorage.setItem('probe', v);
  }, user);
  expect(await findInStorage(page, [user])).toEqual([`sessionStorage: ${user}`]);
  await page.evaluate(() => {
    sessionStorage.removeItem('probe');
  });

  await page.reload();
  const recover = page.getByRole('dialog', { name: 'Recover unsaved changes?' });
  await recover.getByRole('button', { name: 'Recover secret.pdf' }).click();
  await expect(passwordDialog(page)).toBeVisible();
  await passwordDialog(page).getByLabel('Password').fill(user);
  await passwordDialog(page).getByRole('button', { name: 'Open' }).click();
  await expect(tabs(page).first()).toHaveAccessibleName('secret.pdf, unsaved changes');
  // Restrictions are back after a reload: the unlock lasted for the session only.
  await expect(banner(page)).toContainText('printing');
  expect(await findInStorage(page, [user, ownerPw])).toEqual([]);
});

test('M3-04: object-layer strings in an encrypted file are saved encrypted and verified', async ({
  page,
}) => {
  const v = encryptedVariants(simplePdf(1)).find((x) => x.name === 'R4-aes-128');
  if (!v) throw new Error('R4 fixture');
  await page.goto('/');
  await drop(page, [{ name: 'aes.pdf', b64: b64(v.bytes) }]);
  const dialog = passwordDialog(page);
  await dialog.getByLabel('Password').fill(OWNER_PW);
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-page="0"] img.page-preview')).toBeVisible();
  const id = (await cap(page, 'view', 'activeDocId')) as string;
  expect(await cap(page, 'save', 'addSquares', id, 1)).toBeNull();
  const units = { dict: { Type: { name: 'Measure' }, R: { text: '1 mm = 100 mm' } } };
  expect(
    await cap(page, 'save', 'stage', id, { page: 0, annot: 'e2e-square-0' }, { Measure: units }),
  ).toBeNull();
  const r = (await cap(page, 'save', 'verifiedSave', id)) as {
    mode: string;
    fellBack: boolean;
    tail: string;
  };
  expect(r).toMatchObject({ mode: 'narrow', fellBack: false });
  const tail = Buffer.from(r.tail, 'base64').toString('latin1');
  expect(tail).toContain('/Measure');
  expect(tail).not.toContain('1 mm = 100 mm');
  expect(await cap(page, 'save', 'fallbacks')).toEqual([]);
});
