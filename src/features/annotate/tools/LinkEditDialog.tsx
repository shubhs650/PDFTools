import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { Button, Dialog, TextField } from '../../../ui/components';
import { closeLinkEdit, useLinkEdit } from './linkEdit';
import { linkTarget, type LinkError } from './linkTarget';

/** Link tool (M3-09): a page of this document or a web address. */
export function LinkEditDialog() {
  const target = useLinkEdit((s) => s.target);
  if (!target) return null;
  return <LinkForm key={target.id} docId={target.docId} />;
}

function LinkForm({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const pageCount = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 1);
  const [kind, setKind] = useState<'page' | 'url'>('page');
  const [page, setPage] = useState('1');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<LinkError | null>(null);
  const id = useId();
  const formId = `${id}-form`;
  const submit = (): void => {
    const r = linkTarget(kind === 'page' ? { kind, page } : { kind, url }, pageCount);
    if (r.error) setError(r.error);
    else closeLinkEdit(r.target);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeLinkEdit(null);
      }}
      title={t('annotate.link.title')}
      description={t('annotate.link.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button label={t('annotate.link.ok')} variant="primary" type="submit" form={formId} />
          <Button
            label={t('annotate.caret.cancel')}
            onClick={() => {
              closeLinkEdit(null);
            }}
          />
        </>
      }
    >
      <form
        id={formId}
        className="link-edit-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="link-edit-kind">
          <legend className="ui-field-label">{t('annotate.link.goesTo')}</legend>
          <label>
            <input
              type="radio"
              name={`${id}-kind`}
              checked={kind === 'page'}
              onChange={() => {
                setKind('page');
                setError(null);
              }}
            />
            {t('annotate.link.page')}
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-kind`}
              checked={kind === 'url'}
              onChange={() => {
                setKind('url');
                setError(null);
              }}
            />
            {t('annotate.link.url')}
          </label>
        </fieldset>
        {kind === 'page' ? (
          <TextField
            label={t('annotate.link.pageNumber', { count: format.number(pageCount, 0) })}
            inputMode="numeric"
            value={page}
            error={
              error === 'pageRange' ? t('annotate.link.pageRange', { count: pageCount }) : undefined
            }
            onChange={(e) => {
              setPage(e.currentTarget.value);
              setError(null);
            }}
          />
        ) : (
          <TextField
            label={t('annotate.link.address')}
            type="url"
            value={url}
            error={error === 'url' ? t('annotate.link.badUrl') : undefined}
            onChange={(e) => {
              setUrl(e.currentTarget.value);
              setError(null);
            }}
          />
        )}
      </form>
    </Dialog>
  );
}
