import { DocumentPdf24Regular } from '@fluentui/react-icons/svg/document-pdf';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { setDragOver as setOver, useDragOver } from './dragStore';
import { collectDropped, hasFiles } from './dropped';
import { openOrConvert } from '../pages/images';

/**
 * Window-level drop target (§4.1): drop one or many PDFs anywhere to open them,
 * or JPG and PNG images to make a PDF of them (M11-08·O8).
 * While files are dragged over the window, a dashed frame lines it; with a
 * document open, a card in the middle says what a drop does. With none open,
 * the start screen's drop card highlights instead (M10-05).
 */
export function DropZone() {
  const { t } = useTranslation();
  const over = useDragOver();
  // The drop card over a document; a comparison's input window has drop targets of its
  // own (M12-08), and the start screen its card.
  const hasDocument = useDocuments(
    (s) => s.activeTab !== null && s.docs[s.activeTab] !== undefined,
  );

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overFn = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault(); // allow the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent): void => {
      depth = 0;
      setOver(false);
      if (!e.dataTransfer || !hasFiles(e.dataTransfer)) return;
      e.preventDefault(); // never let the browser navigate to the file
      // JPG and PNG files go to Images to PDF (M11-08·O8); PDFs open.
      void collectDropped(e.dataTransfer).then((files) => openOrConvert(files, 'dropped'));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  if (!over) return null;
  return (
    <div className="drop-overlay" aria-hidden="true" data-start={hasDocument ? undefined : ''}>
      {hasDocument ? (
        <div className="drop-overlay-card">
          <span className="start-badge">
            <DocumentPdf24Regular />
          </span>
          <span className="drop-overlay-label">{t('open.dropHint')}</span>
        </div>
      ) : null}
    </div>
  );
}
