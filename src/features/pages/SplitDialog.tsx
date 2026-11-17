import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { canPickFolder } from '../../storage/fileAccess';
import { Button, Dialog, TextField } from '../../ui/components';
import { dialogHelp } from '../help/openHelp';
import { hasFullAccess } from './assemble';
import { closePageDialog as closeDialog } from './dialogStore';
import { lastSplit, partNames, readTopBookmarks, rememberSplit, splitDocument } from './split';
import {
  SPLIT_MAX_PARTS,
  splitBookmarks,
  splitEvery,
  splitRanges,
  type SplitError,
  type SplitMode,
  type SplitResult,
  type TopBookmark,
} from './splitPlan';

// Organize → Split Document (M11-08·O7, D-55): every N pages, typed ranges
// (one file per range) or top-level bookmarks; a preview of the file names;
// the files go into a folder the user picks (one ZIP where the browser has no
// folder picker). The choices are kept for the next time in this session.

const ERRORS: Record<SplitError, MessageKey> = {
  empty: msg('split.error.empty'),
  syntax: msg('pages.error.syntax'),
  outOfRange: msg('pages.error.outOfRange'),
  every: msg('split.error.every'),
  noBookmarks: msg('split.error.noBookmarks'),
  tooMany: msg('split.error.tooMany'),
};

const MODES: readonly SplitMode[] = ['every', 'ranges', 'bookmarks'];

/** Names shown before "and n more". */
const PREVIEW = 5;

type Bookmarks = { state: 'loading' } | { state: 'ready'; tops: TopBookmark[] };

export function SplitDialog({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const meta = useDocuments((s) => s.docs[docId]?.meta);
  const pageCount = meta?.pageCount ?? 0;
  const allowed = meta ? hasFullAccess(meta) : false;
  const [mode, setMode] = useState<SplitMode>(() => lastSplit().mode);
  const [every, setEvery] = useState(() => lastSplit().every);
  const [ranges, setRanges] = useState(() => lastSplit().ranges);
  const [bookmarks, setBookmarks] = useState<Bookmarks>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    void readTopBookmarks(docId)
      .catch(() => [])
      .then((tops) => {
        if (!live) return;
        setBookmarks({ state: 'ready', tops });
        // The last choice was bookmarks, but this document has none: the first way instead.
        if (!splitBookmarks(tops, pageCount).ok) setMode((m) => (m === 'bookmarks' ? 'every' : m));
      });
    return () => {
      live = false;
    };
  }, [docId, pageCount]);

  const result: SplitResult | null =
    mode === 'every'
      ? splitEvery(pageCount, /^\s*\d+\s*$/u.test(every) ? Number(every) : Number.NaN)
      : mode === 'ranges'
        ? splitRanges(ranges, pageCount)
        : bookmarks.state === 'ready'
          ? splitBookmarks(bookmarks.tops, pageCount)
          : null;
  const ready = allowed && result?.ok === true;
  const names = result?.ok ? partNames(meta?.name ?? '', result.parts) : [];
  const error = result && !result.ok ? ERRORS[result.error] : undefined;
  const errorText = error
    ? t(error, { max: format.number(SPLIT_MAX_PARTS, 0), pages: format.number(pageCount, 0) })
    : undefined;
  const noBookmarks = bookmarks.state === 'ready' && !splitBookmarks(bookmarks.tops, pageCount).ok;

  const label: Record<SplitMode, string> = {
    every: t('split.mode.every'),
    ranges: t('split.mode.ranges'),
    bookmarks:
      bookmarks.state === 'loading'
        ? t('split.mode.bookmarksLoading')
        : noBookmarks
          ? t('split.mode.bookmarksNone')
          : t('split.mode.bookmarks'),
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('split.title')}
      description={t('split.description')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('organize-pages')}
      className="split-dialog"
      footer={
        <>
          <Button
            label={t('split.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ready}
          />
          <Button label={t('split.cancel')} onClick={closeDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          rememberSplit({ mode, every, ranges });
          const parts = result.parts;
          closeDialog();
          void splitDocument(docId, parts);
        }}
      >
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('split.legend')}</legend>
          {MODES.map((m) => (
            <div key={m} className="split-mode">
              <label className="scale-radio">
                <input
                  type="radio"
                  name={`${ids}-mode`}
                  checked={mode === m}
                  disabled={m === 'bookmarks' && (bookmarks.state === 'loading' || noBookmarks)}
                  onChange={() => {
                    setMode(m);
                  }}
                />
                {label[m]}
              </label>
              {m === 'every' && mode === 'every' ? (
                <TextField
                  label={t('split.everyLabel')}
                  inputMode="numeric"
                  value={every}
                  error={errorText}
                  onChange={(e) => {
                    setEvery(e.currentTarget.value);
                  }}
                />
              ) : null}
              {m === 'ranges' && mode === 'ranges' ? (
                <TextField
                  label={t('split.rangesLabel')}
                  placeholder={t('split.rangesHint')}
                  value={ranges}
                  error={errorText}
                  onChange={(e) => {
                    setRanges(e.currentTarget.value);
                  }}
                />
              ) : null}
            </div>
          ))}
        </fieldset>
        {mode === 'bookmarks' && errorText ? (
          <p className="print-error" role="alert">
            {errorText}
          </p>
        ) : null}
        {names.length > 0 ? (
          <div className="split-preview">
            <p className="ui-field-label" id={`${ids}-files`}>
              {t('split.preview', { count: names.length, n: format.number(names.length, 0) })}
            </p>
            <ul aria-labelledby={`${ids}-files`}>
              {names.slice(0, PREVIEW).map((name, i) => (
                <li key={`${String(i)}-${name}`}>{name}</li>
              ))}
              {names.length > PREVIEW ? (
                <li className="split-more">
                  {t('split.more', {
                    count: names.length - PREVIEW,
                    n: format.number(names.length - PREVIEW, 0),
                  })}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        <p className="print-note">{canPickFolder() ? t('split.folderNote') : t('split.zipNote')}</p>
        {allowed ? null : (
          <p className="print-error" role="alert">
            {t('pages.extract.restricted')}
          </p>
        )}
      </form>
    </Dialog>
  );
}
