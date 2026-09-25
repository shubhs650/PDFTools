import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectDropped, hasFiles } from './dropped';
import { openFiles } from './openDocument';

/** Window-level drop target (§4.1): drop one or many PDFs anywhere to open them. */
export function DropZone() {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);

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
      void collectDropped(e.dataTransfer).then(openFiles);
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
    <div className="drop-overlay" aria-hidden="true">
      <span className="drop-overlay-label">{t('open.dropHint')}</span>
    </div>
  );
}
