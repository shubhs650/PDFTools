import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarCloseButton } from '../../app/BarCloseButton';
import { runCommand } from '../../app/commands/dispatch';
import { useBarClosed } from '../../app/infoBars';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { Button } from '../../ui/components';
import { objectsOf, useAnnotationMap } from '../annotate/comments/commentsStore';
import { focusDocumentView } from '../view/focus';
import { pairsOf, useUpgraded } from './upgradeOld';

const UPDATE_COMMAND = 'measure.updateOld';

/**
 * Above a file with measurements saved by Triya PDF 1.1.0 (M14-03, Q38): how
 * many there are, one button that turns each into one markup (one undo step),
 * and a × that closes the bar for that document (M13-04). After the update it
 * says how many were updated until closed.
 */
export function OldMeasurementsBar({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const key = `oldMeasurements:${documentId}`;
  const closed = useBarClosed(key);
  const byUid = useAnnotationMap(closed ? null : documentId);
  const canEdit = useDocuments((s) => {
    const meta = s.docs[documentId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const done = useUpgraded(documentId);
  const count = useMemo(
    () => (byUid ? pairsOf(documentId, objectsOf(byUid)).length : 0),
    [byUid, documentId],
  );
  if (closed || (count === 0 && done === undefined)) return null;
  return (
    <section className="permission-banner" aria-label={t('measure.oldBar.name')}>
      <p className="permission-banner-text" data-testid="old-measurements-bar" role="status">
        {count > 0
          ? t('measure.oldBar.text', { count })
          : t('measure.oldBar.done', { count: done })}
      </p>
      {count > 0 && canEdit ? (
        <Button
          size="small"
          onClick={() => {
            void runCommand(UPDATE_COMMAND);
          }}
          label={t('measure.oldBar.update')}
        />
      ) : null}
      <BarCloseButton
        barKey={key}
        afterClose={() => {
          focusDocumentView(documentId);
        }}
      />
    </section>
  );
}
