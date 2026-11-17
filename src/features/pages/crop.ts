// Crop pages (M11-08·O9, D-55, ADR-028): Organize → Crop Pages opens a dialog
// (margins typed in mm or inches, for a page range), and the Crop Tool draws
// the area to keep on a page, which opens the same dialog with that area's
// margins. The crop is one page operation (one undo step): the Render worker
// sets each page's /CropBox only, so the content stays in the file, other
// viewers honour it, and Remove Crop shows the whole page again. Needs the
// modify permission (rule 9).
import { registerCommand } from '../../app/commands/dispatch';
import { appStore } from '../../app/store/appStore';
import { documentStore } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import {
  isCropped,
  marginsFromRect,
  shownMargins,
  type CropMargins,
  type UserBox,
} from '../../model/cropBox';
import { deselectAnnotations } from '../annotate/commands';
import { clearSelection } from '../select/commands';
import { hostStore } from '../view/host';
import { closePageDialog, openPageDialog } from './dialogStore';
import { cropBlocked, runPageOp } from './pageOps';

/** One page as the crop needs it: its size as shown (its /Rotate applied, points) and boxes. */
export interface CropPage {
  width: number;
  height: number;
  /** Quarter turns of the page's own /Rotate. */
  rotation: number;
  media: UserBox | null;
  crop: UserBox | null;
}

/**
 * The pages of a document as the viewer has them. The viewer's page space is
 * the stored page's (EmbedPDF normalizes rotation: sizes unturned, the page
 * turned by the view); the crop's margins are as the page is shown.
 */
export function cropPages(docId: string): CropPage[] {
  const doc = hostStore.getState().registry?.getStore().getState().core.documents[docId]?.document;
  return (doc?.pages ?? []).map((p) => {
    const turned = p.rotation % 2 === 1;
    const boxes = p.boxes;
    return {
      width: turned ? p.size.height : p.size.width,
      height: turned ? p.size.width : p.size.height,
      rotation: p.rotation,
      media: boxes?.media ?? null,
      crop: boxes?.crop ?? null,
    };
  });
}

/** Whether the page shows less than its whole sheet (Remove Crop has something to do). */
export const pageIsCropped = (p: CropPage): boolean =>
  p.media !== null && isCropped(p.media, p.crop);

/** Crops `pages` (or, with null margins, removes their crop) as one undo step. */
export function cropPagesOp(
  docId: string,
  pages: readonly number[],
  margins: CropMargins | null,
): Promise<boolean> {
  return runPageOp(
    docId,
    { kind: 'crop', pages: [...pages], margins },
    margins ? msg('crop.cropping') : msg('crop.removing'),
  );
}

/** Opens Crop Pages; from the Crop Tool with the page and the margins of the area drawn. */
export function openCropDialog(docId: string, from?: { page: number; margins: CropMargins }): void {
  openPageDialog('crop', docId, undefined, from);
}

/**
 * The Crop Tool's drag on page `page` ended: `rect` in points from the
 * top-left corner of the stored page (the page layers' space, before its
 * /Rotate). The dialog opens with the margins, as the page is shown, that keep it.
 */
export function cropAreaDrawn(
  docId: string,
  page: number,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const p = cropPages(docId)[page];
  if (!p) return;
  const turned = p.rotation % 2 === 1;
  const stored = { width: turned ? p.height : p.width, height: turned ? p.width : p.height };
  openCropDialog(docId, { page, margins: shownMargins(p.rotation, marginsFromRect(rect, stored)) });
}

const activeId = (): string | null => documentStore.getState().activeId;

/** Busy/saving reasons; the permission itself is checked by `requires`. */
function blocked() {
  const id = activeId();
  if (!id) return null;
  const why = cropBlocked(id);
  return why === msg('crop.restricted') ? null : why;
}

export function registerCropCommands(): () => void {
  const common = { requiresDocument: true, requires: 'modify' as const, disabledReason: blocked };
  const offs = [
    registerCommand('organize.crop', {
      ...common,
      run: () => {
        const id = activeId();
        if (id) openCropDialog(id);
      },
    }),
    // A pointer tool: the toggle and Esc go back to Select.
    registerCommand('organize.cropTool', {
      ...common,
      isPressed: () => appStore.getState().tool === 'cropArea',
      run: () => {
        const s = appStore.getState();
        if (s.tool === 'cropArea') {
          s.setTool('select');
          return;
        }
        clearSelection();
        deselectAnnotations();
        closePageDialog();
        s.setTool('cropArea');
      },
    }),
  ];
  return () => {
    for (const o of offs) o();
  };
}
