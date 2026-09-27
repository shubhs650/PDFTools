import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../../ui/components';
import { closeCaretText, useCaretText } from './caretText';

/** Insert Text / Replace Text: the text to insert (M3-08). */
export function CaretTextDialog() {
  const target = useCaretText((s) => s.target);
  if (!target) return null;
  return <CaretTextForm key={target.id} />;
}

function CaretTextForm() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const id = useId();
  const formId = `${id}-form`;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeCaretText(null);
      }}
      title={t('annotate.caret.title')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button label={t('annotate.caret.ok')} variant="primary" type="submit" form={formId} />
          <Button
            label={t('annotate.caret.cancel')}
            onClick={() => {
              closeCaretText(null);
            }}
          />
        </>
      }
    >
      <form
        id={formId}
        className="caret-text-form"
        onSubmit={(e) => {
          e.preventDefault();
          closeCaretText(text);
        }}
      >
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={`${id}-text`}>
            {t('annotate.caret.label')}
          </label>
          <textarea
            id={`${id}-text`}
            className="ui-field-input caret-text-input"
            rows={3}
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              // Enter inserts; Shift+Enter starts a new line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                closeCaretText(text);
              }
            }}
          />
        </div>
      </form>
    </Dialog>
  );
}
