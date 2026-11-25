import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../ui/components';
import { focusDocumentView } from '../view/focus';
import { answerScale, useScalePrompt, type ScaleAnswer } from './noScaleQuestion';

/**
 * The no-scale question (M14-02, D-77, Q29): a card over the top of the
 * document, never a modal, so the measurement that asked keeps going and the
 * page does not move under the pointer. Every choice is a button (rule 12);
 * the × keeps measuring without a scale.
 */
export function ScalePrompt({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const open = useScalePrompt((s) => (s.open?.docId === documentId ? s.open : null));
  if (!open) return null;
  const answer = (a: ScaleAnswer) => () => {
    void answerScale(a);
    if (a === 'close' || a === 'paperSize') focusDocumentView(documentId);
  };
  return (
    <section
      className="permission-banner scale-prompt"
      aria-label={t('measure.noScale.name')}
      data-testid="scale-prompt"
    >
      <p className="permission-banner-text" role="status">
        {t('measure.noScale.text', { page: String(open.page + 1) })}
      </p>
      <Button label={t('measure.noScale.setScale')} size="small" onClick={answer('setScale')} />
      <Button label={t('measure.noScale.calibrate')} size="small" onClick={answer('calibrate')} />
      <Button label={t('measure.noScale.paperSize')} size="small" onClick={answer('paperSize')} />
      <IconButton
        label={t('measure.noScale.close')}
        icon={<Dismiss20Regular />}
        size="small"
        onClick={answer('close')}
      />
    </section>
  );
}
