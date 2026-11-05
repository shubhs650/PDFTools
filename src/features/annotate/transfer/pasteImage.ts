// Paste an image onto the page (M7-08, ADR-023 D-45, §7.1, §7.3): an image on
// the system clipboard becomes an Image Stamp (M3-14's path: a standard
// /Stamp with an image appearance written by PDFium in the Render worker),
// scaled down to fit inside the page and selected; one undo step; the
// annotate permission is needed (rule 9).
//
// Ctrl+V reads the browser's `paste` event (no permission prompt): the key
// itself is left to the browser (keymap `browserEvent`). The menu's Paste
// reads `navigator.clipboard.read()` on the click, which the browser may ask
// the user to allow. The newest copy wins between our comment clipboard
// (ADR-018) and the image (clipboardClock). Nothing leaves the device (rule 4):
// PNG and JPEG go to PDFium as they are, other formats are turned into PNG in
// the Encoder worker; the main thread reads only the file's header (rule 1).
import { getImageMetadata } from '@embedpdf/models';
import { recordError } from '../../../app/diagnostics';
import type { CommandArgs, PagePoint } from '../../../app/commands/dispatch';
import { commandState, runCommand } from '../../../app/commands/dispatch';
import { inDocumentScope, isEditable } from '../../../app/keys/useShortcuts';
import { shortcutText } from '../../../app/keys/labels';
import { documentStore } from '../../../app/store/documentStore';
import { msg, t, type MessageKey } from '../../../i18n';
import { fitToPage, IMAGE_STAMP_MAX_BYTES } from '../../../model/stamp';
import { transferBlocked } from '../../pages/pageOps';
import { showStatusToast } from '../../snapshot/snapshot';
import { placeImage } from '../../stamps/stampTools';
import { renderEngine } from '../../view/host';
import { annotationCapability } from '../selection';
import { pageSizeOf, pasteTargetPage, visiblePageMiddle } from '../../view/pagePoint';
import {
  clipIsNewest,
  noteOutsideCopy,
  noteSeen,
  outsideAt,
  pasteChoice,
  seenAt,
} from './clipboardClock';
import { clipboardStore, pasteComments } from './copyPaste';

/** The first image a paste event carries (read while the event runs; null: none). */
export function imageOf(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

type Read = { image: Blob | null } | { refused: true };

/** The menu's read of the system clipboard: its first image, if any. */
async function readClipboardImage(): Promise<Read> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((ty) => ty.startsWith('image/'));
      if (type) return { image: await item.getType(type) };
    }
    return { image: null };
  } catch (err) {
    // NotAllowedError: the user (or the browser) said no; no read() at all elsewhere.
    if (!(err instanceof DOMException && err.name === 'NotAllowedError'))
      recordError('paste.read', err);
    return { refused: true };
  }
}

/** FNV-1a over a few slices: tells two clipboard images apart without reading all of one. */
async function fingerprint(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - 4096)).arrayBuffer());
  let h = 0x811c9dc5;
  for (const part of [head, tail])
    for (const byte of part) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return `${blob.type}:${String(blob.size)}:${h.toString(16)}`;
}

export type PastedImage =
  | { data: ArrayBuffer; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number }
  | { problem: MessageKey };

/** The image as PDFium takes it, with its size in pixels. */
export async function preparePastedImage(blob: Blob): Promise<PastedImage> {
  if (blob.size > IMAGE_STAMP_MAX_BYTES) return { problem: msg('paste.image.tooLarge') };
  const data = await blob.arrayBuffer();
  const meta = getImageMetadata(data);
  if (meta && (meta.mimeType === 'image/png' || meta.mimeType === 'image/jpeg'))
    return { data, mimeType: meta.mimeType, width: meta.width, height: meta.height };
  let r: { png: ArrayBuffer; width: number; height: number } | null;
  try {
    r = await renderEngine().encoder.call('toPng', { data }, { transfer: [data] }).promise;
  } catch (err) {
    recordError('paste.convert', err);
    r = null;
  }
  if (!r) return { problem: msg('paste.image.unreadable') };
  if (r.png.byteLength > IMAGE_STAMP_MAX_BYTES) return { problem: msg('paste.image.tooLarge') };
  return { data: r.png, mimeType: 'image/png', width: r.width, height: r.height };
}

const fail = (docId: string, text: string): false => {
  showStatusToast(docId, text, false);
  return false;
};

/**
 * Places `blob` on the page: at `at` (the menu's pointer), else in the middle
 * of the visible part of the page last clicked (or the current page). Selected
 * afterwards.
 */
export async function pasteImage(docId: string, blob: Blob, at?: PagePoint): Promise<boolean> {
  const blocked = transferBlocked(docId);
  if (blocked) return fail(docId, t(blocked));
  const d = documentStore.getState().docs[docId];
  if (!d) return false;
  const pointed = at?.docId === docId ? at : undefined;
  const pageIndex = pointed?.page ?? pasteTargetPage(docId, d.view.page);
  const page = pageSizeOf(docId, pageIndex);
  if (!page) return false;
  const img = await preparePastedImage(blob);
  if ('problem' in img) return fail(docId, t(img.problem));
  const size = fitToPage(img, page);
  const pos = pointed ?? visiblePageMiddle(docId, pageIndex) ?? undefined;
  const id = await placeImage(
    docId,
    pageIndex,
    { data: img.data, mimeType: img.mimeType, ...size },
    { subject: t('paste.image.subject') },
    pos,
  );
  if (!id) return false;
  annotationCapability()?.forDocument(docId).selectAnnotation(pageIndex, id);
  showStatusToast(docId, t('paste.image.done'), true);
  return true;
}

/** Why Paste (Ctrl+V, the menus) can't run now: our comments or an image both need annotate. */
export const pasteAnyBlocked = (docId: string | null): MessageKey | null =>
  docId ? transferBlocked(docId) : msg('ribbon.needsDocument');

/**
 * `edit.paste` (Ctrl+V and the menus' Paste, M7-08): the newest of our
 * comment clipboard and an image on the system clipboard.
 */
export async function paste(docId: string, args?: CommandArgs): Promise<boolean> {
  const clip = clipboardStore.getState().clip;
  const clipAt = clip?.at ?? null;
  let image: Blob | null;
  if (args?.clipboard) image = args.clipboard.image;
  else if (clipIsNewest(clipAt, outsideAt())) image = null;
  else {
    const read = await readClipboardImage();
    if ('refused' in read) {
      if (!clip) return fail(docId, t('paste.refused', { key: shortcutText('edit.paste', t) }));
      image = null;
    } else image = read.image;
  }
  const print = image ? await fingerprint(image) : null;
  const choice = pasteChoice({
    image: image !== null,
    clipAt,
    imageSeenAt: print ? seenAt(print) : null,
    outsideAt: outsideAt(),
  });
  if (print) noteSeen(print);
  if (choice === 'comments') return pasteComments(docId, 'current', args?.at);
  if (choice === 'image' && image) return pasteImage(docId, image, args?.at);
  return fail(docId, t('paste.nothing'));
}

/**
 * Ctrl+V on the document (and the clock's signals): the paste event's image,
 * if any, goes to `edit.paste`. Text fields, the text being edited and a
 * sticky note's window keep their own paste. Returns the remover.
 */
export function installPaste(): () => void {
  const onPaste = (e: ClipboardEvent): void => {
    if (e.defaultPrevented) return;
    const active = document.activeElement;
    if (isEditable(active) || (e.target instanceof Element && isEditable(e.target))) return;
    if (!inDocumentScope(active)) return;
    e.preventDefault();
    const image = imageOf(e.clipboardData);
    const state = commandState('edit.paste');
    // Refused with the reason (rule 9), when there was something to paste.
    const docId = documentStore.getState().activeId;
    if (!state.enabled && docId && (image || clipboardStore.getState().clip))
      showStatusToast(docId, t(state.reason), false);
    void runCommand('edit.paste', { clipboard: { image } });
  };
  const onBlur = (): void => {
    noteOutsideCopy();
  };
  const clipboard = navigator.clipboard as (Clipboard & EventTarget) | undefined;
  document.addEventListener('paste', onPaste);
  window.addEventListener('blur', onBlur);
  // Where the browser reports clipboard changes (Chromium's clipboardchange).
  clipboard?.addEventListener('clipboardchange', onBlur);
  return () => {
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('blur', onBlur);
    clipboard?.removeEventListener('clipboardchange', onBlur);
  };
}
