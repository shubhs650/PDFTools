import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../../i18n';
import { Button, Dialog } from '../../../ui/components';
import { closeContentsPrompt, useContentsPrompt, type ContentsKind } from './contentsPrompt';

const TEXT: Record<ContentsKind, { title: MessageKey; label: MessageKey; ok: MessageKey }> = {
  caret: {
    title: msg('annotate.caret.title'),
    label: msg('annotate.caret.label'),
    ok: msg('annotate.caret.ok'),
  },
  note: {
    title: msg('annotate.note.title'),
    label: msg('annotate.note.label'),
    ok: msg('annotate.note.ok'),
  },
  freeText: {
    title: msg('annotate.freeText.title'),
    label: msg('annotate.freeText.label'),
    ok: msg('annotate.note.ok'),
  },
};

/** The text of a new caret, note or text box (M3-08, M3-09). */
export function ContentsDialog() {
  const target = useContentsPrompt((s) => s.target);
  if (!target) return null;
  return <ContentsForm key={target.id} kind={target.kind} />;
}

function ContentsForm({ kind }: { kind: ContentsKind }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const id = useId();
  const formId = `${id}-form`;
  const s = TEXT[kind];
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeContentsPrompt(null);
      }}
      title={t(s.title)}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button label={t(s.ok)} variant="primary" type="submit" form={formId} />
          <Button
            label={t('annotate.caret.cancel')}
            onClick={() => {
              closeContentsPrompt(null);
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
          closeContentsPrompt(text);
        }}
      >
        <div className="ui-field">
          <label className="ui-field-label" htmlFor={`${id}-text`}>
            {t(s.label)}
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
              // Enter confirms; Shift+Enter starts a new line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                closeContentsPrompt(text);
              }
            }}
          />
        </div>
      </form>
    </Dialog>
  );
}
