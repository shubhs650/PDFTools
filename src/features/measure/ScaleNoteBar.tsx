import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../ui/components';
import { focusDocumentView } from '../view/focus';
import { closeScaleNote, undoScaleChange, useScaleNote } from './scaleNote';

/**
 * Over the top of the document (floating: the page does not move) after a scale change the person made (M14-04, D-77,
 * Q23): how many measurements it updated, with Undo (the scale and every
 * value go back in one step) and ×.
 */
export function ScaleNoteBar({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const note = useScaleNote(documentId);
  if (!note) return null;
  const back = () => {
    requestAnimationFrame(() => {
      focusDocumentView(documentId);
    });
  };
  return (
    <section className="permission-banner scale-prompt" aria-label={t('measure.scaleNote.name')}>
      <p className="permission-banner-text" data-testid="scale-note" role="status">
        {t('measure.scaleNote.text', { count: note.count })}
      </p>
      <Button
        size="small"
        onClick={() => {
          undoScaleChange();
          back();
        }}
        label={t('measure.scaleNote.undo')}
      />
      <IconButton
        label={t('frame.closeMessage')}
        icon={<Dismiss20Regular />}
        size="small"
        onClick={() => {
          closeScaleNote();
          back();
        }}
      />
    </section>
  );
}
