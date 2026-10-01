import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { Button, Dialog, Spinner, TextField } from '../../../ui/components';
import { parseRange } from '../../print/options';
import { STATUS_KEYS } from '../comments/statusLabels';
import {
  chooseSource,
  closeImportComments,
  previewImport,
  runImport,
  unlockSource,
  useImport,
  type ImportCounts,
  type ImportOptions,
  type ImportSource,
} from './importComments';
import { typeLabelKey } from './typeLabels';

// Comment → Import Comments (M4-20): the source's summary (comments per page,
// authors, types, statuses), a page range, author and type filters, with or
// without replies, the page mapping, and a live preview of what is imported
// and skipped. Keyboard only: every control is a native input or button.

const RANGE_ERRORS: Record<string, MessageKey> = {
  empty: msg('pages.error.empty'),
  syntax: msg('pages.error.syntax'),
  outOfRange: msg('pages.error.outOfRange'),
};

/** Pages listed in the per-page summary; the rest are counted. */
const PER_PAGE_SHOWN = 12;

export function ImportCommentsDialog() {
  const docId = useImport((s) => s.docId);
  if (!docId) return null;
  return <Form key={docId} docId={docId} />;
}

function Form({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const source = useImport((s) => s.source);
  const loading = useImport((s) => s.loading);
  const docName = useDocuments((s) => s.docs[docId]?.meta.name ?? '');
  const preview = useImport((s) => s.preview);
  const usable = source && !source.error && !source.needsPassword && !source.restricted;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeImportComments();
      }}
      title={t('transfer.import.title')}
      description={t('transfer.import.description', { name: docName })}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('transfer.import.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!usable || !preview || preview.roots === 0}
          />
          <Button label={t('transfer.import.cancel')} onClick={closeImportComments} />
        </>
      }
    >
      <div className="scale-form">
        <Button
          label={t('transfer.import.choose')}
          onClick={() => {
            void chooseSource();
          }}
        />
        {loading ? <Spinner label={t('transfer.import.reading')} /> : null}
        {!source && !loading ? <p className="print-note">{t('transfer.import.none')}</p> : null}
        {source && !loading ? <SourceState src={source} /> : null}
        {usable && !loading ? <Options key={source.name} id={`${ids}-form`} src={source} /> : null}
      </div>
    </Dialog>
  );
}

/** A password prompt, a refusal or an unreadable file; nothing when the source is usable. */
function SourceState({ src }: { src: ImportSource }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  if (src.error)
    return (
      <p className="print-error" role="alert">
        {t(src.error)}
      </p>
    );
  if (!src.needsPassword && !src.restricted) return null;
  return (
    <div className="pages-source">
      {src.restricted ? (
        <p className="print-error" role="alert">
          {t('transfer.import.restricted', { name: src.name })}
        </p>
      ) : null}
      <TextField
        label={t('pages.file.password', { name: src.name })}
        type="password"
        value={password}
        error={src.wrongPassword ? t('pages.file.wrongPassword') : undefined}
        onChange={(e) => {
          setPassword(e.currentTarget.value);
        }}
      />
      <Button
        label={t('pages.file.unlock')}
        onClick={() => {
          void unlockSource(password);
        }}
      />
    </div>
  );
}

/** Counts per key, most first (ties by key). */
function tally(values: readonly string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function Options({ id, src }: { id: string; src: ImportSource }) {
  const { t } = useTranslation();
  const ids = useId();
  const docId = useImport((s) => s.docId);
  const preview = useImport((s) => s.preview);
  const [range, setRange] = useState('');
  const [offAuthors, setOffAuthors] = useState<ReadonlySet<string>>(new Set());
  const [offTypes, setOffTypes] = useState<ReadonlySet<string>>(new Set());
  const [withReplies, setWithReplies] = useState(true);
  const [mapping, setMapping] = useState<'same' | 'offset'>('same');
  const [offsetText, setOffsetText] = useState('0');

  const authors = useMemo(() => tally(src.comments.map((c) => c.author)), [src]);
  const types = useMemo(() => tally(src.comments.map((c) => c.type)), [src]);
  const states = useMemo(
    () => tally(src.comments.map((c) => c.state ?? '')).filter(([s]) => s !== ''),
    [src],
  );
  const perPage = useMemo(
    () =>
      tally(src.comments.map((c) => String(c.page))).sort((a, b) => Number(a[0]) - Number(b[0])),
    [src],
  );

  const parsed = range.trim() ? parseRange(range, src.pages) : null;
  const offset = mapping === 'same' ? 0 : Number(offsetText);
  const offsetOk = Number.isInteger(offset) && Math.abs(offset) <= 100_000;
  const options: ImportOptions | null =
    (parsed && !parsed.ok) || !offsetOk
      ? null
      : {
          pages: parsed?.ok ? [...new Set(parsed.pages.map((p) => p - 1))] : null,
          authors: offAuthors.size
            ? authors.map(([a]) => a).filter((a) => !offAuthors.has(a))
            : null,
          types: offTypes.size ? types.map(([x]) => x).filter((x) => !offTypes.has(x)) : null,
          withReplies,
          offset,
        };
  const key = JSON.stringify(options);
  useEffect(() => {
    if (!options) return;
    const timer = setTimeout(() => {
      void previewImport(options);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
    // The options' JSON is the dependency (a new object every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, docId]);

  const toggle =
    (set: ReadonlySet<string>, update: (s: ReadonlySet<string>) => void, v: string) => () => {
      const next = new Set(set);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      update(next);
    };
  const statusLabel = (s: string) => {
    const k = STATUS_KEYS[s as keyof typeof STATUS_KEYS] as MessageKey | undefined;
    return k ? t(k) : s;
  };
  const authorLabel = (a: string) => a || t('annotate.noAuthor');

  return (
    <form
      id={id}
      className="scale-form transfer-options"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!options || !preview || preview.roots === 0) return;
        void runImport(options);
      }}
    >
      <p className="print-note">
        {t('transfer.import.summary', {
          name: src.name,
          count: format.number(src.comments.length, 0),
          pages: format.number(src.pages, 0),
        })}
      </p>
      {src.comments.length > 0 ? (
        <p className="print-note">
          {t('transfer.import.perPage', {
            list: format.list([
              ...perPage.slice(0, PER_PAGE_SHOWN).map(([p, n]) =>
                t('transfer.import.pageCount', {
                  page: format.number(Number(p) + 1, 0),
                  count: format.number(n, 0),
                }),
              ),
              ...(perPage.length > PER_PAGE_SHOWN
                ? [
                    t('transfer.import.morePages', {
                      count: perPage.length - PER_PAGE_SHOWN,
                      n: format.number(perPage.length - PER_PAGE_SHOWN, 0),
                    }),
                  ]
                : []),
            ]),
          })}
        </p>
      ) : null}
      {states.length > 0 ? (
        <p className="print-note">
          {t('transfer.import.statuses', {
            list: format.list(
              states.map(([s, n]) =>
                t('transfer.import.statusCount', {
                  status: statusLabel(s),
                  count: format.number(n, 0),
                }),
              ),
            ),
          })}
        </p>
      ) : null}
      <TextField
        label={t('transfer.import.range')}
        placeholder={t('pages.file.rangeHint')}
        value={range}
        error={
          parsed && !parsed.ok
            ? t(RANGE_ERRORS[parsed.error] ?? msg('pages.error.syntax'))
            : undefined
        }
        onChange={(e) => {
          setRange(e.currentTarget.value);
        }}
      />
      {authors.length > 1 ? (
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('transfer.import.authors')}</legend>
          {authors.map(([a, n]) => (
            <label key={a} className="scale-radio">
              <input
                type="checkbox"
                checked={!offAuthors.has(a)}
                onChange={toggle(offAuthors, setOffAuthors, a)}
              />
              {t('transfer.import.withCount', {
                label: authorLabel(a),
                count: format.number(n, 0),
              })}
            </label>
          ))}
        </fieldset>
      ) : null}
      {types.length > 1 ? (
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('transfer.import.types')}</legend>
          {types.map(([x, n]) => (
            <label key={x} className="scale-radio">
              <input
                type="checkbox"
                checked={!offTypes.has(x)}
                onChange={toggle(offTypes, setOffTypes, x)}
              />
              {t('transfer.import.withCount', {
                label: t(typeLabelKey(x)),
                count: format.number(n, 0),
              })}
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className="scale-radio">
        <input
          type="checkbox"
          checked={withReplies}
          onChange={(e) => {
            setWithReplies(e.currentTarget.checked);
          }}
        />
        {t('transfer.import.withReplies')}
      </label>
      <fieldset className="scale-where">
        <legend className="ui-field-label">{t('transfer.import.mapping')}</legend>
        <label className="scale-radio">
          <input
            type="radio"
            name={`${ids}-map`}
            checked={mapping === 'same'}
            onChange={() => {
              setMapping('same');
            }}
          />
          {t('transfer.import.samePage')}
        </label>
        <label className="scale-radio">
          <input
            type="radio"
            name={`${ids}-map`}
            checked={mapping === 'offset'}
            onChange={() => {
              setMapping('offset');
            }}
          />
          {t('transfer.import.shift')}
        </label>
        {mapping === 'offset' ? (
          <TextField
            label={t('transfer.import.shiftBy')}
            inputMode="numeric"
            value={offsetText}
            error={offsetOk ? undefined : t('transfer.import.shiftError')}
            onChange={(e) => {
              setOffsetText(e.currentTarget.value);
            }}
          />
        ) : null}
      </fieldset>
      <div className="print-note" role="status">
        {preview && options ? <Preview counts={preview} /> : null}
      </div>
    </form>
  );
}

function Preview({ counts }: { counts: ImportCounts }) {
  const { t } = useTranslation();
  const n = (v: number) => format.number(v, 0);
  const skipped: string[] = [];
  if (counts.skipped.missingPage)
    skipped.push(
      t('transfer.import.skipMissing', {
        count: counts.skipped.missingPage,
        n: n(counts.skipped.missingPage),
      }),
    );
  if (counts.skipped.duplicate)
    skipped.push(
      t('transfer.import.skipDuplicate', {
        count: counts.skipped.duplicate,
        n: n(counts.skipped.duplicate),
      }),
    );
  if (counts.skipped.unsupported)
    skipped.push(
      t('transfer.import.skipUnsupported', {
        count: counts.skipped.unsupported,
        n: n(counts.skipped.unsupported),
      }),
    );
  return (
    <>
      <span>
        {counts.roots === 0
          ? t('transfer.import.nothing')
          : t('transfer.import.will', {
              count: counts.roots,
              n: n(counts.roots),
              total: n(counts.selected),
            })}
      </span>
      {skipped.length ? (
        <span> {t('transfer.import.skipped', { list: format.list(skipped) })}</span>
      ) : null}
    </>
  );
}
