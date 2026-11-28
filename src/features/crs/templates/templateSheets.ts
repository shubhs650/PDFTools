// The pure half of Export CRS into a project template (M13-07, D-71, plan
// M13 §6): the dialog's detail values and the file-name rule (C10), how the
// rows split into sheets (C5, C15) and their names, each sheet's cells in the
// template's column order (Sr. No. per sheet, C6), the Work worker's fill
// spec, and the CSV (the same columns, no pictures).
import { format, msg, t, type MessageKey } from '../../../i18n';
import { readFileName } from '../../../model/crs/fileNameRule';
import type { CrsField, CrsTemplateSettings, DetailField } from '../../../model/crs/template';
import type { TemplateFillSpec } from '../../../workers/work/crsTemplate/fill';
import { toCsv } from '../csv';
import { groupByPage, type CellValue, type TemplateRow } from './templateRows';

/** The detail values the export dialog holds for one document (C10: always editable). */
export interface DocDetails {
  docNumber: string;
  revision: string;
  title: string;
  reviewer: string;
  reviewDate: string;
}

export interface TemplateExportOptions {
  /** "Only what the Comments pane shows" (C8). */
  scope: 'all' | 'filtered';
  /** The dialog's Ignore highlights (C12), prefilled from the template. */
  ignoreHighlights: boolean;
  snapshots: boolean;
  format: 'xlsx' | 'csv';
  /** "Include measurements" (M14-08, Q34); absent: off. */
  measurements?: boolean;
}

export const FIELD_KEYS: Record<CrsField, MessageKey> = {
  srNo: msg('crs.tpl.field.srNo'),
  commentNo: msg('crs.tpl.field.commentNo'),
  page: msg('crs.tpl.field.page'),
  pageLabel: msg('crs.tpl.field.pageLabel'),
  type: msg('crs.tpl.field.type'),
  text: msg('crs.tpl.field.text'),
  author: msg('crs.tpl.field.author'),
  discipline: msg('crs.tpl.field.discipline'),
  created: msg('crs.tpl.field.created'),
  modified: msg('crs.tpl.field.modified'),
  status: msg('crs.tpl.field.status'),
  allReplies: msg('crs.tpl.field.allReplies'),
  firstReply: msg('crs.tpl.field.firstReply'),
  lastReply: msg('crs.tpl.field.lastReply'),
  lastReplyAuthor: msg('crs.tpl.field.lastReplyAuthor'),
  snapshot: msg('crs.tpl.field.snapshot'),
  commentId: msg('crs.tpl.field.commentId'),
  fixed: msg('crs.tpl.field.fixed'),
};

export const DETAIL_KEYS: Record<DetailField, MessageKey> = {
  docName: msg('crs.tpl.detail.docName'),
  docNumber: msg('crs.tpl.detail.docNumber'),
  revision: msg('crs.tpl.detail.revision'),
  title: msg('crs.tpl.detail.title'),
  reviewer: msg('crs.tpl.detail.reviewer'),
  reviewDate: msg('crs.tpl.detail.reviewDate'),
  scheme: msg('crs.tpl.detail.scheme'),
  commentCount: msg('crs.tpl.detail.commentCount'),
  pageCount: msg('crs.tpl.detail.pageCount'),
};

const baseName = (name: string): string => name.replace(/\.pdf$/iu, '');

/**
 * C10: the number and revision the file-name rule reads from `fileName`, over
 * `fallback` (last time's or the stamps'); the dialog shows them, editable.
 */
export function prefillDetails(
  settings: Pick<CrsTemplateSettings, 'fileNameRule'>,
  fileName: string,
  fallback: DocDetails,
): DocDetails {
  const read = settings.fileNameRule ? readFileName(settings.fileNameRule, fileName) : null;
  return {
    ...fallback,
    docNumber: read?.docNo ?? fallback.docNumber,
    revision: read?.rev ?? fallback.revision,
    title: read?.title ?? fallback.title,
  };
}

/** The written columns: ticked and placed, in column order. */
export function writtenColumns(s: Pick<CrsTemplateSettings, 'columns'>) {
  return s.columns
    .filter((c): c is typeof c & { col: number } => c.on && c.col !== null)
    .sort((a, b) => a.col - b.col);
}

/** One sheet of the export: its name, details and rows. */
export interface SheetPlan {
  doc: number;
  name: string | null;
  details: Partial<Record<DetailField, CellValue>>;
  rows: TemplateRow[];
}

/**
 * Splits each document's rows into sheets (C5, C15): one per document when
 * several are picked (named by document), one per commented page when the
 * template says so (named by page label, else "Page 3"); both together are
 * named "document - page". One document on one sheet keeps the sheet's name.
 */
export function planSheets(
  docs: readonly {
    name: string;
    pageCount: number;
    details: DocDetails;
    rows: TemplateRow[];
    pageLabel(page: number): string | null;
  }[],
  settings: Pick<CrsTemplateSettings, 'sheetPerPage'>,
  scheme: string,
): SheetPlan[] {
  const several = docs.length > 1;
  const out: SheetPlan[] = [];
  docs.forEach((d, doc) => {
    const details = (rows: TemplateRow[]): SheetPlan['details'] => ({
      docName: baseName(d.name),
      docNumber: d.details.docNumber,
      revision: d.details.revision,
      title: d.details.title,
      reviewer: d.details.reviewer,
      reviewDate: d.details.reviewDate,
      scheme,
      commentCount: rows.length,
      pageCount: d.pageCount,
    });
    const groups = settings.sheetPerPage ? groupByPage(d.rows) : [];
    if (groups.length === 0) {
      out.push({
        doc,
        name: several ? baseName(d.name) : null,
        details: details(d.rows),
        rows: d.rows,
      });
      return;
    }
    for (const g of groups) {
      const page =
        d.pageLabel(g.page) ?? t('crs.tpl.pageSheet', { page: format.number(g.page + 1) });
      out.push({
        doc,
        name: several ? `${baseName(d.name)} - ${page}` : page,
        details: details(g.rows),
        rows: g.rows,
      });
    }
  });
  return out;
}

/** A sheet's cells in the written columns' order (Sr. No. restarts per sheet, C6). */
export function sheetCells(
  s: Pick<CrsTemplateSettings, 'columns'>,
  rows: readonly TemplateRow[],
): CellValue[][] {
  const cols = writtenColumns(s);
  return rows.map((r, i) =>
    cols.map((c) => {
      if (c.field === 'srNo') return i + 1;
      if (c.field === 'fixed') return c.text ?? '';
      if (c.field === 'snapshot') return null;
      return r.values[c.field] ?? null;
    }),
  );
}

const plain = (v: CellValue): string =>
  v === null ? '' : v instanceof Date ? format.date(v) : typeof v === 'number' ? String(v) : v;

/** The CSV: per sheet its detail lines, the field names and the rows (no pictures). */
export function templateCsv(
  s: Pick<CrsTemplateSettings, 'columns' | 'details'>,
  sheets: readonly SheetPlan[],
): Uint8Array<ArrayBuffer> {
  const cols = writtenColumns(s).filter((c) => c.field !== 'snapshot');
  const keep = writtenColumns(s).map((c) => c.field !== 'snapshot');
  const lines: string[][] = [];
  sheets.forEach((sheet, k) => {
    if (k > 0) lines.push([]);
    if (sheets.length > 1 && sheet.name !== null) lines.push([sheet.name]);
    for (const [field, cell] of Object.entries(s.details)) {
      if (!cell) continue;
      const f = field as DetailField;
      lines.push([t(DETAIL_KEYS[f]), plain(sheet.details[f] ?? null)]);
    }
    lines.push(
      cols.map((c) => (c.field === 'fixed' ? t(FIELD_KEYS.fixed) : t(FIELD_KEYS[c.field]))),
    );
    for (const row of sheetCells(s, sheet.rows))
      lines.push(row.filter((_, i) => keep[i]).map(plain));
  });
  return toCsv(lines);
}

/** The worker's spec for the sheets. */
export function fillSpec(tpl: CrsTemplateSettings, sheets: readonly SheetPlan[]): TemplateFillSpec {
  const cols = writtenColumns(tpl);
  return {
    sheet: tpl.sheet,
    startRow: tpl.startRow,
    lastPreDrawn: tpl.lastPreDrawn,
    columns: cols.map((c) => c.col),
    snapshotIndex: cols.findIndex((c) => c.field === 'snapshot'),
    snapshotMaxPx: tpl.snapshotMaxPx,
    sheets: sheets.map((sh) => ({
      name: sh.name,
      details: Object.entries(tpl.details).flatMap(([field, cell]) =>
        cell ? [{ cell, value: sh.details[field as DetailField] ?? null }] : [],
      ),
      rows: sheetCells(tpl, sh.rows),
    })),
  };
}
