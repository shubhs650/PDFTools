// Images to PDF and Insert from Image on the main thread (M11-08·O8, D-55,
// §7.8). JPG and PNG files that are opened, dropped or picked wait in the
// dialog's list; only their headers are read here (async I/O, a pure header
// parse: rule 1). On Create the files are read and handed to the Work
// worker, which builds the pages; a new document opens as an unsaved tab, and
// inserted pages go through the Render worker's import as one undo step.
import { createStore, useStore } from 'zustand';
import { documentStore, type DocumentSource } from '../../app/store/documentStore';
import { isAbortError, RpcError } from '../../engine/errors';
import { format, msg, t } from '../../i18n';
import {
  IMAGE_HEADER_BYTES,
  looksLikeImage,
  readImageInfo,
  type ImageFileInfo,
} from '../../model/imageFile';
import { IMAGES_MAX, imagesBaseName, type ImagePageSize } from '../../model/imagePages';
import type { OpenedFile } from '../../storage/fileAccess';
import { pickImageFiles } from '../../storage/fileAccess';
import { openFiles } from '../open/openDocument';
import { workClient } from '../view/host';
import { openResult } from './assemble';
import { runBusy, runPageOp, showPagesError } from './pageOps';

export interface ImageItem {
  id: string;
  name: string;
  file: File;
  info: ImageFileInfo;
  /** An object URL of the file for the dialog's thumbnail; revoked when the item goes. */
  url: string;
}

export type ImagesTarget = { mode: 'new' } | { mode: 'insert'; docId: string };

interface ImagesState {
  open: ImagesTarget | null;
  items: ImageItem[];
  /** Files left out: not a JPG or PNG we can read. */
  skipped: string[];
  /** Files left out because the list is full (IMAGES_MAX). */
  overflow: number;
}

export const imagesStore = createStore<ImagesState>()(() => ({
  open: null,
  items: [],
  skipped: [],
  overflow: 0,
}));

export function useImages<T>(selector: (s: ImagesState) => T): T {
  return useStore(imagesStore, selector);
}

let seq = 0;

/** Reads each file's header; JPG and PNG files join the list, the rest are named as left out. */
export async function addImages(files: readonly File[]): Promise<void> {
  const read = await Promise.all(
    files.map(async (file) => {
      try {
        const head = new Uint8Array(await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer());
        return { file, info: readImageInfo(head) };
      } catch {
        return { file, info: null };
      }
    }),
  );
  const s = imagesStore.getState();
  const items = [...s.items];
  const skipped = [...s.skipped];
  let overflow = s.overflow;
  for (const { file, info } of read) {
    if (!info) skipped.push(file.name);
    else if (items.length >= IMAGES_MAX) overflow++;
    else
      items.push({
        id: `img-${String(++seq)}`,
        name: file.name,
        file,
        info,
        url: URL.createObjectURL(file),
      });
  }
  imagesStore.setState({ items, skipped, overflow });
}

/** Opens the dialog for a new document or for pages inserted into `docId`, with `files` listed. */
export function openImagesDialog(target: ImagesTarget, files: readonly File[] = []): Promise<void> {
  revokeAll();
  imagesStore.setState({ open: target, items: [], skipped: [], overflow: 0 });
  return addImages(files);
}

function revokeAll(): void {
  for (const item of imagesStore.getState().items) URL.revokeObjectURL(item.url);
}

export function closeImagesDialog(): void {
  revokeAll();
  imagesStore.setState({ open: null, items: [], skipped: [], overflow: 0 });
}

export function moveImage(from: number, to: number): void {
  const list = imagesStore.getState().items;
  if (to < 0 || to >= list.length || from === to) return;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item) next.splice(to, 0, item);
  imagesStore.setState({ items: next });
}

export function removeImage(id: string): void {
  const gone = imagesStore.getState().items.find((i) => i.id === id);
  if (gone) URL.revokeObjectURL(gone.url);
  imagesStore.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
}

export function clearSkipped(): void {
  imagesStore.setState({ skipped: [], overflow: 0 });
}

/** The user picks more images for the open dialog. */
export async function pickMoreImages(): Promise<void> {
  const files = await pickImageFiles();
  if (files.length) await addImages(files);
}

/**
 * Files from File › Open or a drop: PDFs open as documents; JPG and PNG
 * files go to Images to PDF (added to its list when the dialog is open).
 */
export async function openOrConvert(
  files: readonly OpenedFile[],
  source: DocumentSource,
): Promise<void> {
  const images = files.filter((f) => looksLikeImage(f.file)).map((f) => f.file);
  const others = files.filter((f) => !looksLikeImage(f.file));
  if (images.length) {
    if (imagesStore.getState().open) await addImages(images);
    else await openImagesDialog({ mode: 'new' }, images);
  }
  if (others.length) await openFiles(others, source);
}

export interface ImagesOptions {
  size: ImagePageSize;
  margin: boolean;
}

/** The Work worker's document of the images, one per page. */
async function build(
  docId: string,
  items: readonly ImageItem[],
  options: ImagesOptions,
): Promise<ArrayBuffer> {
  return runBusy(docId, msg('images.building'), async (progress, onCancel) => {
    const images = await Promise.all(items.map((i) => i.file.arrayBuffer()));
    const job = workClient().run(
      'imagesToPdf',
      { images, size: options.size, margin: options.margin },
      { onProgress: progress, transfer: images },
    );
    onCancel(() => {
      job.cancel();
    });
    return (await job.promise).bytes;
  });
}

function showBuildError(err: unknown, items: readonly ImageItem[]): void {
  if (isAbortError(err)) return;
  const m = err instanceof RpcError ? /^images-unreadable:(\d+)$/.exec(err.code) : null;
  const name = m ? items[Number(m[1])]?.name : undefined;
  if (name !== undefined) showPagesError(msg('images.unreadable'), { name });
  else showPagesError(msg('images.failed'));
}

/** Images to PDF: a new unsaved tab. Resolves its id (undefined: cancelled or failed). */
export async function createFromImages(
  items: readonly ImageItem[],
  options: ImagesOptions,
): Promise<string | undefined> {
  if (items.length === 0) return undefined;
  const docId = documentStore.getState().activeId ?? '';
  try {
    const bytes = await build(docId, items, options);
    const base = imagesBaseName(items.map((i) => i.name));
    const name = base
      ? t('images.fileNameOne', { base })
      : t('images.fileName', { count: format.number(items.length, 0) });
    return await openResult(name, bytes);
  } catch (err) {
    showBuildError(err, items);
    return undefined;
  }
}

/** Insert from Image: the images as pages of `docId` from index `at`, one undo step. */
export async function insertImages(
  docId: string,
  items: readonly ImageItem[],
  options: ImagesOptions,
  at: number,
): Promise<boolean> {
  if (items.length === 0) return false;
  let source: ArrayBuffer;
  try {
    source = await build(docId, items, options);
  } catch (err) {
    showBuildError(err, items);
    return false;
  }
  return runPageOp(
    docId,
    { kind: 'import', source, pages: items.map((_, i) => i), at },
    msg('pages.inserting'),
  );
}
