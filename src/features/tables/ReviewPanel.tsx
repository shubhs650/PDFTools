import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { bbox, colCount, rowCount } from '../../model/tableGrid';
import { Button, IconButton, ProgressBar, TextField } from '../../ui/components';
import type { TableFormat } from '../../workers/work/tables/job';
import { frameOf } from '../measure/viewports';
import { goToPoint } from '../view/controller';
import { ordered } from './reviewModel';
import {
  cancelDetect,
  cancelKeyRect,
  cancelReviewExport,
  detect,
  dispatchReview,
  exitReview,
  announceReview,
  exportReview,
  focusDividers,
  gridOf,
  selectTable,
  setReviewTool,
  startKeyRect,
  useReview,
  type ReviewError,
} from './reviewStore';
import { TablePreview } from './TablePreview';
import { openTemplates, saveTemplate } from './templateStore';

const ERRORS: Record<ReviewError, MessageKey> = {
  denied: msg('export.error.denied'),
  failed: msg('tables.review.failed'),
};

/**
 * Review & Extract's side panel (M4-14): find tables on the current page,
 * draw one, the tables per page (select, include, delete), the selected
 * table's cells, undo/redo within the mode, and the export.
 */
export function ReviewPanel() {
  const docId = useReview((s) => s.docId);
  const activeId = useDocuments((s) => s.activeId);
  if (!docId || docId !== activeId) return null;
  return <Panel docId={docId} />;
}

function Panel({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const page = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const tables = useReview((s) => s.doc.tables);
  const canUndo = useReview((s) => s.doc.past.length > 0);
  const canRedo = useReview((s) => s.doc.future.length > 0);
  const selectedId = useReview((s) => s.selectedId);
  const selectedGrid = useReview((s) => (s.selectedId ? gridOf(s, s.selectedId) : null));
  const tool = useReview((s) => s.tool);
  const detecting = useReview((s) => s.detecting);
  const exporting = useReview((s) => s.exporting);
  const error = useReview((s) => s.error);
  const announcement = useReview((s) => s.announcement);
  const [fmt, setFmt] = useState<TableFormat>('xlsx');
  const [templateName, setTemplateName] = useState('');
  const list = ordered(tables);
  const accepted = list.filter((x) => x.accepted).length;
  const perPage = new Map<number, number>();
  const busy = !!detecting || exporting;
  // Through the commands, as Ctrl+Z / Ctrl+Y (the mode's own history while it is on).
  const undo = () => void runCommand('qat.undo');
  const redo = () => void runCommand('qat.redo');

  const reveal = (id: string) => {
    selectTable(id);
    const tb = tables.find((x) => x.id === id);
    if (!tb) return;
    const f = frameOf(docId, tb.grid.page);
    const [x0, , , y1] = bbox(tb.grid);
    goToPoint(tb.grid.page, x0 - f.originX, f.originY + f.height - y1);
  };

  const draw = (keyboard: boolean) => {
    if (tool === 'draw') {
      cancelKeyRect();
      setReviewTool('adjust');
      return;
    }
    setReviewTool('draw');
    if (!keyboard) return;
    const f = frameOf(docId, page);
    const size = { width: f.width, height: f.height };
    startKeyRect(page, size, { x: f.originX, y: f.originY });
  };

  const radio = (value: TableFormat, label: string) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-format`}
        checked={fmt === value}
        disabled={busy}
        onChange={() => {
          setFmt(value);
        }}
      />
      {label}
    </label>
  );

  return (
    <aside aria-labelledby={`${ids}-title`} className="properties-pane table-review-panel">
      <div className="pane-header">
        <h2 id={`${ids}-title`} className="pane-title">
          {t('tables.review.title')}
        </h2>
        <IconButton
          label={t('tables.review.close')}
          icon={<Dismiss20Regular />}
          size="small"
          tooltip={false}
          onClick={exitReview}
        />
      </div>
      <div className="table-review-body">
        <p className="print-note">{t('tables.review.beta')}</p>
        <div className="table-review-tools" role="group" aria-label={t('tables.review.tools')}>
          <Button
            label={t('tables.review.findOnPage', { n: format.number(page + 1, 0) })}
            disabled={busy}
            onClick={() => void detect([page])}
          />
          <Button
            label={t('tables.review.draw')}
            aria-pressed={tool === 'draw'}
            onClick={(e) => {
              // Keyboard activation (no pointer: detail 0) also starts the keyboard rectangle (M4-Q10).
              draw(e.detail === 0);
            }}
          />
          <Button label={t('tables.review.undo')} disabled={!canUndo} onClick={undo} />
          <Button label={t('tables.review.redo')} disabled={!canRedo} onClick={redo} />
        </div>
        {tool === 'draw' ? <p className="print-note">{t('tables.review.drawHelp')}</p> : null}
        {detecting ? (
          <>
            <ProgressBar
              label={t('tables.review.progressName')}
              value={detecting.total > 0 ? detecting.done / detecting.total : null}
            />
            <Button label={t('tables.review.cancel')} onClick={cancelDetect} />
          </>
        ) : null}
        <h3 className="table-review-heading">
          {t('tables.review.tables', { count: list.length, n: format.number(list.length, 0) })}
        </h3>
        {list.length === 0 && !detecting ? (
          <p className="print-note">{t('tables.review.empty')}</p>
        ) : null}
        <ul className="table-review-list">
          {list.map((tb) => {
            const k = (perPage.get(tb.grid.page) ?? 0) + 1;
            perPage.set(tb.grid.page, k);
            const name = t('tables.review.item', {
              page: format.number(tb.grid.page + 1, 0),
              k: format.number(k, 0),
              rows: format.number(rowCount(tb.grid), 0),
              cols: format.number(colCount(tb.grid), 0),
            });
            const isSel = tb.id === selectedId;
            return (
              <li key={tb.id} className="table-review-item" data-selected={isSel || undefined}>
                <button
                  type="button"
                  className="table-review-select"
                  aria-pressed={isSel}
                  data-review-selected={isSel || undefined}
                  onClick={() => {
                    reveal(tb.id);
                  }}
                >
                  {name}
                </button>
                <label className="scale-radio">
                  <input
                    type="checkbox"
                    checked={tb.accepted}
                    aria-label={t('tables.review.include', { name })}
                    onChange={(e) => {
                      dispatchReview({
                        type: 'accept',
                        id: tb.id,
                        accepted: e.currentTarget.checked,
                      });
                    }}
                  />
                  {t('tables.review.includeShort')}
                </label>
                <IconButton
                  label={t('tables.review.delete', { name })}
                  icon={<Delete20Regular />}
                  size="small"
                  tooltip={false}
                  onClick={() => {
                    dispatchReview({ type: 'remove', id: tb.id });
                  }}
                />
              </li>
            );
          })}
        </ul>
        {selectedId && selectedGrid ? (
          <>
            <Button label={t('tables.review.editDividers')} onClick={focusDividers} />
            <form
              className="table-template-edit"
              onSubmit={(e) => {
                e.preventDefault();
                const name = templateName.trim();
                if (!name) return;
                void saveTemplate(docId, selectedGrid, name).then((tp) => {
                  if (tp) announceReview(t('tables.review.templateSaved', { name: tp.name }));
                });
                setTemplateName('');
              }}
            >
              <TextField
                label={t('tables.review.templateName')}
                value={templateName}
                onChange={(e) => {
                  setTemplateName(e.currentTarget.value);
                }}
              />
              <Button
                label={t('tables.review.saveTemplate')}
                type="submit"
                disabled={!templateName.trim()}
              />
            </form>
            <p className="print-note">{t('tables.review.dividerHelp')}</p>
            <TablePreview id={selectedId} grid={selectedGrid} />
          </>
        ) : null}
        <Button
          label={t('tables.review.templates')}
          onClick={() => {
            openTemplates(docId);
          }}
        />
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('tables.express.format')}</legend>
          {radio('xlsx', t('tables.express.xlsx'))}
          {radio('csv', t('tables.express.csv'))}
        </fieldset>
        <div className="table-review-tools">
          <Button
            label={t('tables.review.acceptAll')}
            disabled={busy || list.length === 0 || accepted === list.length}
            onClick={() => {
              dispatchReview({ type: 'acceptAll' });
            }}
          />
          {exporting ? (
            <Button label={t('tables.review.cancel')} onClick={cancelReviewExport} />
          ) : (
            <Button
              label={t('tables.review.export', { count: accepted, n: format.number(accepted, 0) })}
              variant="primary"
              disabled={busy || accepted === 0}
              onClick={() => void exportReview(fmt)}
            />
          )}
        </div>
        {error ? (
          <p className="print-error" role="alert">
            {t(ERRORS[error], { what: t('protect.capability.copy') })}
          </p>
        ) : null}
        <div className="ui-visually-hidden" role="status" aria-live="polite">
          {announcement}
        </div>
      </div>
    </aside>
  );
}
