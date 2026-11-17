// Copy Image / Save Image As (M11-08·O6): a large image can take a while to
// decode and encode, so after 300 ms its progress shows with Cancel (rule 2).
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { msg } from '../../i18n';
import { Button, Dialog, ProgressBar } from '../../ui/components';
import { cancelPageImage, usePageImage } from './pageImage';

const TITLE = { copy: msg('pageImage.copyTitle'), save: msg('pageImage.saveTitle') } as const;

export function PageImageProgress() {
  const { t } = useTranslation();
  const busy = usePageImage((s) => s.busy);
  const started = busy?.started;
  const [shownFor, setShownFor] = useState<number | null>(null);
  useEffect(() => {
    if (started === undefined) return;
    const timer = setTimeout(
      () => {
        setShownFor(started);
      },
      Math.max(0, 300 - (performance.now() - started)),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [started]);
  if (!busy) return null;
  if (busy.started !== shownFor) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancelPageImage();
      }}
      title={t(TITLE[busy.job])}
      description={t('pageImage.progress')}
      closeIcon={<Dismiss20Regular />}
      footer={<Button label={t('pageImage.cancel')} onClick={cancelPageImage} />}
    >
      <ProgressBar label={t('pageImage.progressName')} value={null} />
    </Dialog>
  );
}
