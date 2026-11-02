// Attach File comments (M6-10, ADR-021 D-38 d, ADR-022 decision 1; beta review
// B7c): Comment → Note → Attach File, then click on a page (from the keyboard:
// the file goes to the middle of the current page). The click itself opens
// the file picker (it needs the user's activation); the file, at most 25 MB,
// becomes a standard /FileAttachment annotation with a paperclip, written by
// the Render worker with direct PDFium calls (render/fileAttach.ts). It is
// created through the annotation plugin, so it is one undo step, listed in
// the Comments pane, moved and deleted like any comment, and saved by Ctrl+S
// in the narrow tail. Its description is its contents (the file name at
// first). Save Attachment… (double-click, the comment menu) writes the file
// where the user chooses. Needs the annotate permission (rule 9). Nothing is
// opened, previewed or run.
import { PdfAnnotationSubtype, uuidV4, type PdfAnnotationObject } from '@embedpdf/models';
import { recordError } from '../../app/diagnostics';
import { registerCommand } from '../../app/commands/dispatch';
import { fromKeyboard } from '../../app/commands/inputSource';
import { appStore } from '../../app/store/appStore';
import { documentStore, securityOf, selectActive } from '../../app/store/documentStore';
import { format, msg, t } from '../../i18n';
import {
  ATTACH_DEFAULT_COLOR,
  ATTACH_MAX_BYTES,
  attachRect,
  type Point,
} from '../../model/attachFile';
import { allows } from '../../model/permissions';
import {
  downloadBytes,
  pickAnyFile,
  pickFileSaveTarget,
  writeToHandle,
} from '../../storage/fileAccess';
import { annotationCapability, annotationState } from '../annotate/selection';
import { requestProfile } from '../settings/profile/profileStore';
import { pageSize, showStatusToast } from '../snapshot/snapshot';
import { renderEngine } from '../view/host';
import { isAbortError } from '../../engine/errors';

export const isFileAttachment = (a: Pick<PdfAnnotationObject, 'type'>): boolean =>
  a.type === PdfAnnotationSubtype.FILEATTACHMENT;

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

/** Why a file can't be attached to the document (null: it can). */
export function attachBlocked(docId: string): string | null {
  const d = documentStore.getState().docs[docId];
  if (!d) return t('ribbon.needsDocument');
  return allows(securityOf(d.meta), 'annotate') ? null : t('attachFile.restricted');
}

/**
 * Picks a file and attaches it at `at` (device points; null: the middle of the
 * page). Call it from the click or key event itself: the picker needs the
 * user's activation. Resolves the new annotation's id, or null.
 */
export async function attachFileAt(
  docId: string,
  pageIndex: number,
  at: Point | null,
): Promise<string | null> {
  const blocked = attachBlocked(docId);
  if (blocked) {
    showStatusToast(docId, blocked, false);
    return null;
  }
  let file: File | null;
  try {
    file = await pickAnyFile();
  } catch (err) {
    recordError('attachFile.pick', err);
    return null;
  }
  if (!file) return null;
  if (file.size > ATTACH_MAX_BYTES) {
    showStatusToast(
      docId,
      t('attachFile.tooLarge', { max: format.bytes(ATTACH_MAX_BYTES) }),
      false,
    );
    return null;
  }
  const data = await file.arrayBuffer();
  const scope = annotationCapability()?.forDocument(docId);
  if (!scope || !documentStore.getState().docs[docId]) return null;
  const size = pageSize(docId, pageIndex);
  const now = new Date();
  const id = uuidV4();
  const annot = {
    id,
    type: PdfAnnotationSubtype.FILEATTACHMENT,
    pageIndex,
    rect: attachRect(at ?? { x: size.width / 2, y: size.height / 2 }, size),
    contents: file.name,
    strokeColor: ATTACH_DEFAULT_COLOR,
    color: ATTACH_DEFAULT_COLOR,
    flags: ['print'],
    created: now,
    modified: now,
  } as PdfAnnotationObject;
  // The file travels as the create call's context: kept by the undo step, so a
  // redo writes it again; never part of the annotation's state.
  scope.createAnnotation(pageIndex, annot, {
    attachFile: { name: file.name, data },
  } as never);
  scope.selectAnnotation(pageIndex, id);
  return id;
}

/** The single selected comment, when it is a file attachment. */
export function selectedAttachment(docId: string): PdfAnnotationObject | null {
  const st = annotationState(docId);
  if (st?.selectedUids.length !== 1) return null;
  const a = st.byUid[st.selectedUids[0] ?? '']?.object;
  return a && isFileAttachment(a) ? a : null;
}

/** Save Attachment…: the comment's file, written where the user chooses (or downloaded). */
export async function saveFileAttachment(
  docId: string,
  annot: Pick<PdfAnnotationObject, 'id' | 'pageIndex'>,
): Promise<void> {
  try {
    const { name, data } = await renderEngine().rpc.call('fileAttachment', {
      docId,
      pageIndex: annot.pageIndex,
      id: annot.id,
    }).promise;
    const fileName = name || 'attachment';
    const handle = await pickFileSaveTarget(fileName);
    const fsa =
      typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
    if (fsa && !handle) return; // cancelled
    const blob = new Blob([data]);
    if (handle) await writeToHandle(handle, blob);
    else downloadBytes(blob, fileName);
  } catch (err) {
    if (isAbortError(err)) return;
    recordError('attachFile.save', err);
    showStatusToast(docId, t('attachFile.saveFailed'), false);
  }
}

/** Double-click on the paperclip: Save Attachment… for the active document's comment. */
export function saveAttachmentById(id: string): void {
  const docId = activeId();
  const st = docId ? annotationState(docId) : null;
  const a = st ? Object.values(st.byUid).find((x) => x.object.id === id)?.object : undefined;
  if (docId && a && isFileAttachment(a)) void saveFileAttachment(docId, a);
}

// ---- the commands ----------------------------------------------------------------

export function registerAttachFileCommands(): () => void {
  const offTool = registerCommand('comment.attachFile', {
    requiresDocument: true,
    requires: 'annotate',
    isPressed: () => appStore.getState().tool === 'attachFile',
    // Like the note and drawing tools: on until Esc or the command again.
    run: async () => {
      const id = activeId();
      if (!id) return;
      if (appStore.getState().tool === 'attachFile') {
        appStore.getState().setTool('select');
        return;
      }
      const keyboard = fromKeyboard();
      // Who is attaching (M3-07); answering the prompt is itself a user activation.
      await requestProfile();
      // From the keyboard: the middle of the current page, picked right away (rule 12).
      if (keyboard) {
        await attachFileAt(id, documentStore.getState().docs[id]?.view.page ?? 0, null);
        return;
      }
      appStore.getState().setTool('attachFile');
    },
  });
  const offSave = registerCommand('comment.saveAttachment', {
    requiresDocument: true,
    disabledReason: () => {
      const id = activeId();
      return id && selectedAttachment(id) ? null : msg('attachFile.noneSelected');
    },
    run: async () => {
      const id = activeId();
      const a = id ? selectedAttachment(id) : null;
      if (id && a) await saveFileAttachment(id, a);
    },
  });
  return () => {
    offTool();
    offSave();
  };
}
