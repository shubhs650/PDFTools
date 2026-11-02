// Snapshot (M6-09, ADR-021 D-38 e, §7.1; beta review A2a): Home → View →
// Snapshot, then drag a rectangle on a page (or, from the keyboard, move and
// size a rectangle and press Enter). The Render worker renders the region as
// shown — page content, comments and form fields, at the view's rotation — at
// twice the screen's resolution; the Encoder worker makes the PNG (rule 1);
// the main thread only hands it to the system clipboard. Needs the copy
// permission (rule 9). Nothing leaves the device: the clipboard is the user's.
import type { PdfDocumentObject, Rect } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { registerCommand } from '../../app/commands/dispatch';
import { fromKeyboard } from '../../app/commands/inputSource';
import { appStore } from '../../app/store/appStore';
import { documentStore, securityOf, selectActive } from '../../app/store/documentStore';
import { t } from '../../i18n';
import { allows } from '../../model/permissions';
import { hostStore, renderEngine } from '../view/host';
import { nudgeRect, snapshotScale, startRect } from './snapshotModel';

interface SnapshotState {
  /** The keyboard rectangle (rule 12): a page and a rect in page points. */
  key: { docId: string; page: number; rect: Rect } | null;
  /** What the last snapshot did, shown briefly (and said by screen readers). */
  message: { text: string; ok: boolean; seq: number } | null;
}

export const snapshotStore = createStore<SnapshotState>()(() => ({ key: null, message: null }));

export function useSnapshot<T>(selector: (s: SnapshotState) => T): T {
  return useStore(snapshotStore, selector);
}

let messageTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

function say(text: string, ok: boolean): void {
  clearTimeout(messageTimer);
  snapshotStore.setState({ message: { text, ok, seq: ++seq } });
  messageTimer = setTimeout(() => {
    snapshotStore.setState({ message: null });
  }, 4000);
}

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

function coreDoc(
  docId: string,
): { document: PdfDocumentObject; scale: number; rotation: number } | null {
  const d = hostStore.getState().registry?.getStore().getState().core.documents[docId];
  if (!d?.document) return null;
  return { document: d.document, scale: d.scale, rotation: d.rotation };
}

export function pageSize(docId: string, page: number): { width: number; height: number } {
  const p = coreDoc(docId)?.document.pages[page];
  return { width: p?.size.width ?? 612, height: p?.size.height ?? 792 };
}

/** Why a snapshot can't be taken of the document (null: it can). */
export function snapshotBlocked(docId: string): string | null {
  const d = documentStore.getState().docs[docId];
  if (!d) return t('ribbon.needsDocument');
  return allows(securityOf(d.meta), 'copy') ? null : t('snapshot.restricted');
}

/** The region as a PNG: drawn by the Render worker, encoded by the Encoder worker. */
export async function renderSnapshot(docId: string, page: number, rect: Rect): Promise<Blob> {
  const core = coreDoc(docId);
  const p = core?.document.pages[page];
  if (!core || !p) throw new Error('The page is not loaded');
  const rotation = (p.rotation + core.rotation) % 4;
  const scale = snapshotScale(rect, core.scale, window.devicePixelRatio || 1);
  const crop = p.boxes?.crop;
  const r = renderEngine();
  const pixels = await r.rpc.call('snapshot', {
    docId,
    pageIndex: page,
    frame: { height: p.size.height, originX: crop?.left ?? 0, originY: crop?.bottom ?? 0 },
    rect,
    scale,
    rotation,
  }).promise;
  return r.encoder.call(
    'encode',
    { data: pixels.data, width: pixels.width, height: pixels.height, type: 'image/png' },
    { transfer: [pixels.data.buffer] },
  ).promise;
}

/**
 * Copies the region to the clipboard. Called in the pointer or key event
 * itself: the clipboard needs that user activation, so the PNG goes in as a
 * promise (rendered while the clipboard waits).
 */
export function copySnapshot(docId: string, page: number, rect: Rect): void {
  const blocked = snapshotBlocked(docId);
  if (blocked) {
    say(blocked, false);
    return;
  }
  const png = renderSnapshot(docId, page, rect);
  let write: Promise<void>;
  try {
    write = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch (err) {
    write = Promise.reject(err instanceof Error ? err : new Error('clipboard'));
  }
  // A failed render rejects the write too; this only keeps the rejection handled.
  png.catch(() => undefined);
  write.then(
    () => {
      say(t('snapshot.copied'), true);
    },
    (err: unknown) => {
      recordError('snapshot.copy', err);
      say(t('snapshot.failed'), false);
    },
  );
}

// ---- the keyboard rectangle ------------------------------------------------------

export function startKeyRect(docId: string, page: number): void {
  const { width, height } = pageSize(docId, page);
  snapshotStore.setState({ key: { docId, page, rect: startRect(width, height) } });
}

export function nudgeKeyRect(dx: number, dy: number, resize: boolean): void {
  const key = snapshotStore.getState().key;
  if (!key) return;
  const { width, height } = pageSize(key.docId, key.page);
  snapshotStore.setState({
    key: { ...key, rect: nudgeRect(key.rect, dx, dy, resize, width, height) },
  });
}

export function cancelKeyRect(): void {
  snapshotStore.setState({ key: null });
}

/** Copies the keyboard rectangle's region (from its Enter key event). */
export function commitKeyRect(): void {
  const key = snapshotStore.getState().key;
  if (key) copySnapshot(key.docId, key.page, key.rect);
}

// ---- the command -----------------------------------------------------------------

export function registerSnapshotCommands(): () => void {
  const off = registerCommand('home.snapshot', {
    requiresDocument: true,
    requires: 'copy',
    isPressed: () => appStore.getState().tool === 'snapshot',
    run: () => {
      const id = activeId();
      if (!id) return;
      if (appStore.getState().tool === 'snapshot') {
        cancelKeyRect();
        appStore.getState().setTool('select');
        return;
      }
      appStore.getState().setTool('snapshot');
      // From the keyboard: a rectangle in the middle of the current page (rule 12).
      if (fromKeyboard()) startKeyRect(id, documentStore.getState().docs[id]?.view.page ?? 0);
    },
  });
  // Leaving the tool drops the keyboard rectangle.
  const offTool = appStore.subscribe((s) => {
    if (s.tool !== 'snapshot' && snapshotStore.getState().key) cancelKeyRect();
  });
  return () => {
    off();
    offTool();
  };
}
