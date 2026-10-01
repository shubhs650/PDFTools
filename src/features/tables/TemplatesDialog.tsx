import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { RpcError } from '../../engine/errors';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, Dialog, TextField } from '../../ui/components';
import { DENIED } from '../../workers/work/permissionGate';
import type { TableFormat } from '../../workers/work/tables/job';
import { baseNameOf } from '../extract/exportJob';
import { resolveScope, type Scope, type ScopeKind } from '../extract/scope';
import { writeTables } from './expressExtract';
import { addGrids, enterReview, reviewStore } from './reviewStore';
import {
  closeTemplates,
  deleteTemplate,
  renameTemplate,
  templateGrids,
  useTemplates,
} from './templateStore';

type Problem =
  | 'empty'
  | 'syntax'
  | 'outOfRange'
  | 'noSelection'
  | 'noneFit'
  | 'denied'
  | 'failed'
  | 'noDocument';

const PROBLEMS: Record<Problem, MessageKey> = {
  empty: msg('export.error.empty'),
  syntax: msg('export.error.syntax'),
  outOfRange: msg('export.error.outOfRange'),
  noSelection: msg('export.error.noSelection'),
  noneFit: msg('tables.templates.noneFit'),
  denied: msg('export.error.denied'),
  failed: msg('tables.templates.failed'),
  noDocument: msg('export.error.noDocument'),
};

const pageList = (pages: readonly number[]) =>
  format.list(pages.map((p) => format.number(p + 1, 0)));

/**
 * Table Templates (M4-15): the saved templates (rename, delete) and applying
 * one to a page range — as tables in Review & Extract or straight to a file.
 * Pages of another size or rotation are skipped and named.
 */
export function TemplatesDialog() {
  const docId = useTemplates((s) => s.dialogDoc);
  if (!docId) return null;
  return <Form key={docId} docId={docId} />;
}

function Form({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const templates = useTemplates((s) => s.templates);
  const loaded = useTemplates((s) => s.loaded);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: 'all', custom: '' });
  const [fmt, setFmt] = useState<TableFormat>('xlsx');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [busy, setBusy] = useState<AbortController | null>(null);
  const selected = templates.find((x) => x.id === chosen) ?? templates[0];

  /** The template's grids on the chosen pages and those skipped, or null (the problem is shown). */
  const grids = () => {
    const d = documentStore.getState().docs[docId];
    if (!d || !selected) {
      setProblem('noDocument');
      return null;
    }
    const pages = resolveScope(scope, { pageCount: d.meta.pageCount, current: d.view.page });
    if (!pages.ok) {
      setProblem(pages.error);
      return null;
    }
    const r = templateGrids(docId, selected.id, pages.pages);
    setSkipped(r.skipped);
    if (!r.grids.length) {
      setProblem('noneFit');
      return null;
    }
    setProblem(null);
    return r;
  };

  const toReview = () => {
    const r = grids();
    if (!r) return;
    if (reviewStore.getState().docId !== docId) enterReview(docId, false);
    addGrids(r.grids);
    closeTemplates();
  };

  const toFile = async () => {
    const r = grids();
    const d = documentStore.getState().docs[docId];
    if (!r || !d) return;
    const controller = new AbortController();
    setBusy(controller);
    try {
      const written = await writeTables(
        docId,
        baseNameOf(d.meta.name),
        { grids: r.grids },
        fmt,
        controller.signal,
      );
      // Skipped pages stay listed until the dialog is closed.
      if (written && !r.skipped.length) closeTemplates();
    } catch (err) {
      if (!controller.signal.aborted) {
        const denied = err instanceof RpcError && err.code.startsWith(DENIED);
        if (!denied) recordError('tables.templates.export', err);
        setProblem(denied ? 'denied' : 'failed');
      }
    } finally {
      setBusy(null);
    }
  };

  const scopeRadio = (kind: ScopeKind, label: string) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-scope`}
        checked={scope.kind === kind}
        disabled={!!busy}
        onChange={() => {
          setScope((s) => ({ ...s, kind }));
        }}
      />
      {label}
    </label>
  );
  const formatRadio = (value: TableFormat, label: string) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-format`}
        checked={fmt === value}
        disabled={!!busy}
        onChange={() => {
          setFmt(value);
        }}
      />
      {label}
    </label>
  );
  const rangeProblem =
    scope.kind === 'custom' &&
    (problem === 'empty' || problem === 'syntax' || problem === 'outOfRange')
      ? problem
      : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          busy?.abort();
          closeTemplates();
        }
      }}
      title={t('tables.templates.title')}
      description={t('tables.templates.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        busy ? (
          <Button
            key="cancel"
            label={t('tables.templates.cancel')}
            onClick={() => {
              busy.abort();
            }}
          />
        ) : (
          <>
            <Button
              label={t('tables.templates.toReview')}
              disabled={!selected}
              onClick={toReview}
            />
            <Button
              label={t('tables.templates.export')}
              variant="primary"
              disabled={!selected}
              onClick={() => void toFile()}
            />
            <Button label={t('tables.templates.close')} onClick={closeTemplates} />
          </>
        )
      }
    >
      <div className="scale-form">
        {loaded && templates.length === 0 ? (
          <p className="print-note">{t('tables.templates.empty')}</p>
        ) : null}
        {templates.length ? (
          <fieldset className="scale-where">
            <legend className="ui-field-label">{t('tables.templates.legend')}</legend>
            {templates.map((tp) => (
              <label key={tp.id} className="scale-radio">
                <input
                  type="radio"
                  name={`${ids}-template`}
                  checked={selected?.id === tp.id}
                  disabled={!!busy}
                  onChange={() => {
                    setChosen(tp.id);
                    setName(null);
                  }}
                />
                {t('tables.templates.item', {
                  name: tp.name,
                  width: format.number(tp.page.width, 0),
                  height: format.number(tp.page.height, 0),
                  rows: format.number(tp.rows.length - 1, 0),
                  cols: format.number(tp.cols.length - 1, 0),
                })}
              </label>
            ))}
          </fieldset>
        ) : null}
        {selected ? (
          <div className="table-template-edit">
            <TextField
              label={t('tables.templates.name')}
              value={name ?? selected.name}
              disabled={!!busy}
              onChange={(e) => {
                setName(e.currentTarget.value);
              }}
            />
            <Button
              label={t('tables.templates.rename')}
              disabled={!!busy || !name?.trim() || name.trim() === selected.name}
              onClick={() => {
                if (name) void renameTemplate(selected.id, name);
                setName(null);
              }}
            />
            <Button
              label={t('tables.templates.delete', { name: selected.name })}
              disabled={!!busy}
              onClick={() => {
                void deleteTemplate(selected.id);
                setChosen(null);
                setName(null);
              }}
            />
          </div>
        ) : null}
        {selected ? (
          <>
            <fieldset className="scale-where">
              <legend className="ui-field-label">{t('tables.templates.pages')}</legend>
              {scopeRadio('all', t('export.scope.all'))}
              {scopeRadio('current', t('export.scope.current'))}
              {scopeRadio('custom', t('export.scope.custom'))}
              {scope.kind === 'custom' ? (
                <TextField
                  label={t('export.scope.customLabel')}
                  placeholder={t('export.scope.customHint')}
                  value={scope.custom}
                  disabled={!!busy}
                  error={rangeProblem ? t(PROBLEMS[rangeProblem]) : undefined}
                  onChange={(e) => {
                    const custom = e.currentTarget.value;
                    setScope({ kind: 'custom', custom });
                  }}
                />
              ) : null}
            </fieldset>
            <fieldset className="scale-where">
              <legend className="ui-field-label">{t('tables.express.format')}</legend>
              {formatRadio('xlsx', t('tables.express.xlsx'))}
              {formatRadio('csv', t('tables.express.csv'))}
            </fieldset>
          </>
        ) : null}
        {skipped.length ? (
          <p className="print-note" role="status">
            {t('tables.templates.skipped', { count: skipped.length, list: pageList(skipped) })}
          </p>
        ) : null}
        {problem && !rangeProblem ? (
          <p className="print-error" role="alert">
            {t(PROBLEMS[problem], { what: t('protect.capability.copy') })}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
