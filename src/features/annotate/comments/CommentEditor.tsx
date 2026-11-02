// The inline editor of a card (M6-05, B2): a new reply, or the text of a
// comment or of the reviewer's own reply. Drawn over a gap left in the card,
// outside the listbox (a text box can't be inside an option, rule 12).
// Enter or Ctrl+Enter posts, Shift+Enter is a new line, Esc cancels.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../ui/components';

export interface CommentEditorProps {
  kind: 'reply' | 'text';
  initial: string;
  /** Delete the reply being edited (own replies only). */
  onDelete?: (() => void) | undefined;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function CommentEditor({ kind, initial, onDelete, onSubmit, onCancel }: CommentEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const empty = kind === 'reply' && !text.trim();
  const submit = (): void => {
    if (!empty) onSubmit(kind === 'reply' ? text.trim() : text);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  };
  const label = kind === 'reply' ? t('comments.replyLabel') : t('comments.editText');
  return (
    <div className="comment-editor" data-testid="comment-editor">
      <label htmlFor={`${id}-box`} className="ui-visually-hidden">
        {label}
      </label>
      <textarea
        ref={box}
        id={`${id}-box`}
        className="ui-field-input comment-editor-box"
        rows={kind === 'reply' ? 2 : 3}
        value={text}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setText(e.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
      />
      <p id={`${id}-hint`} className="comment-editor-hint">
        {t('comments.editorHint')}
      </p>
      <div className="comment-editor-actions">
        {onDelete ? (
          <Button
            label={t('comments.delete')}
            size="small"
            variant="subtle"
            className="comment-editor-delete"
            onClick={onDelete}
          />
        ) : null}
        <Button label={t('annotate.caret.cancel')} size="small" onClick={onCancel} />
        <Button
          label={kind === 'reply' ? t('comments.reply') : t('comments.save')}
          size="small"
          variant="primary"
          disabled={empty}
          onClick={submit}
        />
      </div>
    </div>
  );
}
