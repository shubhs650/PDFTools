import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, type MessageKey } from '../../i18n';
import type { CrsTemplate } from '../../model/crs/template';
import { Button, Dialog, ProgressBar, TextField } from '../../ui/components';
import { activeScheme } from '../stamps/schemes/schemeStore';
import { stampStore } from '../stamps/stampStore';
import { cancelCrs, closeCrs, startCrs, useCrs, type CrsOptions } from './crsExport';
import { STANDARD_TEMPLATE, useCrsTemplates } from './templates/crsTemplateStore';
import { startTemplateCrs } from './templates/templateExportFlow';
import { prefillDetails, type DocDetails } from './templates/templateSheets';
import { openTemplateManager, useTemplateUi } from './templates/templateUi';

/**
 * Comment → Export CRS (M3-19, D-15, §7.5; M13-08, D-71): the template (the
 * Standard CRS or a project template, last used selected), the documents to
 * include (a project template takes several, C15), their details (prefilled
 * from last time, the stamps or the template's file-name rule, C10; always
 * editable), which comments, snapshots and format; then progress with Cancel
 * while the Work worker builds the workbook.
 */
export function CrsDialog() {
  const initial = useCrs((s) => s.initial);
  const docId = useCrs((s) => s.docId);
  if (!initial || !docId) return null;
  return <CrsForm key={docId} docId={docId} initial={initial} />;
}

type DocFields = Pick<DocDetails, 'docNumber' | 'revision' | 'title'>;

/** Open documents that can be exported (tabs, not a comparison's notes). */
function useOpenDocs(): { id: string; name: string }[] {
  const order = useDocuments((s) => s.order);
  const docs = useDocuments((s) => s.docs);
  return useMemo(
    () =>
      order.flatMap((id) => {
        const d = docs[id];
        return d && d.meta.role !== 'notes' ? [{ id, name: d.meta.name }] : [];
      }),
    [order, docs],
  );
}

function CrsForm({ docId, initial }: { docId: string; initial: CrsOptions }) {
  const { t } = useTranslation();
  const ids = useId();
  const running = useCrs((s) => s.running);
  const error = useCrs((s) => s.error);
  const templates = useCrsTemplates((s) => s.templates);
  const loaded = useCrsTemplates((s) => s.loaded);
  const lastUsed = useCrsTemplates((s) => s.lastUsed);
  const saved = useTemplateUi((s) => s.saved);
  const openDocs = useOpenDocs();
  const [o, setO] = useState(initial);
  // The person's pick; a template set up meanwhile (`saved`) takes over from it.
  const [pick, setPick] = useState<{ id: string; saved: string | null } | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set([docId]));
  const [edits, setEdits] = useState<Record<string, Partial<DocFields>>>({});
  const [ignore, setIgnore] = useState<{ id: string; on: boolean } | null>(null);

  // A template just set up, else the person's pick, else the last used once the list is read.
  const wanted =
    pick?.saved === saved
      ? pick.id
      : saved && templates.some((x) => x.id === saved)
        ? saved
        : loaded
          ? lastUsed
          : STANDARD_TEMPLATE;
  // A template deleted meanwhile: the Standard CRS.
  const chosen = templates.some((x) => x.id === wanted) ? wanted : STANDARD_TEMPLATE;
  const tpl: CrsTemplate | undefined = templates.find((x) => x.id === chosen);
  const isTemplate = tpl !== undefined;

  const set = <K extends keyof CrsOptions>(k: K, v: CrsOptions[K]): void => {
    setO((p) => ({ ...p, [k]: v }));
  };
  const scheme = activeScheme();
  const schemeName = scheme.nameKey ? t(scheme.nameKey as MessageKey) : (scheme.name ?? '');

  /** A document's detail values: typed ones, else the template's prefill (C10). */
  const fieldsOf = (id: string, name: string): DocFields => {
    const info = stampStore.getState().docInfo[id];
    const fallback: DocDetails =
      id === docId
        ? {
            docNumber: initial.docNumber,
            revision: initial.revision,
            title: initial.title,
            reviewer: o.reviewer,
            reviewDate: o.date,
          }
        : {
            docNumber: info?.docNo ?? '',
            revision: info?.rev ?? '',
            title: name.replace(/\.pdf$/iu, ''),
            reviewer: o.reviewer,
            reviewDate: o.date,
          };
    const pre = tpl ? prefillDetails(tpl, name, fallback) : fallback;
    const e = edits[id] ?? {};
    return {
      docNumber: e.docNumber ?? pre.docNumber,
      revision: e.revision ?? pre.revision,
      title: e.title ?? pre.title,
    };
  };
  const edit = (id: string, k: keyof DocFields, v: string) => {
    setEdits((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  };

  const included = isTemplate ? openDocs.filter((d) => picked.has(d.id)) : [];
  const snapshotsPossible = !isTemplate || tpl.columns.some((c) => c.field === 'snapshot' && c.on);
  const ignoreHighlights = ignore?.id === chosen ? ignore.on : (tpl?.ignoreHighlights ?? true);

  const submit = () => {
    if (!tpl) {
      void startCrs(o);
      return;
    }
    const docs = included.map((d) => ({
      docId: d.id,
      details: { ...fieldsOf(d.id, d.name), reviewer: o.reviewer, reviewDate: o.date },
    }));
    void startTemplateCrs(tpl.id, docs, {
      scope: o.scope,
      ignoreHighlights,
      snapshots: o.snapshots,
      format: o.format,
    });
  };

  const radio = <K extends 'scope' | 'format'>(k: K, v: CrsOptions[K], label: string) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-${k}`}
        checked={o[k] === v}
        disabled={!!running}
        onChange={() => {
          set(k, v);
        }}
      />
      {label}
    </label>
  );
  const field = (k: 'docNumber' | 'revision' | 'title' | 'reviewer' | 'date', label: string) => (
    <TextField
      label={label}
      value={o[k]}
      disabled={!!running}
      onChange={(e) => {
        set(k, e.currentTarget.value);
      }}
    />
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeCrs();
      }}
      title={t('crs.title')}
      description={t('crs.description')}
      closeIcon={<Dismiss20Regular />}
      className={isTemplate ? 'crs-dialog crs-dialog--template' : 'crs-dialog'}
      footer={
        running ? (
          // Its own node (key): a reused submit button would submit the form again.
          <Button key="cancel" label={t('crs.cancel')} onClick={cancelCrs} />
        ) : (
          <>
            <Button
              label={t('crs.export')}
              variant="primary"
              type="submit"
              form={`${ids}-form`}
              disabled={isTemplate && included.length === 0}
            />
            <Button label={t('crs.close')} onClick={closeCrs} />
          </>
        )
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="crs-template-pick">
          <div className="ui-field">
            <label className="ui-field-label" htmlFor={`${ids}-template`}>
              {t('crs.template')}
            </label>
            <select
              id={`${ids}-template`}
              className="ui-field-input"
              value={chosen}
              disabled={!!running}
              onChange={(e) => {
                setPick({ id: e.currentTarget.value, saved });
              }}
            >
              <option value={STANDARD_TEMPLATE}>{t('crs.standard')}</option>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            label={t('crs.manageTemplates')}
            disabled={!!running}
            onClick={openTemplateManager}
          />
        </div>
        {isTemplate ? (
          <p className="print-note" data-testid="crs-template-summary">
            {tpl.sheetPerPage
              ? t('crs.templateSummaryPerPage', {
                  sheet: tpl.sheet,
                  row: format.number(tpl.startRow, 0),
                })
              : t('crs.templateSummary', {
                  sheet: tpl.sheet,
                  row: format.number(tpl.startRow, 0),
                })}
          </p>
        ) : loaded && templates.length === 0 ? (
          <p className="print-note">{t('crs.templateHint')}</p>
        ) : null}

        {isTemplate ? (
          <>
            <fieldset className="scale-where crs-docs">
              <legend className="ui-field-label">{t('crs.documents')}</legend>
              {openDocs.map((d) => (
                <label key={d.id} className="scale-radio">
                  <input
                    type="checkbox"
                    checked={picked.has(d.id)}
                    disabled={!!running}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setPicked((p) => {
                        const next = new Set(p);
                        if (on) next.add(d.id);
                        else next.delete(d.id);
                        return next;
                      });
                    }}
                  />
                  {d.name}
                </label>
              ))}
              {openDocs.length > 1 ? <p className="print-note">{t('crs.documentsNote')}</p> : null}
            </fieldset>
            {included.map((d) => {
              const f = fieldsOf(d.id, d.name);
              return (
                <fieldset key={d.id} className="crs-doc-details">
                  <legend className="ui-field-label">
                    {included.length > 1 ? t('crs.detailsOf', { name: d.name }) : t('crs.details')}
                  </legend>
                  <TextField
                    label={t('crs.docNumber')}
                    value={f.docNumber}
                    disabled={!!running}
                    onChange={(e) => {
                      edit(d.id, 'docNumber', e.currentTarget.value);
                    }}
                  />
                  <TextField
                    label={t('crs.revision')}
                    value={f.revision}
                    disabled={!!running}
                    onChange={(e) => {
                      edit(d.id, 'revision', e.currentTarget.value);
                    }}
                  />
                  <TextField
                    className="crs-doc-title"
                    label={t('crs.docTitle')}
                    value={f.title}
                    disabled={!!running}
                    onChange={(e) => {
                      edit(d.id, 'title', e.currentTarget.value);
                    }}
                  />
                </fieldset>
              );
            })}
            <div className="crs-doc-shared">
              {field('reviewer', t('crs.reviewer'))}
              {field('date', t('crs.date'))}
            </div>
          </>
        ) : (
          <>
            {field('docNumber', t('crs.docNumber'))}
            {field('revision', t('crs.revision'))}
            {field('title', t('crs.docTitle'))}
            {field('reviewer', t('crs.reviewer'))}
            {field('date', t('crs.date'))}
          </>
        )}
        <p className="print-note">{t('crs.scheme', { name: schemeName })}</p>
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('crs.scope')}</legend>
          {radio('scope', 'all', isTemplate ? t('crs.scopeTemplate') : t('crs.scopeAll'))}
          {radio('scope', 'filtered', t('crs.scopeFiltered'))}
        </fieldset>
        {isTemplate ? (
          <label className="scale-radio">
            <input
              type="checkbox"
              checked={ignoreHighlights}
              disabled={!!running}
              onChange={(e) => {
                setIgnore({ id: chosen, on: e.currentTarget.checked });
              }}
            />
            {t('crs.ignoreHighlights')}
          </label>
        ) : null}
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('crs.format')}</legend>
          {radio('format', 'xlsx', t('crs.xlsx'))}
          {radio('format', 'csv', t('crs.csv'))}
        </fieldset>
        {snapshotsPossible ? (
          <label className="scale-radio">
            <input
              type="checkbox"
              checked={o.snapshots && o.format === 'xlsx'}
              disabled={!!running || o.format === 'csv'}
              onChange={(e) => {
                set('snapshots', e.currentTarget.checked);
              }}
            />
            {t('crs.snapshots')}
          </label>
        ) : null}
        {running ? (
          <>
            <ProgressBar
              label={t('crs.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {t('crs.progress', {
                done: format.number(running.done, 0),
                total: format.number(running.total, 0),
              })}
            </p>
          </>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {error === 'empty' ? t('crs.empty') : t('crs.failed')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
