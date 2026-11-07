import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { Button, Dialog, TextField } from '../../../ui/components';
import { parseRange } from '../../print/options';
import { useAnnotationMap } from '../comments/commentsStore';
import { applyFlatten, closeFlatten, previewFlatten, selectedIds, useFlatten } from './flatten';
import type { FlattenRequest } from './flattenModel';
import { dialogHelp } from '../../help/openHelp';

// Comment → Flatten Comments (M6-09, ADR-021 D-38 c): the selected comments or
// every comment on all / the current / a range of pages, with or without their
// replies, and a live count of what is flattened and left as it is. Native
// inputs and buttons only, so the dialog is complete from the keyboard (rule 12).

const RANGE_ERRORS: Record<string, MessageKey> = {
  empty: msg('pages.error.empty'),
  syntax: msg('pages.error.syntax'),
  outOfRange: msg('pages.error.outOfRange'),
};

type Which = 'selected' | 'pages';
type Pages = 'all' | 'current' | 'range';

export function FlattenDialog() {
  const docId = useFlatten((s) => s.docId);
  if (!docId) return null;
  return <Form key={docId} docId={docId} />;
}

function Form({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const initial = useFlatten((s) => s.initial);
  const doc = useDocuments((s) => s.docs[docId]);
  // Re-plans whenever the document's annotations change.
  const byUid = useAnnotationMap(docId);
  const [which, setWhich] = useState<Which>(initial);
  const [pages, setPages] = useState<Pages>('all');
  const [range, setRange] = useState('');
  const [keepReplies, setKeepReplies] = useState(false);

  const pageCount = doc?.meta.pageCount ?? 0;
  const current = doc?.view.page ?? 0;
  const selected = useMemo(() => selectedIds(docId), [docId, byUid]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = which === 'pages' && pages === 'range' ? parseRange(range, pageCount) : null;
  const rangeError =
    parsed && !parsed.ok ? t(RANGE_ERRORS[parsed.error] ?? msg('pages.error.syntax')) : null;

  const request: FlattenRequest | null =
    which === 'selected'
      ? { scope: { kind: 'selected', ids: selected }, keepReplies }
      : pages === 'all'
        ? { scope: { kind: 'pages', pages: null }, keepReplies }
        : pages === 'current'
          ? { scope: { kind: 'pages', pages: [current] }, keepReplies }
          : parsed?.ok
            ? { scope: { kind: 'pages', pages: parsed.pages }, keepReplies }
            : null;
  const key = JSON.stringify(request);
  const plan = useMemo(
    () => (request ? previewFlatten(docId, request) : null),
    // The request's JSON and the annotation map are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, byUid, docId],
  );
  const ready = plan !== null && plan.comments > 0;

  const run = (): void => {
    if (!plan || !ready) return;
    // The progress dialog with Cancel takes over while it runs (rule 2).
    closeFlatten();
    void applyFlatten(docId, plan);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeFlatten();
      }}
      title={t('flatten.title')}
      description={t('flatten.description', { name: doc?.meta.name ?? '' })}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('flatten-snapshot')}
      footer={
        <>
          <Button
            label={t('flatten.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ready}
          />
          <Button label={t('flatten.cancel')} onClick={closeFlatten} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="print-dialog-form flatten-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <fieldset>
          <legend>{t('flatten.which.legend')}</legend>
          <Choice
            name={`${ids}-which`}
            value="selected"
            current={which}
            label={t('flatten.which.selected', {
              count: selected.length,
              n: format.number(selected.length, 0),
            })}
            disabled={selected.length === 0}
            onPick={setWhich}
          />
          <Choice
            name={`${ids}-which`}
            value="pages"
            current={which}
            label={t('flatten.which.pages')}
            disabled={false}
            onPick={setWhich}
          />
        </fieldset>
        <fieldset disabled={which !== 'pages'}>
          <legend>{t('flatten.pages.legend')}</legend>
          <Choice
            name={`${ids}-pages`}
            value="all"
            current={pages}
            label={t('flatten.pages.all')}
            disabled={which !== 'pages'}
            onPick={setPages}
          />
          <Choice
            name={`${ids}-pages`}
            value="current"
            current={pages}
            label={t('flatten.pages.current', { page: format.number(current + 1, 0) })}
            disabled={which !== 'pages'}
            onPick={setPages}
          />
          <Choice
            name={`${ids}-pages`}
            value="range"
            current={pages}
            label={t('flatten.pages.range')}
            disabled={which !== 'pages'}
            onPick={setPages}
          />
          {which === 'pages' && pages === 'range' ? (
            <TextField
              label={t('flatten.pages.rangeLabel')}
              placeholder={t('print.range.customHint')}
              value={range}
              error={range.trim() ? (rangeError ?? undefined) : undefined}
              onChange={(e) => {
                setRange(e.currentTarget.value);
              }}
            />
          ) : null}
        </fieldset>
        <fieldset>
          <legend>{t('flatten.replies.legend')}</legend>
          <label className="scale-radio">
            <input
              type="checkbox"
              checked={keepReplies}
              onChange={(e) => {
                setKeepReplies(e.currentTarget.checked);
              }}
            />
            {t('flatten.replies.keep')}
          </label>
        </fieldset>
        <div role="status" data-testid="flatten-summary">
          {plan ? (
            <p className="print-note">
              {plan.comments > 0
                ? t('flatten.summary', {
                    count: plan.comments,
                    n: format.number(plan.comments, 0),
                    pages: format.number(plan.pages.filter((p) => p.flatten.length > 0).length, 0),
                  })
                : t('flatten.nothing')}
              {plan.locked > 0
                ? ` ${t('flatten.locked', { count: plan.locked, n: format.number(plan.locked, 0) })}`
                : ''}
              {plan.hidden > 0
                ? ` ${t('flatten.hidden', { count: plan.hidden, n: format.number(plan.hidden, 0) })}`
                : ''}
            </p>
          ) : null}
        </div>
        <p className="print-note">{t('flatten.note')}</p>
      </form>
    </Dialog>
  );
}

function Choice<K extends string>({
  name,
  value,
  current,
  label,
  disabled,
  onPick,
}: {
  name: string;
  value: K;
  current: K;
  label: string;
  disabled: boolean;
  onPick: (v: K) => void;
}) {
  return (
    <label className="print-option">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => {
          onPick(value);
        }}
      />
      {label}
    </label>
  );
}
