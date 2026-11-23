// The summary page of an overlay comparison file (M12-21, D-65): its words,
// read from the comparison's stores and localized here (rule 11). The counts
// come from the pure model (model/compare/summary.ts); the page is laid out
// and drawn in the Work worker (comparisonFile/summary.ts).
import { format, t, type MessageKey, msg } from '../../../i18n';
import type { Sensitivity } from '../../../model/compare/detect/entries';
import type { SheetStatus } from '../../../model/compare/file/format';
import {
  multiplied,
  overlayFacts,
  type OverlayFacts,
  type SummaryBlock,
  type SummarySpec,
} from '../../../model/compare/summary';
import { diffView, entryId } from '../diff/diffState';
import type { Comparison } from '../model';
import { overlayView } from '../overlay/overlayState';
import { comparisonSheets } from '../overlay/vectorOverlay';
import { sheetEntry, sidesOf } from './data';
import { APP_NAME } from './words';

const SENSITIVITY: Record<Sensitivity, MessageKey> = {
  low: msg('compare.register.sensitivity_low'),
  normal: msg('compare.register.sensitivity_normal'),
  high: msg('compare.register.sensitivity_high'),
};

const PLACEMENT: Record<SheetStatus, MessageKey> = {
  asIs: msg('compare.file.summary.place_asIs'),
  aligned: msg('compare.file.summary.place_aligned'),
  manual: msg('compare.file.summary.place_manual'),
  lowConfidence: msg('compare.file.summary.place_lowConfidence'),
};

const n = (v: number): string => format.number(v, 0);

/** The settings and counts of an overlay comparison as it stands. */
export function summaryFacts(c: Comparison): OverlayFacts {
  const view = overlayView(c.id);
  const diff = diffView(c.id);
  const sheets = (comparisonSheets(c.id) ?? []).map((s) => ({
    pair: s.pair,
    a: s.a !== null,
    b: s.b !== null,
    status: sheetEntry(view, s).status,
  }));
  const checked = new Set(diff.checked);
  return overlayFacts(
    sheets,
    diff.results,
    (pair, key) => checked.has(entryId(pair, key)),
    diff.zones,
  );
}

/** The summary page's blocks for an overlay comparison saved at `when`. */
export function overlaySummary(c: Comparison, when: Date): SummarySpec {
  const f = summaryFacts(c);
  const view = overlayView(c.id);
  const diff = diffView(c.id);
  const sides = sidesOf(c);
  const files = (list: { name: string; range: string }[]): string =>
    list
      .map((d) =>
        d.range.trim()
          ? t('compare.file.summary.fileRange', { name: d.name, range: d.range.trim() })
          : d.name,
      )
      .join('\n');
  const blocks: SummaryBlock[] = [
    { kind: 'title', text: t('compare.file.summary.title') },
    { kind: 'row', label: t('compare.file.summary.docA'), value: files(sides.A) },
    { kind: 'row', label: t('compare.file.summary.docB'), value: files(sides.B) },
    { kind: 'row', label: t('compare.file.summary.saved'), value: format.dateTime(when) },
    { kind: 'row', label: t('compare.file.summary.app'), value: APP_NAME() },
  ];
  if (c.area)
    blocks.push({
      kind: 'row',
      label: t('compare.file.summary.compared'),
      value: t('compare.file.summary.areaValue'),
    });

  blocks.push({ kind: 'heading', text: t('compare.file.summary.results') });
  const sheetParts = [
    t('compare.file.summary.sheetsValue', {
      count: f.sheets,
      n: n(f.sheets),
      compared: n(f.compared),
    }),
  ];
  if (f.onlyA) sheetParts.push(t('compare.file.summary.onlyA', { n: n(f.onlyA) }));
  if (f.onlyB) sheetParts.push(t('compare.file.summary.onlyB', { n: n(f.onlyB) }));
  blocks.push({
    kind: 'row',
    label: t('compare.file.summary.sheets'),
    value: format.list(sheetParts),
  });
  const changedParts = [
    t('compare.file.summary.changedValue', { changed: n(f.changed), unchanged: n(f.unchanged) }),
  ];
  if (f.pending) changedParts.push(t('compare.file.summary.pending', { n: n(f.pending) }));
  blocks.push({
    kind: 'row',
    label: t('compare.file.summary.changedSheets'),
    value: format.list(changedParts),
  });
  blocks.push({
    kind: 'row',
    label: t('compare.file.summary.differences'),
    value:
      f.differences === 0
        ? t('compare.file.summary.none')
        : t('compare.file.summary.differencesValue', {
            total: n(f.differences),
            added: n(f.kinds.added),
            removed: n(f.kinds.removed),
            changed: n(f.kinds.changed),
          }),
  });
  if (f.differences > 0) {
    blocks.push({
      kind: 'row',
      label: t('compare.file.summary.byType'),
      value: t('compare.file.summary.byTypeValue', {
        text: n(f.types.text),
        geometry: n(f.types.geometry),
        both: n(f.types.both),
      }),
    });
    blocks.push({
      kind: 'row',
      label: t('compare.file.summary.checked'),
      value: t('compare.file.summary.checkedValue', {
        checked: n(f.checked),
        total: n(f.differences),
      }),
    });
  }
  const placement = (Object.keys(PLACEMENT) as SheetStatus[])
    .filter((k) => f.placement[k] > 0)
    .map((k) => t(PLACEMENT[k], { n: n(f.placement[k]) }));
  if (placement.length)
    blocks.push({
      kind: 'row',
      label: t('compare.file.summary.placement'),
      value: format.list(placement),
    });

  const colA = view.style.colA;
  const colB = view.style.colB;
  blocks.push(
    { kind: 'heading', text: t('compare.file.summary.legend') },
    { kind: 'swatch', colour: [...colA], text: t('compare.file.summary.legendA') },
    { kind: 'swatch', colour: [...colB], text: t('compare.file.summary.legendB') },
    {
      kind: 'swatch',
      colour: [...multiplied(colA, colB)],
      text: t('compare.file.summary.legendBoth'),
    },
  );

  const zones: string[] = [];
  if (f.zones.every) zones.push(t('compare.file.summary.zonesEvery', { n: n(f.zones.every) }));
  for (const [sheet, count] of f.zones.sheets)
    zones.push(t('compare.file.summary.zonesSheet', { sheet: n(sheet), n: n(count) }));
  blocks.push(
    { kind: 'heading', text: t('compare.file.summary.settings') },
    {
      kind: 'row',
      label: t('compare.file.summary.sensitivity'),
      value: t(SENSITIVITY[diff.sensitivity]),
    },
    {
      kind: 'row',
      label: t('compare.file.summary.minSize'),
      value:
        diff.minSize === 0
          ? t('compare.diff.minSize_off')
          : t('compare.diff.minSize_mm', { size: format.number(diff.minSize, 1) }),
    },
    {
      kind: 'row',
      label: t('compare.file.summary.zones'),
      value: zones.length ? format.list(zones) : t('compare.file.summary.none'),
    },
  );
  if (f.pending) blocks.push({ kind: 'note', text: t('compare.file.summary.partial') });
  blocks.push({ kind: 'note', text: t('compare.file.summary.footer') });
  return { blocks };
}
