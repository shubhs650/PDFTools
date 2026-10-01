import { ArrowDown16Regular } from '@fluentui/react-icons/svg/arrow-down';
import { ArrowUp16Regular } from '@fluentui/react-icons/svg/arrow-up';
import { Delete16Regular } from '@fluentui/react-icons/svg/delete';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, Dialog, IconButton, TextField } from '../../ui/components';
import { resolveScope, type Scope, type ScopeKind } from '../extract/scope';
import {
  extractPages,
  hasFullAccess,
  inspect,
  mergeFiles,
  pickSources,
  sourcePages,
  type SourceFile,
} from './assemble';
import { closePageDialog as closeDialog, usePageDialog } from './dialogStore';
import { runPageOp } from './pageOps';
import { selectionOf } from './selection';
import { insertAt, type Where } from './sizes';

// Organize → Insert from File, Extract Pages and Merge Files (M4-11, §7.8,
// M4-Q2, M4-Q8). A picked file is checked in the Render worker (pages,
// password, full access); its pages are chosen by range text (empty = all).

const RANGE_ERRORS: Record<string, MessageKey> = {
  empty: msg('pages.error.empty'),
  syntax: msg('pages.error.syntax'),
  outOfRange: msg('pages.error.outOfRange'),
  noSelection: msg('pages.error.noSelection'),
};

const WHERE_LABEL: Record<Where, MessageKey> = {
  before: msg('pages.insert.before'),
  after: msg('pages.insert.after'),
};
const WHERES: readonly Where[] = ['before', 'after'];

export function FileDialogs() {
  const open = usePageDialog();
  if (open?.kind === 'insertFile') return <InsertFileDialog key={open.docId} docId={open.docId} />;
  if (open?.kind === 'extract') return <ExtractDialog key={open.docId} docId={open.docId} />;
  if (open?.kind === 'merge') return <MergeDialog />;
  return null;
}

/** One picked file: its status, a password field if needed, and its page range. */
function SourceFields({
  src,
  onChange,
}: {
  src: SourceFile;
  onChange: (next: SourceFile) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const passwordField = (
    <>
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
          void inspect(src, password).then(onChange);
        }}
      />
    </>
  );
  if (src.needsPassword) return <div className="pages-source">{passwordField}</div>;
  if (src.pageCount === null)
    return (
      <p className="print-error" role="alert">
        {t('pages.file.unreadable')}
      </p>
    );
  const r = sourcePages(src);
  return (
    <div className="pages-source">
      <p className="print-note">
        {t('pages.file.chosen', { name: src.name, count: format.number(src.pageCount, 0) })}
      </p>
      {src.fullAccess ? (
        <TextField
          label={t('pages.file.range', { name: src.name })}
          placeholder={t('pages.file.rangeHint')}
          value={src.range}
          error={r.ok ? undefined : t(r.error)}
          onChange={(e) => {
            onChange({ ...src, range: e.currentTarget.value });
          }}
        />
      ) : (
        <>
          <p className="print-error" role="alert">
            {t('pages.file.restricted')}
          </p>
          {passwordField}
        </>
      )}
    </div>
  );
}

const usable = (src: SourceFile | null): src is SourceFile =>
  src !== null && src.pageCount !== null && src.fullAccess && sourcePages(src).ok;

function InsertFileDialog({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const pageCount = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 0);
  const current = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const [src, setSrc] = useState<SourceFile | null>(null);
  const [where, setWhere] = useState<Where>('after');
  const [pageText, setPageText] = useState(String(current + 1));
  const page = Number(pageText);
  const pageOk = Number.isInteger(page) && page >= 1 && page <= pageCount;
  const ready = usable(src) && pageOk;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('pages.insertFile.title')}
      description={t('pages.insertFile.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('pages.insertFile.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ready}
          />
          <Button label={t('pages.insertFile.cancel')} onClick={closeDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!usable(src) || !pageOk) return;
          const r = sourcePages(src);
          if (!r.ok) return;
          closeDialog();
          void runPageOp(
            docId,
            {
              kind: 'import',
              source: src.bytes,
              ...(src.password === undefined ? {} : { password: src.password }),
              pages: r.pages,
              at: insertAt(where, page - 1, pageCount),
            },
            msg('pages.inserting'),
          );
        }}
      >
        <Button
          label={t('pages.file.choose')}
          onClick={() => {
            void pickSources(false).then(([first]) => {
              if (first) setSrc(first);
            });
          }}
        />
        {src ? (
          <SourceFields src={src} onChange={setSrc} />
        ) : (
          <p className="print-note">{t('pages.file.none')}</p>
        )}
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('pages.insertFile.where')}</legend>
          {WHERES.map((w) => (
            <label key={w} className="scale-radio">
              <input
                type="radio"
                name={`${ids}-where`}
                checked={where === w}
                onChange={() => {
                  setWhere(w);
                }}
              />
              {t(WHERE_LABEL[w])}
            </label>
          ))}
          <TextField
            label={t('pages.insertFile.page')}
            inputMode="numeric"
            value={pageText}
            error={pageOk ? undefined : t('pages.error.page', { max: format.number(pageCount, 0) })}
            onChange={(e) => {
              setPageText(e.currentTarget.value);
            }}
          />
        </fieldset>
        <p className="print-note">{t('pages.file.forms')}</p>
      </form>
    </Dialog>
  );
}

function ExtractDialog({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const meta = useDocuments((s) => s.docs[docId]?.meta);
  const pageCount = meta?.pageCount ?? 0;
  const current = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const picked = selectionOf(docId).selected;
  const selection = picked.length > 1 ? picked : [];
  const [scope, setScope] = useState<Scope>({
    kind: selection.length ? 'selection' : 'current',
    custom: '',
  });
  const [alsoDelete, setAlsoDelete] = useState(false);
  const r = resolveScope(scope, { pageCount, current, selection });
  const tooMany = alsoDelete && r.ok && r.pages.length >= pageCount;
  const allowed = meta ? hasFullAccess(meta) : false;
  const radio = (kind: ScopeKind, label: string, disabled = false) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-scope`}
        checked={scope.kind === kind}
        disabled={disabled}
        onChange={() => {
          setScope((s) => ({ ...s, kind }));
        }}
      />
      {label}
    </label>
  );
  const rangeError = !r.ok && scope.kind === 'custom' ? RANGE_ERRORS[r.error] : undefined;
  const rangeText = (pages: readonly number[]): string => {
    // "1-3, 8": consecutive runs, 1-based.
    const runs: string[] = [];
    let start = pages[0] ?? 0;
    let prev = start;
    for (const p of [...pages.slice(1), -2]) {
      if (p === prev + 1) {
        prev = p;
        continue;
      }
      runs.push(start === prev ? String(start + 1) : `${String(start + 1)}-${String(prev + 1)}`);
      start = p;
      prev = p;
    }
    return runs.join(', ');
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('pages.extract.title')}
      description={t('pages.extract.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('pages.extract.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!r.ok || tooMany || !allowed}
          />
          <Button label={t('pages.extract.cancel')} onClick={closeDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!r.ok || tooMany || !allowed) return;
          closeDialog();
          const pages = r.pages;
          void extractPages(docId, pages, rangeText(pages)).then((id) => {
            if (id && alsoDelete)
              void runPageOp(docId, { kind: 'delete', pages }, msg('pages.deleting'));
          });
        }}
      >
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('pages.scope.legend')}</legend>
          {radio(
            'selection',
            t('pages.scope.selected', { count: selection.length }),
            selection.length === 0,
          )}
          {radio('current', t('pages.scope.current', { page: format.number(current + 1, 0) }))}
          {radio('custom', t('pages.scope.custom'))}
          {scope.kind === 'custom' ? (
            <TextField
              label={t('pages.scope.customLabel')}
              placeholder={t('pages.scope.customHint')}
              value={scope.custom}
              error={rangeError ? t(rangeError) : undefined}
              onChange={(e) => {
                const custom = e.currentTarget.value;
                setScope({ kind: 'custom', custom });
              }}
            />
          ) : null}
        </fieldset>
        <label className="scale-radio">
          <input
            type="checkbox"
            checked={alsoDelete}
            onChange={(e) => {
              setAlsoDelete(e.currentTarget.checked);
            }}
          />
          {t('pages.extract.alsoDelete')}
        </label>
        {tooMany ? (
          <p className="print-error" role="alert">
            {t('pages.error.all')}
          </p>
        ) : null}
        {allowed ? null : (
          <p className="print-error" role="alert">
            {t('pages.extract.restricted')}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function MergeDialog() {
  const { t } = useTranslation();
  const ids = useId();
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [dragged, setDragged] = useState<number | null>(null);
  const ready = sources.length > 0 && sources.every((s) => usable(s));
  const move = (from: number, to: number) => {
    setSources((list) => {
      if (to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  };
  const update = (next: SourceFile) => {
    setSources((list) => list.map((s) => (s.id === next.id ? next : s)));
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('pages.merge.title')}
      description={t('pages.merge.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('pages.merge.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!ready}
          />
          <Button label={t('pages.merge.cancel')} onClick={closeDialog} />
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
          const parts = sources.map((src) => {
            const r = sourcePages(src);
            return { src, pages: r.ok ? r.pages : [] };
          });
          closeDialog();
          void mergeFiles(parts);
        }}
      >
        <Button
          label={t('pages.merge.add')}
          onClick={() => {
            void pickSources(true).then((added) => {
              setSources((list) => [...list, ...added]);
            });
          }}
        />
        {sources.length === 0 ? (
          <p className="print-note">{t('pages.merge.empty')}</p>
        ) : (
          <ol className="pages-merge-list" aria-label={t('pages.merge.list')}>
            {sources.map((src, i) => (
              // Drag is the pointer shortcut; the Move up/down buttons are the keyboard path (rule 12).
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                key={src.id}
                className={
                  dragged === i ? 'pages-merge-item pages-merge-item--dragged' : 'pages-merge-item'
                }
                draggable
                onDragStart={(e: DragEvent) => {
                  setDragged(i);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                }}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  if (dragged !== null) move(dragged, i);
                  setDragged(null);
                }}
                onDragEnd={() => {
                  setDragged(null);
                }}
              >
                <div className="pages-merge-controls">
                  <IconButton
                    label={t('pages.merge.up', { name: src.name })}
                    icon={<ArrowUp16Regular />}
                    disabled={i === 0}
                    onClick={() => {
                      move(i, i - 1);
                    }}
                  />
                  <IconButton
                    label={t('pages.merge.down', { name: src.name })}
                    icon={<ArrowDown16Regular />}
                    disabled={i === sources.length - 1}
                    onClick={() => {
                      move(i, i + 1);
                    }}
                  />
                  <IconButton
                    label={t('pages.merge.remove', { name: src.name })}
                    icon={<Delete16Regular />}
                    onClick={() => {
                      setSources((list) => list.filter((s) => s.id !== src.id));
                    }}
                  />
                </div>
                <SourceFields src={src} onChange={update} />
              </li>
            ))}
          </ol>
        )}
        <p className="print-note">{t('pages.file.forms')}</p>
      </form>
    </Dialog>
  );
}
