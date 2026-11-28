// Place summary (M14-10, D-76, ADR-035; plan M14 §10, Q17): one table markup
// (/FreeText) on the page with each measurement group, how many it has and
// its total, for the pane's choice (this page's measurements, or all pages').
// Triya PDF keeps it up to date: after any change to a measurement (or a
// scale) its rows are worked out again and, when they differ, the summary is
// changed in the same undo step as the edit that caused it (historyJoin.ts);
// a change outside history (a scale's follow-up, an undo's catch-up) stays
// outside it. Other viewers and prints see a normal markup whose text holds
// the same rows. The Render worker draws the table (summaryAppearance.ts);
// the page's Triya data says it is a summary (pageData.ts), so it is known
// again after a reopen. Plain work over what is in memory (rule 1).
import {
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  uuidV4,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type { PluginRegistry } from '@embedpdf/core';
import type { AnnotationCapability, AnnotationScope } from '@embedpdf/plugin-annotation';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { format, t } from '../../../i18n';
import { readItems } from '../../../model/measureData';
import { groupMeasurements } from '../../../model/measureList';
import {
  summaryFromPdf,
  summaryLayout,
  summaryOf,
  summaryRows,
  summaryText,
  type SummaryMeta,
  type SummaryScope,
  type SummaryWords,
} from '../../../model/measureSummary';
import { allows } from '../../../model/permissions';
import { isReplaying, joinStep, outsideHistory } from '../../annotate/historyJoin';
import { pageSize, showStatusToast } from '../../snapshot/snapshot';
import { goToPoint } from '../../view/controller';
import { capability, hostStore } from '../../view/host';
import { TOOL_SUBJECT, toolOf, withFileMeta } from '../measurements';
import { stagePageData } from '../pageData';
import { measureEntries } from '../pane/measureEntries';
import { loadScales, scaleStore } from '../scaleStore';

/** Ids of the summaries known in this session (made here, or read from a file's Triya data). */
const known = new Set<string>();

/** The file's summary scope of an annotation (its page's Triya data), or null. */
function fileScope(docId: string, a: PdfAnnotationObject): SummaryScope | null {
  const d = scaleStore.getState().docs[docId];
  if (!d || typeof d === 'string') return null;
  return summaryFromPdf(readItems(d.pages[a.pageIndex]?.pieceInfo ?? null).get(a.id));
}

/** Which measurements a summary adds up, or null when the annotation is not a summary. */
export function summaryScopeOf(docId: string, a: PdfAnnotationObject): SummaryScope | null {
  if (a.type !== PdfAnnotationSubtype.FREETEXT) return null;
  return summaryOf(a)?.scope ?? fileScope(docId, a);
}

/** Is this annotation a summary (the page renderer's test; no document at hand)? */
export const isSummary = (a: PdfAnnotationObject): boolean =>
  a.type === PdfAnnotationSubtype.FREETEXT && (summaryOf(a) !== null || known.has(a.id));

function words(scope: SummaryScope, page: number): SummaryWords {
  return {
    head: [
      scope === 'page'
        ? t('measureSummary.headPage', { page: format.number(page + 1, 0) })
        : t('measureSummary.headAll'),
      t('measureSummary.count'),
      t('measureSummary.total'),
    ],
    tool: (g) => t(TOOL_SUBJECT[g.tool]),
    atPaper: (name) => t('measureExport.atPaper', { name }),
    leftOut: (n) => t('measureSummary.leftOut', { count: n, n: format.number(n, 0) }),
    noTotal: t('measureSummary.noTotal'),
    none: t('measureSummary.none'),
  };
}

/** The table's rows for a summary on `page` adding up `scope`'s measurements. */
export function rowsFor(
  docId: string,
  objects: readonly PdfAnnotationObject[],
  scope: SummaryScope,
  page: number,
): string[][] {
  const groups = groupMeasurements(
    measureEntries(docId, objects),
    scope === 'page' ? { page } : {},
  );
  return summaryRows(groups, words(scope, page), format);
}

/** The patch that brings a summary up to date, or null when it already is. */
function patchFor(
  docId: string,
  a: PdfAnnotationObject,
  objects: readonly PdfAnnotationObject[],
): Partial<PdfAnnotationObject> | null {
  const scope = summaryScopeOf(docId, a);
  if (!scope) return null;
  const rows = rowsFor(docId, objects, scope, a.pageIndex);
  const text = summaryText(rows);
  if (a.contents === text) return null;
  const size = summaryLayout(rows);
  const summary: SummaryMeta = { scope, rows };
  return {
    contents: text,
    rect: { origin: a.rect.origin, size: { width: size.width, height: size.height } },
    summary,
  } as Partial<PdfAnnotationObject>;
}

function scopeOf(registry: PluginRegistry, docId: string): AnnotationScope {
  return capability<AnnotationCapability>(registry, 'annotation').forDocument(docId);
}

/** The document's annotations, without those deleted but not yet committed. */
const liveObjects = (scope: AnnotationScope): PdfAnnotationObject[] =>
  Object.values(scope.getState().byUid)
    .filter((t) => t.commitState !== 'deleted')
    .map((t) => t.object);

/** Brings every summary of the document up to date: in the last undo step, or outside history. */
function reconcile(registry: PluginRegistry, docId: string, how: 'join' | 'outside'): void {
  if (!documentStore.getState().docs[docId]) return;
  const d = scaleStore.getState().docs[docId];
  if (!d || typeof d === 'string') return; // values need the scales
  const scope = scopeOf(registry, docId);
  const objects = liveObjects(scope);
  const changes = objects.flatMap((a) => {
    const p = patchFor(docId, a, objects);
    return p ? [{ a, p }] : [];
  });
  if (!changes.length) return;
  const apply = (): void => {
    for (const { a, p } of changes) scope.updateAnnotation(a.pageIndex, a.id, p);
  };
  if (how === 'join') joinStep(apply);
  else outsideHistory(apply);
  // Written to the document now: a joined part makes no history change of its own.
  scope.commit();
}

const queued = new Map<string, 'join' | 'outside'>();

/** A reconcile soon (once per document per burst of events); a join wins over outside. */
function schedule(registry: PluginRegistry, docId: string, how: 'join' | 'outside'): void {
  const was = queued.get(docId);
  if (was) {
    if (how === 'join') queued.set(docId, 'join');
    return;
  }
  queued.set(docId, how);
  queueMicrotask(() => {
    const h = queued.get(docId) ?? how;
    queued.delete(docId);
    reconcile(registry, docId, h);
  });
}

/** Why a summary can't be placed (null: it can). */
export function summaryBlocked(docId: string): string | null {
  const meta = documentStore.getState().docs[docId]?.meta;
  if (!meta) return t('ribbon.needsDocument');
  return allows(securityOf(meta), 'annotate') ? null : t('measureSummary.restricted');
}

/** Margin from the page's top right corner where a new summary goes (points). */
const MARGIN = 36;

/**
 * Place summary: on the current page, for the pane's choice of measurements.
 * A page that already has a summary keeps it: it is brought up to date,
 * shown and selected. Resolves the summary's id, or null.
 */
export async function placeSummary(docId: string, scope: SummaryScope): Promise<string | null> {
  const registry = hostStore.getState().registry;
  const blocked = summaryBlocked(docId);
  if (blocked) {
    showStatusToast(docId, blocked, false);
    return null;
  }
  if (!registry) return null;
  await loadScales(docId);
  const d = documentStore.getState().docs[docId];
  if (!d) return null;
  const page = d.view.page;
  const sc = scopeOf(registry, docId);
  const objects = liveObjects(sc);
  const existing = objects.find((a) => a.pageIndex === page && summaryScopeOf(docId, a));
  if (existing) {
    const rows = rowsFor(docId, objects, scope, page);
    const text = summaryText(rows);
    if (existing.contents !== text || summaryScopeOf(docId, existing) !== scope) {
      const size = summaryLayout(rows);
      sc.updateAnnotation(page, existing.id, {
        contents: text,
        rect: { origin: existing.rect.origin, size },
        summary: { scope, rows },
      } as Partial<PdfAnnotationObject>);
    }
    goToPoint(page, existing.rect.origin.x, existing.rect.origin.y);
    sc.selectAnnotation(page, existing.id);
    return existing.id;
  }
  const rows = rowsFor(docId, objects, scope, page);
  const size = summaryLayout(rows);
  const ps = pageSize(docId, page);
  const x = Math.max(0, ps.width - MARGIN - size.width);
  const y = Math.min(MARGIN, Math.max(0, ps.height - size.height));
  const id = uuidV4();
  known.add(id);
  const now = new Date();
  const summary: SummaryMeta = { scope, rows };
  const annot = {
    id,
    type: PdfAnnotationSubtype.FREETEXT,
    pageIndex: page,
    rect: { origin: { x, y }, size: { width: size.width, height: size.height } },
    contents: summaryText(rows),
    subject: t('measureSummary.subject'),
    fontFamily: PdfStandardFont.Helvetica,
    fontSize: 8.5,
    fontColor: '#1A1A1A',
    textAlign: PdfTextAlignment.Left,
    verticalAlign: PdfVerticalAlignment.Top,
    color: 'transparent',
    opacity: 1,
    flags: ['print'],
    created: now,
    modified: now,
    summary,
  } as unknown as PdfAnnotationObject;
  sc.createAnnotation(page, annot);
  goToPoint(page, x, y);
  sc.selectAnnotation(page, id);
  return id;
}

/** Called once the plugin registry is up (DocumentHost); returns the unsubscribe. */
export function installSummaryKeeper(registry: PluginRegistry): () => void {
  let cap: AnnotationCapability;
  try {
    cap = capability<AnnotationCapability>(registry, 'annotation');
  } catch {
    return () => undefined;
  }
  const offEvents = cap.onAnnotationEvent((e) => {
    if (e.type !== 'create' && e.type !== 'update' && e.type !== 'delete') return;
    if ('committed' in e && e.committed) return;
    const docId = e.documentId;
    const a = e.annotation;
    if (a.type === PdfAnnotationSubtype.FREETEXT && summaryScopeOf(docId, a)) {
      // A summary made, changed or removed: its page's Triya data follows.
      known.add(a.id);
      const scope = cap.forDocument(docId);
      stagePageData(docId, a.pageIndex, () =>
        scope.getAnnotations({ pageIndex: a.pageIndex }).map((ta) => ta.object),
      );
      return;
    }
    if (!toolOf(docId, withFileMeta(docId, a))) return;
    schedule(registry, docId, isReplaying() ? 'outside' : 'join');
  });
  // A scale changed (not the first read): values change, outside history (as the measurements).
  const offScales = scaleStore.subscribe((s, prev) => {
    for (const [docId, d] of Object.entries(s.docs)) {
      if (typeof d === 'string') continue;
      const p = prev.docs[docId];
      // The first read: summaries read from the file become known; none is changed.
      if (!p || typeof p === 'string') {
        for (const pg of d.pages)
          for (const [id, raw] of readItems(pg.pieceInfo ?? null))
            if (summaryFromPdf(raw)) known.add(id);
        continue;
      }
      if (p.vp !== d.vp || p.pages !== d.pages) schedule(registry, docId, 'outside');
    }
  });
  return () => {
    offEvents();
    offScales();
  };
}
