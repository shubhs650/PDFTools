// Differences of an overlay comparison as they come (M12-14, D-61): each
// sheet's differences are asked for as soon as its detection ends, and every
// detected sheet's again when a setting changes (sensitivity, minimum size,
// ignore zones): the Compare worker applies them to the counts it keeps, so
// nothing is drawn again (Q22, rule 1). An answer for settings changed since
// is dropped.
import { isAbortError } from '../../../engine/errors';
import { recordError } from '../../../app/diagnostics';
import type { CompareSession } from '../engine/session';
import { diffStore, diffView, mmToPt, settingsKey, updateDiff, zonesOf } from './diffState';

/** Starts following a session's detection; returns the stop. */
export function watchDifferences(id: string, session: CompareSession): () => void {
  let live = true;
  const detected = new Set<number>();
  const ask = (sheets: number[]): void => {
    if (!sheets.length) return;
    const v = diffView(id);
    const key = settingsKey(v);
    session
      .differences(
        sheets.map((sheet) => ({ sheet, zones: zonesOf(v, sheet) })),
        { sensitivity: v.sensitivity, minSize: mmToPt(v.minSize) },
      )
      .then(
        (res) => {
          if (!live || settingsKey(diffView(id)) !== key || res.length === 0) return;
          updateDiff(id, (cur) => {
            const results = { ...cur.results };
            for (const r of res) results[r.sheet] = r.diff;
            return { ...cur, results };
          });
        },
        (err: unknown) => {
          if (!isAbortError(err)) recordError('compare.differences', err);
        },
      );
  };
  const offSheets = session.watchSheets((sheet) => {
    detected.add(sheet);
    ask([sheet]);
  });
  let key = settingsKey(diffView(id));
  const offStore = diffStore.subscribe((s) => {
    const v = s.byId[id];
    if (!v) return;
    const next = settingsKey(v);
    if (next === key) return;
    key = next;
    ask([...detected]);
  });
  return () => {
    live = false;
    offSheets();
    offStore();
  };
}
