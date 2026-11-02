import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../app/store/appStore';
import { attachFileAt } from './attachFile';

/**
 * The Attach File tool on a page (M6-10): while it is on, the page takes the
 * pointer and a click picks the file to attach there. From the keyboard the
 * command attaches to the middle of the current page instead (rule 12).
 */
export function AttachFileLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { t } = useTranslation();
  const on = useApp((s) => s.tool === 'attachFile');
  const root = useRef<HTMLDivElement>(null);

  // Native listeners: they run before the page's own pointer handling (text
  // selection, the annotation plugin) further up, which a React handler could not stop.
  useEffect(() => {
    const el = root.current;
    if (!el || !on) return;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const click = (e: MouseEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      e.stopPropagation();
      // In the click itself: the file picker needs the user's activation.
      void attachFileAt(documentId, pageIndex, { x: e.offsetX / scale, y: e.offsetY / scale });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('click', click);
    };
  }, [on, scale, documentId, pageIndex]);

  if (!on) return null;
  return (
    <div
      ref={root}
      className="attach-file-layer"
      data-testid="attach-file-layer"
      title={t('attachFile.layer')}
    />
  );
}
