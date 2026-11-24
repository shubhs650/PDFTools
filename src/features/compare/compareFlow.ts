// Starting a comparison and changing its inputs (M12-08, D-58, ARCHITECTURE §7.16).
// A comparison is a tab of its own; the files on its sides are open documents. A file
// dropped or picked into a side opens without a tab of its own (one document: if it is
// open in a tab already, that document is used); a document nothing shows any more (no
// tab, no comparison) is closed, with the unsaved-changes prompt.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { recordError } from '../../app/diagnostics';
import { pickPdfFiles, type OpenedFile } from '../../storage/fileAccess';
import type { DocumentSource } from '../../app/store/documentStore';
import { openFiles, releaseDocuments } from '../open/openDocument';
import { pairingStore, restorePairing } from './pairingFlow';
import { carrySettings } from './presets/presetStore';
import {
  samplePath,
  type PlacedSample,
  type Sample,
  type SampleSide,
} from '../../model/compare/samples';
import {
  addFiles,
  documentsOf,
  newComparison,
  newComparisonId,
  type CompareType,
  type Comparison,
  type SideFile,
  type SideId,
} from './model';

interface CompareUiState {
  /** Files being opened into a side, by `<comparison id>:<side>`. */
  opening: Record<string, number>;
  /** The sample each comparison was filled with (M13-01), by comparison id. */
  samples: Record<string, PlacedSample>;
  /** Comparisons whose last sample could not be opened (M13-01). */
  sampleFailed: Record<string, true>;
}

export const compareUiStore = createStore<CompareUiState>()(() => ({
  opening: {},
  samples: {},
  sampleFailed: {},
}));

export function useCompareUi<T>(selector: (s: CompareUiState) => T): T {
  return useStore(compareUiStore, selector);
}

const openingKey = (id: string, side: SideId): string => `${id}:${side}`;

function countOpening(id: string, side: SideId, delta: number): void {
  compareUiStore.setState((s) => {
    const key = openingKey(id, side);
    const n = Math.max(0, (s.opening[key] ?? 0) + delta);
    const opening = Object.fromEntries(Object.entries(s.opening).filter(([k]) => k !== key));
    if (n > 0) opening[key] = n;
    return { opening };
  });
}

export const openingCount = (s: CompareUiState, id: string, side: SideId): number =>
  s.opening[openingKey(id, side)] ?? 0;

/**
 * Opens a comparison tab on its input window, after the selected tab (or at index `at`
 * of the strip), and selects it. `a`, `b`: open documents to put on the sides (Compare
 * with…, Compare these two).
 */
export function startComparison(
  type: CompareType,
  a: readonly string[] = [],
  b: readonly string[] = [],
  at?: number,
): string {
  const id = newComparisonId();
  documentStore.getState().openComparison(newComparison(id, type, a, b), at);
  return id;
}

/**
 * New comparison (M12-24, ADR-033, replacing "Change inputs"): a new
 * comparison tab, right after the selected one, on its input window with the
 * same files, page ranges, type and settings as comparison `id` (an overlay
 * also keeps its pairing table). The result stays open in its own tab. The
 * files stay one document each, shared by both comparisons. Not for an area
 * comparison, whose inputs are rectangles drawn in another comparison.
 */
export function newComparisonFrom(id: string): string | null {
  const c = documentStore.getState().comparisons[id];
  if (!c || c.area) return null;
  const next = newComparisonId();
  carrySettings(c, next);
  const p = pairingStore.getState().byId[id];
  if (c.type === 'overlay' && p?.status === 'done') restorePairing(next, p.rows);
  const copy = (files: readonly SideFile[]): SideFile[] => files.map((f) => ({ ...f }));
  documentStore
    .getState()
    .openComparison({ id: next, type: c.type, stage: 'input', a: copy(c.a), b: copy(c.b) });
  return next;
}

/**
 * Changes a comparison's inputs; the documents it no longer uses close when nothing
 * else shows them.
 */
export function updateInputs(id: string, fn: (c: Comparison) => Comparison): void {
  const before = documentStore.getState().comparisons[id];
  if (!before) return;
  documentStore.getState().updateComparison(id, fn);
  const after = documentStore.getState().comparisons[id];
  const kept = new Set(after ? documentsOf(after) : []);
  releaseDocuments(documentsOf(before).filter((d) => !kept.has(d)));
}

/**
 * Opens dropped or picked files into a side (with the password prompt for an encrypted
 * file, as for a tab). A text comparison takes the first file only.
 */
export async function addFilesTo(
  id: string,
  side: SideId,
  files: readonly OpenedFile[],
  source: DocumentSource,
): Promise<void> {
  const c = documentStore.getState().comparisons[id];
  if (!c || files.length === 0) return;
  const wanted = c.type === 'text' ? files.slice(0, 1) : files;
  countOpening(id, side, wanted.length);
  let ids: string[] = [];
  try {
    ids = (await openFiles(wanted, source, { tab: false })).filter(
      (d): d is string => d !== undefined,
    );
  } finally {
    countOpening(id, side, -wanted.length);
  }
  if (!documentStore.getState().comparisons[id]) {
    releaseDocuments(ids); // the comparison was closed meanwhile
    return;
  }
  updateInputs(id, (cur) => addFiles(cur, side, ids));
}

/** An open tab's document on a side (it stays one document with its tab, D-58). */
export function addOpenDocument(id: string, side: SideId, docId: string): void {
  updateInputs(id, (c) => addFiles(c, side, [docId]));
}

/** Choose file… on a side: the open dialog, several files for an overlay side. */
export async function pickFilesFor(id: string, side: SideId): Promise<void> {
  const files = await pickPdfFiles(window);
  await addFilesTo(id, side, files, 'picked');
}

/** What a sample's file is called in the app (translated by the caller). */
export type SampleFileName = (sample: Sample, side: SampleSide) => string;

const without = <T>(rec: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

/**
 * Try a sample (M13-01, D-67): fetches the sample's two files from our own
 * origin (the service worker has them once the background precache ran, so
 * this works offline), opens them without tabs and puts them on the sides in
 * place of what was there. They have no file handle: Save review saves them
 * with Save As. Resolves false when a file could not be opened.
 */
export async function loadSample(
  id: string,
  sample: Sample,
  fileName: SampleFileName,
): Promise<boolean> {
  if (!documentStore.getState().comparisons[id]) return false;
  compareUiStore.setState((s) => ({ sampleFailed: without(s.sampleFailed, id) }));
  const sides = ['a', 'b'] as const;
  for (const side of sides) countOpening(id, side, 1);
  let ids: (string | undefined)[] = [];
  try {
    const files = await Promise.all(
      sides.map(async (side) => {
        const res = await fetch(`${import.meta.env.BASE_URL}${samplePath(sample, side)}`);
        if (!res.ok) throw new Error(`sample ${String(res.status)}`);
        const blob = await res.blob();
        return { file: new File([blob], fileName(sample, side), { type: 'application/pdf' }) };
      }),
    );
    ids = await openFiles(files, 'sample', { tab: false });
  } catch (err) {
    recordError('compare.sample', err);
  } finally {
    for (const side of sides) countOpening(id, side, -1);
  }
  const [a, b] = ids;
  if (!documentStore.getState().comparisons[id] || !a || !b) {
    releaseDocuments(ids.filter((d): d is string => d !== undefined));
    if (documentStore.getState().comparisons[id])
      compareUiStore.setState((s) => ({ sampleFailed: { ...s.sampleFailed, [id]: true } }));
    return false;
  }
  updateInputs(id, (cur) => ({
    ...cur,
    a: [{ docId: a, range: '' }],
    b: [{ docId: b, range: '' }],
  }));
  compareUiStore.setState((s) => ({
    samples: { ...s.samples, [id]: { sample: sample.id, a, b } },
  }));
  return true;
}

/**
 * Try comparing two revisions (M13-01·O5, D-67): from the start screen, a new
 * comparison tab of the sample's type with the sample filled in on its input
 * window; the person presses Compare as usual. Resolves the comparison's id.
 */
export async function trySample(sample: Sample, fileName: SampleFileName): Promise<string> {
  const id = startComparison(sample.type);
  await loadSample(id, sample, fileName);
  return id;
}
