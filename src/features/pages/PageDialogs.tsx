import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, Dialog, ProgressBar, TextField } from '../../ui/components';
import { resolveScope, type Scope, type ScopeKind } from '../extract/scope';
import { hostStore } from '../view/host';
import { answerSigned, cancelPageOp, dismissPagesError, runPageOp, usePages } from './pageOps';
import { movePages } from './commands';
import { closePageDialog as closeDialog, usePageDialog } from './dialogStore';
import { moveTo } from './move';
import { selectionOf } from './selection';
import { blankSize, insertAt, type Orientation, type SizeChoice, type Where } from './sizes';

// Organize dialogs (M4-09): Delete Pages (selection, current page or a range;
// never every page), Insert Blank Page (before/after a page, how many, the
// neighbour's size or a paper size), the progress of a running operation with
// Cancel (shown after 300 ms, rule 2), the signed-document question and errors.

const GROUP = { where: 'where', size: 'size', orientation: 'orientation' } as const;
const WHERES: readonly Where[] = ['before', 'after'];
const WHERE_LABEL: Record<Where, MessageKey> = {
  before: msg('pages.insert.before'),
  after: msg('pages.insert.after'),
};
const SIZES: readonly SizeChoice[] = ['neighbour', 'a4', 'letter', 'a3'];
const SIZE_LABEL: Record<SizeChoice, MessageKey> = {
  neighbour: msg('pages.insert.neighbour'),
  a4: msg('pages.insert.a4'),
  letter: msg('pages.insert.letter'),
  a3: msg('pages.insert.a3'),
};
const ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape'];
const ORIENTATION_LABEL: Record<Orientation, MessageKey> = {
  portrait: msg('pages.insert.portrait'),
  landscape: msg('pages.insert.landscape'),
};

const RANGE_ERRORS: Record<string, MessageKey> = {
  empty: msg('pages.error.empty'),
  syntax: msg('pages.error.syntax'),
  outOfRange: msg('pages.error.outOfRange'),
  noSelection: msg('pages.error.noSelection'),
};

export function PageDialogs() {
  const open = usePageDialog();
  return (
    <>
      {open?.kind === 'delete' ? <DeleteDialog key={open.docId} docId={open.docId} /> : null}
      {open?.kind === 'move' ? <MoveDialog key={open.docId} docId={open.docId} /> : null}
      {open?.kind === 'insertBlank' ? (
        <InsertDialog key={open.docId} docId={open.docId} where={open.where ?? 'after'} />
      ) : null}
      <ProgressDialog />
      <SignedDialog />
      <ErrorDialog />
    </>
  );
}

function usePageSizes(docId: string) {
  const registry = hostStore.getState().registry;
  const doc = registry?.getStore().getState().core.documents[docId]?.document;
  return doc?.pages ?? [];
}

function DeleteDialog({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const pageCount = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 0);
  const current = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const picked = selectionOf(docId).selected;
  const selection = picked.length > 1 ? picked : [];
  const [scope, setScope] = useState<Scope>({
    kind: selection.length > 1 ? 'selection' : 'current',
    custom: '',
  });
  const r = resolveScope(scope, { pageCount, current, selection });
  const tooMany = r.ok && r.pages.length >= pageCount;
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
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('pages.delete.title')}
      description={t('pages.delete.description')}
      closeIcon={<Dismiss20Regular />}
      initialFocus={cancelRef}
      footer={
        <>
          <Button
            label={t('pages.delete.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!r.ok || tooMany}
          />
          <Button ref={cancelRef} label={t('pages.delete.cancel')} onClick={closeDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!r.ok || tooMany) return;
          closeDialog();
          void runPageOp(docId, { kind: 'delete', pages: r.pages }, msg('pages.deleting'));
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
        {r.ok ? (
          <p className="print-note" role="status">
            {tooMany
              ? t('pages.error.all')
              : t('pages.delete.summary', {
                  count: format.number(r.pages.length, 0),
                  total: format.number(pageCount, 0),
                })}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function InsertDialog({ docId, where: initialWhere }: { docId: string; where: Where }) {
  const { t } = useTranslation();
  const ids = useId();
  const pageCount = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 0);
  const current = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const sel = selectionOf(docId).selected;
  const [where, setWhere] = useState<Where>(initialWhere);
  const [pageText, setPageText] = useState(
    String((initialWhere === 'before' ? (sel[0] ?? current) : (sel.at(-1) ?? current)) + 1),
  );
  const [countText, setCountText] = useState('1');
  const [size, setSize] = useState<SizeChoice>('neighbour');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const pages = usePageSizes(docId);
  const page = Number(pageText);
  const count = Number(countText);
  const pageOk = Number.isInteger(page) && page >= 1 && page <= pageCount;
  const countOk = Number.isInteger(count) && count >= 1 && count <= 100;
  const choice = <T extends string>(
    name: string,
    value: T,
    cur: T,
    set: (v: T) => void,
    label: string,
    disabled = false,
  ) => (
    <label key={value} className="scale-radio">
      <input
        type="radio"
        name={`${ids}-${name}`}
        checked={cur === value}
        disabled={disabled}
        onChange={() => {
          set(value);
        }}
      />
      {label}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('pages.insert.title')}
      description={t('pages.insert.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('pages.insert.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={!pageOk || !countOk}
          />
          <Button label={t('pages.insert.cancel')} onClick={closeDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pageOk || !countOk) return;
          const neighbour = pages[page - 1];
          const { width, height } = blankSize(
            size,
            orientation,
            neighbour
              ? {
                  width: neighbour.size.width,
                  height: neighbour.size.height,
                  rotation: neighbour.rotation,
                }
              : undefined,
          );
          closeDialog();
          void runPageOp(
            docId,
            { kind: 'insertBlank', at: insertAt(where, page - 1, pageCount), count, width, height },
            msg('pages.inserting'),
          );
        }}
      >
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('pages.insert.where')}</legend>
          {WHERES.map((w) => choice(GROUP.where, w, where, setWhere, t(WHERE_LABEL[w])))}
          <TextField
            label={t('pages.insert.page')}
            inputMode="numeric"
            value={pageText}
            error={pageOk ? undefined : t('pages.error.page', { max: format.number(pageCount, 0) })}
            onChange={(e) => {
              setPageText(e.currentTarget.value);
            }}
          />
        </fieldset>
        <TextField
          label={t('pages.insert.count')}
          inputMode="numeric"
          value={countText}
          error={countOk ? undefined : t('pages.error.count')}
          onChange={(e) => {
            setCountText(e.currentTarget.value);
          }}
        />
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('pages.insert.size')}</legend>
          {SIZES.map((z) => choice(GROUP.size, z, size, setSize, t(SIZE_LABEL[z])))}
        </fieldset>
        <fieldset className="scale-where" disabled={size === 'neighbour'}>
          <legend className="ui-field-label">{t('pages.insert.orientation')}</legend>
          {ORIENTATIONS.map((o) =>
            choice(GROUP.orientation, o, orientation, setOrientation, t(ORIENTATION_LABEL[o])),
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

function MoveDialog({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const pageCount = useDocuments((s) => s.docs[docId]?.meta.pageCount ?? 0);
  const current = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const picked = selectionOf(docId).selected;
  const selection = picked.length > 1 ? picked : [];
  const [scope, setScope] = useState<Scope>({
    kind: selection.length ? 'selection' : 'current',
    custom: '',
  });
  const [where, setWhere] = useState<Where>('before');
  const [pageText, setPageText] = useState('1');
  const r = resolveScope(scope, { pageCount, current, selection });
  const page = Number(pageText);
  const pageOk = Number.isInteger(page) && page >= 1 && page <= pageCount;
  const to =
    r.ok && pageOk ? moveTo(r.pages, where === 'before' ? page - 1 : page, pageCount) : null;
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
  const choice = (w: Where) => (
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
  );
  const rangeError = !r.ok && scope.kind === 'custom' ? RANGE_ERRORS[r.error] : undefined;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeDialog();
      }}
      title={t('pages.move.title')}
      description={t('pages.move.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('pages.move.confirm')}
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={to === null}
          />
          <Button label={t('pages.move.cancel')} onClick={closeDialog} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!r.ok || to === null) return;
          closeDialog();
          void movePages(docId, r.pages, to);
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
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('pages.move.where')}</legend>
          {WHERES.map(choice)}
          <TextField
            label={t('pages.move.page')}
            inputMode="numeric"
            value={pageText}
            error={pageOk ? undefined : t('pages.error.page', { max: format.number(pageCount, 0) })}
            onChange={(e) => {
              setPageText(e.currentTarget.value);
            }}
          />
        </fieldset>
        {r.ok && pageOk && to === null ? (
          <p className="print-note" role="status">
            {t('pages.move.nothing')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Progress of a running page operation, shown after 300 ms (rule 2). */
function ProgressDialog() {
  const { t } = useTranslation();
  const busy = usePages((s) => s.busy);
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
      onOpenChange={() => undefined}
      title={t('pages.progressTitle')}
      description={t(busy.label)}
      closeIcon={<Dismiss20Regular />}
      footer={<Button label={t('pages.cancel')} onClick={cancelPageOp} />}
    >
      <ProgressBar
        label={t('pages.progressName')}
        value={busy.total > 0 ? busy.done / busy.total : null}
      />
      {busy.total > 0 ? (
        <p className="print-note" role="status">
          {t('pages.progress', {
            done: format.number(busy.done, 0),
            total: format.number(busy.total, 0),
          })}
        </p>
      ) : null}
    </Dialog>
  );
}

function SignedDialog() {
  const { t } = useTranslation();
  const docId = usePages((s) => s.signedPrompt);
  if (!docId) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) answerSigned(false);
      }}
      title={t('pages.signed.title')}
      description={t('pages.signed.body')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('pages.signed.ok')}
            variant="primary"
            onClick={() => {
              answerSigned(true);
            }}
          />
          <Button
            label={t('pages.signed.cancel')}
            onClick={() => {
              answerSigned(false);
            }}
          />
        </>
      }
    />
  );
}

function ErrorDialog() {
  const { t } = useTranslation();
  const error = usePages((s) => s.error);
  if (!error) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) dismissPagesError();
      }}
      title={t('pages.errorTitle')}
      description={t(error)}
      closeIcon={<Dismiss20Regular />}
      footer={<Button label={t('pages.dismiss')} variant="primary" onClick={dismissPagesError} />}
    />
  );
}
