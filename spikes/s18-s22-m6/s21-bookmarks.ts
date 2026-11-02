// S21 — Bookmark editing (ADR-021 D-38 g). EmbedPDF 2.15.1's setBookmarks on our
// Render-worker executor: what an edit writes, whether Ctrl+S can keep it in a
// narrow tail, what a get → set round trip keeps (destinations, actions,
// colour / style, open state), what happens to actions it cannot write, timing.
import { performance } from 'node:perf_hooks';
import { PdfActionType, PdfZoomMode, type PdfBookmarkObject } from '@embedpdf/models';
import { buildPdf, outlinedPdf, type PdfObject } from '../../e2e/fixtures/generate.ts';
import {
  PdfName,
  PdfRef,
  PdfString,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import { PdfReader } from '../../src/model/pdf/reader.ts';
import {
  bookmarksOf,
  closeDoc,
  ctrlS,
  exec,
  ms,
  must,
  native,
  openDoc,
  openPlain,
  qpdfCheck,
  qpdfJson,
  tracker,
} from './harness.ts';

/** Two pages; outline: named dest, URI, GoToR, JavaScript, coloured bold, a closed parent. */
function richOutline(): Uint8Array {
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /Names << /Dests 14 0 R >> /PageMode /UseOutlines >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 15 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 36 Tf 72 740 Td (Page 1) Tj ET' },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 15 0 R >> >> /Contents 6 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 36 Tf 72 740 Td (Page 2) Tj ET' },
    // 7 outline root; 8..13 items
    '<< /Type /Outlines /First 8 0 R /Last 13 0 R /Count 5 >>',
    '<< /Title (Named destination) /Parent 7 0 R /Next 9 0 R /Dest (chap2) >>',
    '<< /Title (Web link) /Parent 7 0 R /Prev 8 0 R /Next 10 0 R /A << /S /URI /URI (https://example.com/) >> >>',
    '<< /Title (Other file) /Parent 7 0 R /Prev 9 0 R /Next 11 0 R /A << /S /GoToR /F (other.pdf) /D [0 /Fit] >> >>',
    '<< /Title (Script) /Parent 7 0 R /Prev 10 0 R /Next 13 0 R /A << /S /JavaScript /JS (app.alert\\(1\\)) >> >>',
    '<< /Title (Child of closed) /Parent 13 0 R /Dest [5 0 R /XYZ 72 700 1.5] >>',
    '<< /Title (Red bold, closed) /Parent 7 0 R /Prev 11 0 R /First 12 0 R /Last 12 0 R /Count -1 /C [1 0 0] /F 2 /Dest [3 0 R /FitH 500] >>',
    '<< /Names [(chap2) [5 0 R /Fit]] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return buildPdf(objs);
}

/** Spike only: put object numbers in the tracker's dirty set (what a reclassified setBookmarks would record). */
function markDirty(docId: string, nums: number[]): void {
  const st = (
    tracker as unknown as { docs: Map<string, { dirty: Map<number, number>; seq: number }> }
  ).docs.get(docId);
  if (!st) throw new Error('not tracked');
  st.seq++;
  for (const n of nums) st.dirty.set(n, st.seq);
}

/** The catalog's /Outlines object number (the fixtures write it in object 1). */
function catalogOutlinesNum(bytes: Uint8Array): number {
  const m = /\/Outlines (\d+) 0 R/.exec(new TextDecoder('latin1').decode(bytes));
  return m ? Number(m[1]) : 0;
}

const getTree = bookmarksOf;

const count = (list: PdfBookmarkObject[]): number =>
  list.reduce((n, b) => n + 1 + count(b.children ?? []), 0);

/** Compact view: title → target kind (+ page). */
function flat(list: PdfBookmarkObject[], depth = 0): string[] {
  const out: string[] = [];
  for (const b of list) {
    const t = b.target;
    let what = 'none';
    if (t?.type === 'destination')
      what = `dest p${String(t.destination.pageIndex)} ${PdfZoomMode[t.destination.zoom.mode]}`;
    else if (t?.type === 'action') {
      const a = t.action;
      what = `action ${PdfActionType[a.type]}${a.type === PdfActionType.URI ? ` ${a.uri}` : ''}${'destination' in a ? ` p${String(a.destination.pageIndex)}` : ''}`;
    }
    out.push(`${'  '.repeat(depth)}${b.title} → ${what}`);
    out.push(...flat(b.children ?? [], depth + 1));
  }

  return out;
}

/** Reachable outline items as qpdf sees them (from the catalog), without the tree links. */
function rawItems(bytes: Uint8Array): Record<string, unknown>[] {
  const j = qpdfJson(bytes);
  const objs = j.qpdf[1];
  const get = (ref: unknown) =>
    typeof ref === 'string'
      ? ((objs[`obj:${ref}`]?.value ?? undefined) as Record<string, unknown> | undefined)
      : undefined;
  const trailer = (objs.trailer?.value ?? {}) as Record<string, unknown>;
  const root = get(get(trailer['/Root'])?.['/Outlines']);
  const out: Record<string, unknown>[] = [];
  if (!root) return out;
  out.push({
    outlineRoot: Object.fromEntries(
      Object.entries(root).filter(([k]) => k !== '/First' && k !== '/Last'),
    ),
  });
  const walk = (ref: unknown) => {
    let cur = ref;
    while (typeof cur === 'string') {
      const d = get(cur);
      if (!d) break;
      const keep: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(d))
        if (!['/Parent', '/Prev', '/Next', '/First', '/Last'].includes(k)) keep[k] = x;
      out.push(keep);
      walk(d['/First']);
      cur = d['/Next'];
    }
  };
  walk(root['/First']);

  return out;
}

const reopen = async (bytes: Uint8Array): Promise<PdfBookmarkObject[]> => {
  const r = await openPlain(bytes);
  if ('error' in r) throw new Error(`reopen failed ${String(r.error)}`);
  const tree = await getTree(r.doc);
  await native.closeDocument(r.doc).toPromise();
  return tree;
};

const tailText = (bytes: Uint8Array, from: number, n = 600) =>
  new TextDecoder('latin1').decode(bytes.subarray(from, from + n)).replace(/\s+/g, ' ');

export async function run(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // 1. Round trip of a rich outline: get → set the same tree → save → reopen.
  {
    const src = richOutline();
    const doc = await openDoc(src);
    const before = await getTree(doc);
    let setResult: unknown;
    try {
      setResult = await exec('setBookmarks', doc, before);
    } catch (e) {
      setResult = `threw: ${(e as Error).message}`;
    }
    const after = await getTree(doc);
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    out.richRoundTrip = {
      before: flat(before),
      setResult,
      inMemoryAfterSet: flat(after),
      save: { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes },
      reopened: flat(await reopen(saved.bytes)),
      rawBefore: rawItems(src),
      rawAfter: rawItems(saved.bytes),
      qpdfCheck: qpdfCheck(saved.bytes),
    };
  }

  // 2. Only targets it can write: the rich tree minus the GoToR / JavaScript items.
  {
    const src = richOutline();
    const doc = await openDoc(src);
    const before = (await getTree(doc)).filter(
      (b) => !(b.target?.type === 'action' && b.target.action.type === PdfActionType.Unsupported),
    );
    const setResult = await exec('setBookmarks', doc, before).catch(
      (e: unknown) => `threw: ${(e as Error).message}`,
    );
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    out.supportedOnly = {
      setResult,
      reopened: flat(await reopen(saved.bytes)),
      rawAfter: rawItems(saved.bytes),
    };
  }

  // 3. The edit set on the 500-item outline; as tracked today (keep-all) vs narrow
  //    (catalog + outline root marked dirty, what a reclassified setBookmarks records).
  {
    const src = outlinedPdf();
    const edits = (tree: PdfBookmarkObject[]): PdfBookmarkObject[] => {
      const t = structuredClone(tree);
      const p1 = t[0];
      const p2 = t[1];
      if (!p1 || !p2) throw new Error('fixture');
      p1.title = 'Teil 1 — Übersicht (renamed) 第一部';
      // New child with a destination "from the current view" (XYZ left/top/zoom).
      (p1.children ??= []).unshift({
        title: 'New bookmark',
        target: {
          type: 'destination',
          destination: {
            pageIndex: 7,
            zoom: { mode: PdfZoomMode.XYZ, params: { x: 36, y: 600, zoom: 1.25 } },
            view: [],
          },
        },
      });
      // Delete but keep children: Part 2's sections move up to the top level.
      t.splice(1, 1, ...(p2.children ?? []));
      // Delete Part 3 with its children; reorder: Part 5 first.
      t.splice(
        t.findIndex((b) => b.title === 'Part 3'),
        1,
      );
      const [p5] = t.splice(
        t.findIndex((b) => b.title === 'Part 5'),
        1,
      );
      if (p5) t.unshift(p5);
      t.push({
        title: 'Spec online',
        target: {
          type: 'action',
          action: { type: PdfActionType.URI, uri: 'https://example.com/spec' },
        },
      });
      return t;
    };

    const variants: Record<string, unknown> = {};
    for (const how of ['tracked-as-today', 'narrow-marked']) {
      const doc = await openDoc(src);
      const tree = await getTree(doc);
      const want = edits(tree);
      const t0 = performance.now();
      if (how === 'narrow-marked') {
        tracker.checkAllowed('setBookmarks', doc.id);
        await native.setBookmarks(doc, want).toPromise();
        markDirty(doc.id, [1, catalogOutlinesNum(src)]);
      } else {
        await exec('setBookmarks', doc, want);
      }
      const setMs = ms(t0);
      const saved = await ctrlS(doc, src);
      await closeDoc(doc);
      const got = await reopen(saved.bytes);
      const raw = rawItems(saved.bytes);
      variants[how] = {
        setMs,
        items: { before: count(tree), wanted: count(want), reopened: count(got) },
        sameAsWanted: JSON.stringify(flat(got)) === JSON.stringify(flat(want)),
        save: {
          mode: saved.mode,
          fellBack: saved.fellBack,
          tailBytes: saved.tailBytes,
          ms: saved.ms,
        },
        qpdfCheck: qpdfCheck(saved.bytes),
        top: flat(got)
          .filter((l) => !l.startsWith(' '))
          .slice(0, 4),
        outlineRoot: raw[0],
        newChildRaw: raw.find((r) => r['/Title'] === 'u:New bookmark'),
        aParentRaw: raw.find((r) => r['/Title'] === 'u:Part 5'),
      };
    }
    out.edits500 = { fileBytes: src.length, ...variants };
  }

  // 4. A document without an outline: the first bookmark (the catalog gains /Outlines).
  {
    const src = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
    ]);
    const doc = await openDoc(src);
    tracker.checkAllowed('setBookmarks', doc.id);
    await native
      .setBookmarks(doc, [
        {
          title: 'First',
          target: {
            type: 'destination',
            destination: { pageIndex: 0, zoom: { mode: PdfZoomMode.FitPage }, view: [] },
          },
        },
      ])
      .toPromise();
    markDirty(doc.id, [1]);
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    out.firstBookmark = {
      save: { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes },
      reopened: flat(await reopen(saved.bytes)),
      tail: tailText(saved.bytes, src.length),
      qpdfCheck: qpdfCheck(saved.bytes),
    };
  }

  // 5. Delete all bookmarks (empty list): as tracked today, narrow with nothing
  //    marked, narrow with the catalog + outline root marked.
  {
    const src = outlinedPdf();
    const rows: Record<string, unknown> = {};
    for (const how of ['tracked-as-today', 'narrow-unmarked', 'narrow-marked']) {
      const doc = await openDoc(src);
      if (how === 'tracked-as-today') await exec('setBookmarks', doc, []);
      else {
        tracker.checkAllowed('setBookmarks', doc.id);
        await native.setBookmarks(doc, []).toPromise();
        if (how === 'narrow-marked') markDirty(doc.id, [1, catalogOutlinesNum(src)]);
      }
      const inMemory = count(await getTree(doc));
      const saved = await ctrlS(doc, src);
      await closeDoc(doc);
      rows[how] = {
        inMemory,
        save: { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes },
        reopenedCount: count(await reopen(saved.bytes)),
        tail: tailText(saved.bytes, src.length, 300),
        qpdfCheck: qpdfCheck(saved.bytes),
      };
    }
    out.deleteAll = rows;
  }

  // 6. Undo by setting the previous tree again (the app's undo step).
  {
    const src = outlinedPdf();
    const doc = await openDoc(src);
    const tree = await getTree(doc);
    await exec('setBookmarks', doc, tree.slice(1));
    const t0 = performance.now();
    await exec('setBookmarks', doc, tree);
    const undoMs = ms(t0);
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    const back = await reopen(saved.bytes);
    out.undo = {
      undoMs,
      sameAsOriginal: JSON.stringify(flat(back)) === JSON.stringify(flat(tree)),
      save: { mode: saved.mode, tailBytes: saved.tailBytes },
    };
  }

  // 7. The alternative: write the outline with our object layer (every key of
  //    every item kept), applied with the Render worker's applyObjects route
  //    (ADR-016 / ADR-018) and saved by the semantic Ctrl+S.
  {
    const src = richOutline();
    const doc = await openDoc(src);
    const reader = await PdfReader.open(src);
    const catalogRef = reader.trailer.get('Root') as PdfRef;
    const catalog = (await reader.get(catalogRef)) as PdfDict;
    const root = (await reader.get(catalog.get('Outlines') as PdfRef)) as PdfDict;
    interface Node {
      dict: PdfDict;
      kids: Node[];
    }
    const readList = async (first: PdfValue | undefined): Promise<Node[]> => {
      const out: Node[] = [];
      let cur = first;
      while (cur instanceof PdfRef) {
        const d = (await reader.get(cur)) as PdfDict;
        out.push({ dict: d, kids: await readList(d.get('First')) });
        cur = d.get('Next');
      }
      return out;
    };
    const tree = await readList(root.get('First'));
    // The edit: rename item 1 (Unicode), move the last item first, add a new child to it.
    const first = tree[0];
    if (first) first.dict.set('Title', PdfString.of('Benannte Zielmarke — 名前'));
    const last = tree.pop();
    if (last) {
      tree.unshift(last);
      last.kids.push({
        dict: new Map<string, PdfValue>([
          ['Title', PdfString.of('New child')],
          ['Dest', [new PdfRef(3, 0), new PdfName('XYZ'), 36, 600, 1.25]],
        ]),
        kids: [],
      });
    }
    const t0 = performance.now();
    let next = reader.maxObjNum() + 1;
    const firstNew = next;
    const spans: { num: number; gen: number; bytes: Uint8Array }[] = [];
    const rootNum = next++;
    const write = (list: Node[], parent: number): { first: number; last: number; open: number } => {
      const nums = list.map(() => next++);
      let open = 0;
      list.forEach((n, i) => {
        const d = new Map(n.dict);
        for (const k of ['Parent', 'Prev', 'Next', 'First', 'Last', 'Count']) d.delete(k);
        d.set('Parent', new PdfRef(parent, 0));
        if (i > 0) d.set('Prev', new PdfRef(must(nums[i - 1]), 0));
        if (i < list.length - 1) d.set('Next', new PdfRef(must(nums[i + 1]), 0));
        if (n.kids.length) {
          const k = write(n.kids, must(nums[i]));
          d.set('First', new PdfRef(k.first, 0));
          d.set('Last', new PdfRef(k.last, 0));
          // Keep the item's open / closed state (sign of the old /Count).
          const was = n.dict.get('Count');
          const closed = typeof was === 'number' && was < 0;
          d.set('Count', closed ? -k.open : k.open);
          if (!closed) open += k.open;
        }
        spans.push({ num: must(nums[i]), gen: 0, bytes: serializeIndirect(must(nums[i]), 0, d) });
      });
      return { first: must(nums[0]), last: must(nums.at(-1)), open: open + list.length };
    };
    const top = write(tree, rootNum);
    spans.push({
      num: rootNum,
      gen: 0,
      bytes: serializeIndirect(
        rootNum,
        0,
        new Map<string, PdfValue>([
          ['Type', new PdfName('Outlines')],
          ['First', new PdfRef(top.first, 0)],
          ['Last', new PdfRef(top.last, 0)],
          ['Count', top.open],
        ]),
      ),
    });
    const cat = new Map(catalog);
    cat.set('Outlines', new PdfRef(rootNum, 0));
    spans.push({ num: catalogRef.num, gen: 0, bytes: serializeIndirect(catalogRef.num, 0, cat) });
    const buildMs = ms(t0);
    const t1 = performance.now();
    const reopened = await tracker.applyObjects(doc.id, spans, firstNew, 'modify');
    const applyMs = ms(t1);
    const inMemory = flat(await getTree(reopened));
    const saved = await ctrlS(reopened, src);
    await closeDoc(reopened);
    out.objectLayerOutline = {
      buildMs,
      applyMs,
      inMemory,
      save: { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes },
      reopened: flat(await reopen(saved.bytes)),
      rawAfter: rawItems(saved.bytes),
      qpdfCheck: qpdfCheck(saved.bytes),
    };
  }
  return out;
}
