// M6-11 (ADR-022 decision 5, route B) on real PDFium: our outline reader and
// writer in the Work worker, the objects applied by the Render worker's
// tracker (reopen route), saved by Ctrl+S's narrow tail and reopened — by
// PDFium (what the viewer shows) and by our reader (every key kept: colour,
// style, open state, named destination, GoToR and JavaScript actions). Plain
// and encrypted documents; stale and invalid edits refused; a 1,000-bookmark
// outline.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { inflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfActionType,
  PdfZoomMode,
  type PdfBookmarkObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import {
  bigOutlinePdf,
  buildPdf,
  outlinedPdf,
  richOutlinePdf,
  simplePdf,
} from '../../e2e/fixtures/generate';
import {
  countItems,
  type OutlineEdit,
  type OutlineExpect,
  type OutlineItem,
} from '../../src/model/outline';
import { isDict, PdfRef, PdfString, serialize, type PdfDict } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { WorkDocs } from '../../src/workers/work/docs';
import { copyItems, editObjects, readOutline } from '../../src/workers/work/outline';

const require = createRequire(import.meta.url);
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-outline-'));

let native: PdfiumNative;
let tracker: SaveTracker;
let docs: WorkDocs;
let seq = 0;

const inflate = (b: Uint8Array) => Promise.resolve(new Uint8Array(inflateSync(b)));
const buf = (b: Uint8Array) => b.slice().buffer;
const passwords = new Map<string, string>();

beforeAll(async () => {
  const mod: WrappedPdfiumModule = await init({
    wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
  });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
  docs = new WorkDocs(() => native);
});

async function open(bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> {
  const id = `b${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: buf(bytes) }, password === undefined ? {} : { password })
    .toPromise();
  tracker.opened(id, bytes, password);
  await tracker.securityReady(id);
  await docs.open(id, buf(bytes), undefined, password);
  if (password !== undefined) passwords.set(id, password);
  return doc;
}

async function close(docId: string): Promise<void> {
  tracker.closed(docId);
  await docs.close(docId);
  await native.closeDocument({ id: docId } as PdfDocumentObject).toPromise();
}

/** What the main thread does: the Work copy made current, then the reader on it. */
async function liveReader(docId: string): Promise<PdfReader> {
  const { tail } = await tracker.snapshot(docId);
  docs.setLive(docId, tail.byteLength ? tail.buffer : null);
  const password = passwords.get(docId);
  return PdfReader.open(docs.liveBytes(docId), inflate, password === undefined ? {} : { password });
}

/** One edit: built in the "Work worker", applied by the "Render worker" (reopen). */
async function edit(docId: string, e: OutlineEdit, expectAt: OutlineExpect[] = []) {
  const r = await editObjects(await liveReader(docId), e, expectAt);
  const doc = await tracker.applyObjects(docId, r.objects, r.firstNew, 'modify');
  return { written: r.objects.length, doc };
}

async function save(docId: string, file: Uint8Array) {
  const r = await tracker.save(docId);
  const saved = concatBytes([file, r.tail]);
  tracker.commit(docId, r.tail.length);
  docs.append(docId, buf(r.tail));
  return { saved, tail: r.tail, mode: r.mode };
}

function qpdfOk(bytes: Uint8Array, password?: string): boolean {
  if (!hasQpdf) return true;
  const file = join(tmp, `f${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  const pw = password === undefined ? [] : [`--password=${password}`];
  return spawnSync('qpdf', [...pw, '--check', file]).status === 0;
}

const read = async (bytes: Uint8Array, password?: string): Promise<OutlineItem[]> =>
  readOutline(await PdfReader.open(bytes, inflate, password === undefined ? {} : { password }));

/** PDFium's view of a file (what EmbedPDF shows), flattened to "  title → page". */
async function engineView(bytes: Uint8Array, password?: string): Promise<string[]> {
  const id = `e${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: buf(bytes) }, password === undefined ? {} : { password })
    .toPromise();
  const { bookmarks } = (await native.getBookmarks(doc).toPromise()) as {
    bookmarks: PdfBookmarkObject[];
  };
  await native.closeDocument(doc).toPromise();
  const out: string[] = [];
  const walk = (list: PdfBookmarkObject[], depth: number) => {
    for (const b of list) {
      const t = b.target;
      const page =
        t?.type === 'destination'
          ? t.destination.pageIndex
          : t?.type === 'action' && t.action.type === PdfActionType.Goto
            ? t.action.destination.pageIndex
            : -1;
      out.push(`${'  '.repeat(depth)}${b.title} → ${String(page)}`);
      walk(b.children ?? [], depth + 1);
    }
  };
  walk(bookmarks, 0);
  return out;
}

/** The raw item dictionary (decrypted) whose title is `title`, without the tree links. */
async function rawItem(
  bytes: Uint8Array,
  title: string,
  password?: string,
): Promise<Record<string, string>> {
  const r = await PdfReader.open(bytes, inflate, password === undefined ? {} : { password });
  const cat = await r.resolve(r.trailer.get('Root'));
  const root = isDict(cat) ? await r.resolve(cat.get('Outlines')) : null;
  const hit: { dict: PdfDict | null } = { dict: null };
  const walk = async (ref: unknown): Promise<void> => {
    let cur = ref;
    while (cur instanceof PdfRef && !hit.dict) {
      const d = await r.get(cur);
      if (!isDict(d)) return;
      const t = d.get('Title');
      if (t instanceof PdfString && t.text() === title) hit.dict = d;
      await walk(d.get('First'));
      cur = d.get('Next');
    }
  };
  if (isDict(root)) await walk(root.get('First'));
  const found = hit.dict;
  if (!found) throw new Error(`no item ${title}`);
  const out: Record<string, string> = {};
  for (const [k, v] of found)
    if (!['Parent', 'Prev', 'Next', 'First', 'Last'].includes(k)) out[k] = serialize(v);
  return out;
}

const flat = (items: OutlineItem[], depth = 0): string[] =>
  items.flatMap((b) => [`${'  '.repeat(depth)}${b.title}`, ...flat(b.children, depth + 1)]);

describe('reading the outline (M6-11)', () => {
  it('reads titles, targets, colour, style and open state', async () => {
    const items = await read(richOutlinePdf());
    expect(flat(items)).toEqual([
      'Named destination',
      'Web link',
      'Other file',
      'Script',
      'Red bold, closed',
      '  Child of closed',
      'Last',
    ]);
    const [named, web, other, script, red, last] = items;
    // The named destination resolves through the /Names tree (page 2, /Fit).
    expect(named?.target).toEqual({
      type: 'destination',
      destination: { pageIndex: 1, zoom: { mode: PdfZoomMode.FitPage }, view: [] },
    });
    expect(web?.target).toEqual({
      type: 'action',
      action: { type: PdfActionType.URI, uri: 'https://example.com/' },
    });
    expect(web?.action).toBe('URI');
    expect(other?.action).toBe('GoToR');
    expect(script?.action).toBe('JavaScript');
    expect(red).toMatchObject({ color: [1, 0, 0], bold: true, italic: false, open: false });
    expect(red?.children[0]?.target).toEqual({
      type: 'destination',
      destination: {
        pageIndex: 1,
        zoom: { mode: PdfZoomMode.XYZ, params: { x: 72, y: 700, zoom: 1.5 } },
        view: [],
      },
    });
    expect(last).toMatchObject({ color: [0, 0, 1], bold: false, italic: true });
  });

  it('marks open parents open (the pane expands them at first)', async () => {
    const items = await read(bigOutlinePdf(3, 4, 5));
    expect(items.map((b) => b.open)).toEqual([true, true, true]);
    expect((await read(outlinedPdf())).every((b) => !b.open)).toBe(true);
  });
});

describe('editing the outline: written, applied, saved narrow, reopened', () => {
  it('renames one bookmark: one object written, every other key kept', async () => {
    const file = richOutlinePdf();
    const doc = await open(file);
    const before = await rawItem(file, 'Red bold, closed');
    const { written } = await edit(
      doc.id,
      { kind: 'update', path: [4], props: { title: 'Rot — 赤 (renamed)' } },
      [{ path: [4], title: 'Red bold, closed' }],
    );
    expect(written).toBe(1);
    const { saved, mode } = await save(doc.id, file);
    expect(mode).toBe('narrow');
    expect(qpdfOk(saved)).toBe(true);
    const after = await rawItem(saved, 'Rot — 赤 (renamed)');
    expect({ ...after, Title: '' }).toEqual({ ...before, Title: '' });
    expect(after.Count).toBe('-1');
    expect((await engineView(saved))[4]).toBe('Rot — 赤 (renamed) → 0');
    await close(doc.id);
  });

  it('keeps named destinations, GoToR and JavaScript actions through a reorder', async () => {
    const file = richOutlinePdf();
    const doc = await open(file);
    // "Last" first, then "Script" into the red parent (after its child).
    await edit(doc.id, { kind: 'move', path: [5], parent: [], index: 0 }, [
      { path: [5], title: 'Last' },
    ]);
    await edit(doc.id, { kind: 'move', path: [4], parent: [5], index: 1 });
    const { saved } = await save(doc.id, file);
    expect(qpdfOk(saved)).toBe(true);
    expect(flat(await read(saved))).toEqual([
      'Last',
      'Named destination',
      'Web link',
      'Other file',
      'Red bold, closed',
      '  Child of closed',
      '  Script',
    ]);
    expect((await rawItem(saved, 'Named destination')).Dest).toBe('(chap2)');
    expect((await rawItem(saved, 'Other file')).A).toBe('<</S /GoToR /F (other.pdf) /D [0 /Fit]>>');
    expect((await rawItem(saved, 'Script')).A).toContain('/JavaScript');
    // The closed parent stays closed and counts its two children.
    expect((await rawItem(saved, 'Red bold, closed')).Count).toBe('-2');
    expect(await engineView(saved)).toEqual([
      'Last → 2',
      'Named destination → 1',
      'Web link → -1',
      'Other file → -1',
      'Red bold, closed → 0',
      '  Child of closed → 1',
      '  Script → -1',
    ]);
    await close(doc.id);
  });

  it('new bookmarks, delete keeping children, delete only children, delete', async () => {
    const file = outlinedPdf();
    const doc = await open(file);
    const n0 = countItems(await read(file));
    await edit(doc.id, {
      kind: 'insert',
      parent: [0],
      index: 0,
      items: [
        { title: 'New child', dest: { page: 7, fit: 'xyz', left: 36, top: 600, zoom: 1.25 } },
      ],
    });
    await edit(doc.id, { kind: 'remove', path: [1], mode: 'keepChildren' }, [
      { path: [1], title: 'Part 2' },
    ]);
    // Part 3 is now at 10 (Part 2's nine sections took its place).
    await edit(doc.id, { kind: 'remove', path: [10], mode: 'onlyChildren' }, [
      { path: [10], title: 'Part 3' },
    ]);
    await edit(doc.id, { kind: 'remove', path: [11], mode: 'all' }, [
      { path: [11], title: 'Part 4' },
    ]);
    const { saved, mode } = await save(doc.id, file);
    expect(mode).toBe('narrow');
    expect(qpdfOk(saved)).toBe(true);
    const items = await read(saved);
    // +1 new, −1 Part 2, −99 under Part 3 (9 sections of 10), −100 Part 4 and all in it.
    expect(countItems(items)).toBe(n0 + 1 - 1 - 99 - 100);
    expect(items.map((b) => b.title).slice(0, 3)).toEqual(['Part 1', 'Section 2.1', 'Section 2.2']);
    expect(items[0]?.children[0]?.target).toEqual({
      type: 'destination',
      destination: {
        pageIndex: 7,
        zoom: { mode: PdfZoomMode.XYZ, params: { x: 36, y: 600, zoom: 1.25 } },
        view: [],
      },
    });
    expect(items.at(-1)?.title).toBe('Part 5');
    expect(items[10]).toMatchObject({ title: 'Part 3', children: [] });
    expect((await rawItem(saved, 'Part 3')).Count).toBeUndefined();
    expect((await engineView(saved)).length).toBe(countItems(items));
    await close(doc.id);
  });

  it('colour, style and destination from Properties; a URI replaced by a destination', async () => {
    const file = richOutlinePdf();
    const doc = await open(file);
    await edit(doc.id, {
      kind: 'update',
      path: [1],
      props: {
        color: [0, 0.5, 0],
        bold: true,
        italic: true,
        dest: { page: 2, fit: 'fitH', top: 400 },
      },
    });
    await edit(doc.id, { kind: 'update', path: [5], props: { color: null, italic: false } });
    const { saved } = await save(doc.id, file);
    const web = await rawItem(saved, 'Web link');
    expect(web.A).toBeUndefined();
    expect(web.C).toBe('[0 0.5 0]');
    expect(web.F).toBe('3');
    expect(web.Dest).toMatch(/^\[7 0 R \/FitH 400\]$/);
    const last = await rawItem(saved, 'Last');
    expect(last.C).toBeUndefined();
    expect(last.F).toBeUndefined();
    expect((await engineView(saved))[1]).toBe('Web link → 2');
    await close(doc.id);
  });

  it('copy and paste keep every key; the open state too', async () => {
    const file = richOutlinePdf();
    const doc = await open(file);
    const clip = await copyItems(
      await liveReader(doc.id),
      [[4]],
      [{ path: [4], title: 'Red bold, closed' }],
    );
    // Through the worker boundary (structured clone) and back.
    const items = structuredClone(clip);
    await edit(doc.id, {
      kind: 'insert',
      parent: [],
      index: 6,
      items: items.map((c) => ({ clip: c })),
    });
    const { saved } = await save(doc.id, file);
    expect(qpdfOk(saved)).toBe(true);
    const out = await read(saved);
    expect(flat(out).slice(-2)).toEqual(['Red bold, closed', '  Child of closed']);
    const copy = out[6];
    expect(copy).toMatchObject({ color: [1, 0, 0], bold: true, open: false });
    expect(copy?.target).toEqual(out[4]?.target);
    await close(doc.id);
  });

  it('the first bookmark of a document without an outline: the catalog gains a root', async () => {
    const file = simplePdf(2);
    const doc = await open(file);
    const { written } = await edit(doc.id, {
      kind: 'insert',
      parent: [],
      index: 0,
      items: [{ title: 'First', dest: { page: 1, fit: 'fit' } }],
    });
    expect(written).toBe(3); // the item, the root, the catalog
    const { saved, tail } = await save(doc.id, file);
    expect(tail.length).toBeLessThan(1000);
    expect(qpdfOk(saved)).toBe(true);
    expect(await engineView(saved)).toEqual(['First → 1']);
    await close(doc.id);
  });

  it('delete all: the saved file has none (the root is written)', async () => {
    const file = annotatedOutline();
    const doc = await open(file);
    await edit(doc.id, { kind: 'remove', path: [1], mode: 'all' });
    await edit(doc.id, { kind: 'remove', path: [0], mode: 'all' });
    const { saved } = await save(doc.id, file);
    expect(qpdfOk(saved)).toBe(true);
    expect(await read(saved)).toEqual([]);
    expect(await engineView(saved)).toEqual([]);
    await close(doc.id);
  });

  it('refuses a stale edit and an impossible one; nothing is written', async () => {
    const file = richOutlinePdf();
    const doc = await open(file);
    const reader = await liveReader(doc.id);
    await expect(
      editObjects(reader, { kind: 'remove', path: [0], mode: 'all' }, [
        { path: [0], title: 'Web link' },
      ]),
    ).rejects.toMatchObject({ code: 'bookmark-stale' });
    await expect(
      editObjects(reader, { kind: 'move', path: [4], parent: [4, 0], index: 0 }, []),
    ).rejects.toMatchObject({ code: 'bookmark-invalid' });
    await expect(
      editObjects(
        reader,
        { kind: 'update', path: [0], props: { dest: { page: 9, fit: 'fit' } } },
        [],
      ),
    ).rejects.toMatchObject({ code: 'bookmark-invalid' });
    expect((await tracker.save(doc.id)).tail.length).toBe(0);
    await close(doc.id);
  });

  it('undo is the snapshot: the outline comes back as it was', async () => {
    const file = richOutlinePdf();
    const doc = await open(file);
    const { token } = await tracker.takeSnapshot(doc.id);
    await edit(doc.id, { kind: 'remove', path: [4], mode: 'all' });
    expect(flat(await readOutline(await liveReader(doc.id)))).not.toContain('Red bold, closed');
    await tracker.restore(doc.id, token);
    expect(flat(await readOutline(await liveReader(doc.id)))).toContain('Red bold, closed');
    await close(doc.id);
  });
});

/** One page and an outline of two items (titles as PDF strings). */
function annotatedOutline(titles = ['(One)', '(Two)']): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 36 Tf 72 740 Td (Page 1) Tj ET' },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Outlines /First 7 0 R /Last ${String(6 + titles.length)} 0 R /Count ${String(titles.length)} >>`,
    ...titles.map(
      (t, i) =>
        `<< /Title ${t} /Parent 6 0 R${i > 0 ? ` /Prev ${String(6 + i)} 0 R` : ''}${
          i < titles.length - 1 ? ` /Next ${String(8 + i)} 0 R` : ''
        } /Dest [3 0 R /Fit] >>`,
    ),
  ]);
}

describe('encrypted documents (strings encrypted for the object)', () => {
  it.skipIf(!hasQpdf)(
    'renames and adds in an AES-256 file; reopens with the password',
    async () => {
      const file = qpdfEncrypt(richOutlinePdf(), 'user', 'owner', ['256']);
      const doc = await open(file, 'owner');
      await edit(doc.id, { kind: 'update', path: [0], props: { title: 'Benannt — 名前' } });
      await edit(doc.id, {
        kind: 'insert',
        parent: [4],
        index: 1,
        items: [{ title: 'Neu — 新', dest: { page: 2, fit: 'fit' } }],
      });
      const { saved, mode } = await save(doc.id, file);
      expect(mode).toBe('narrow');
      expect(qpdfOk(saved, 'user')).toBe(true);
      expect(flat(await read(saved, 'user'))).toEqual([
        'Benannt — 名前',
        'Web link',
        'Other file',
        'Script',
        'Red bold, closed',
        '  Child of closed',
        '  Neu — 新',
        'Last',
      ]);
      expect((await engineView(saved, 'user'))[6]).toBe('  Neu — 新 → 2');
      await close(doc.id);
    },
  );
});

describe('a 1,000-bookmark outline', () => {
  it('reads, edits and saves quickly; a rename writes one object', async () => {
    const file = bigOutlinePdf(20, 49, 20);
    const doc = await open(file);
    const t0 = performance.now();
    const items = await readOutline(await liveReader(doc.id));
    const readMs = performance.now() - t0;
    expect(countItems(items)).toBe(1000);
    const t1 = performance.now();
    const { written } = await edit(doc.id, {
      kind: 'update',
      path: [10, 20],
      props: { title: 'Renamed in a big outline' },
    });
    const editMs = performance.now() - t1;
    expect(written).toBe(1);
    const t2 = performance.now();
    await edit(doc.id, { kind: 'move', path: [19], parent: [], index: 0 });
    const moveMs = performance.now() - t2;
    const { saved, tail } = await save(doc.id, file);
    expect(qpdfOk(saved)).toBe(true);
    // The move rewrote the moved part, its neighbours and the root — not the outline.
    expect(tail.length).toBeLessThan(4000);
    const back = await read(saved);
    expect(back[0]?.title).toBe('Part 20');
    expect(back[11]?.children[20]?.title).toBe('Renamed in a big outline');
    // Generous bounds (CI machines vary); the measured values go to the log.
    console.info(
      `[outline 1000] read ${readMs.toFixed(0)} ms, rename ${editMs.toFixed(0)} ms, move ${moveMs.toFixed(0)} ms, tail ${String(tail.length)} B`,
    );
    expect(readMs).toBeLessThan(1500);
    expect(editMs).toBeLessThan(1500);
    await close(doc.id);
  });
});
