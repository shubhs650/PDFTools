import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recordError } from '../../../app/diagnostics';
import { format, msg, type MessageKey } from '../../../i18n';
import { downloadBytes } from '../../../storage/fileAccess';
import { Button, Dialog, TextField } from '../../../ui/components';
import {
  deleteCrsTemplate,
  duplicateCrsTemplate,
  exportTemplateFile,
  importTemplateFile,
  renameCrsTemplate,
  useCrsTemplates,
} from './crsTemplateStore';
import {
  closeTemplateManager,
  editTemplate,
  importWorkbook,
  useTemplateUi,
  type RefusedKind,
} from './templateUi';

const REFUSED: Record<RefusedKind, MessageKey> = {
  macro: msg('crs.refused.macro'),
  binary: msg('crs.refused.binary'),
  ole: msg('crs.refused.ole'),
  'not-a-workbook': msg('crs.refused.notWorkbook'),
  unreadable: msg('crs.refused.unreadable'),
};

const FILE_REFUSED: Record<'not-template' | 'newer' | 'damaged', MessageKey> = {
  'not-template': msg('crs.tplFile.notTemplate'),
  newer: msg('crs.tplFile.newer'),
  damaged: msg('crs.tplFile.damaged'),
};

const JSON_TYPE = 'application/json';

/** Where a failure is recorded (codes only, rule 10). */
const WHERE = {
  delete: 'crs.templateDelete',
  edit: 'crs.templateEdit',
  duplicate: 'crs.templateDuplicate',
  fileExport: 'crs.templateFileExport',
  fileImport: 'crs.templateFileImport',
  rename: 'crs.templateRename',
} as const;

/**
 * The CRS template manager (M13-08, D-71, plan M13 §6 "Setting up", C13,
 * C14), opened from the export dialog and from Settings: the project
 * templates kept on this device with Edit (the guided steps), Duplicate,
 * Rename, Delete and Export template file; Import an Excel form (the guided
 * steps follow) and Import template file.
 */
export function TemplateManager() {
  const open = useTemplateUi((s) => s.manager);
  const setup = useTemplateUi((s) => s.setup);
  // The set-up takes over while it is open; the list comes back after it.
  if (!open || setup) return null;
  return <ManagerWindow />;
}

function ManagerWindow() {
  const { t } = useTranslation();
  const templates = useCrsTemplates((s) => s.templates);
  const loaded = useCrsTemplates((s) => s.loaded);
  const busy = useTemplateUi((s) => s.busy);
  const [message, setMessage] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // The rename field and the delete question's Keep take focus when they appear.
  const focusOnMount = useCallback((el: HTMLElement | null) => {
    el?.focus();
  }, []);

  /** Runs an action; a failure is recorded as a code (rule 10) and named in the message. */
  const act = (p: Promise<unknown>, record: (err: unknown) => void) => {
    p.catch((err: unknown) => {
      record(err);
      setMessage(t('crs.manager.failed'));
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeTemplateManager();
      }}
      title={t('crs.manager.title')}
      description={t('crs.manager.description')}
      closeIcon={<Dismiss20Regular />}
      className="crs-manager-dialog"
      footer={<Button label={t('crs.manager.close')} onClick={closeTemplateManager} />}
    >
      <div className="crs-manager" data-testid="crs-manager">
        <div className="crs-manager-actions">
          <label className="ui-button ui-button--primary crs-manager-import">
            {t('crs.manager.importWorkbook')}
            <input
              type="file"
              accept=".xlsx,.xltx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.spreadsheetml.template"
              className="ui-visually-hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!file) return;
                setMessage(t('crs.manager.reading'));
                void importWorkbook(file).then((refused) => {
                  setMessage(refused ? t(REFUSED[refused]) : '');
                });
              }}
            />
          </label>
          <label className="ui-button crs-manager-import">
            {t('crs.manager.importFile')}
            <input
              type="file"
              accept=".json,application/json"
              className="ui-visually-hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!file) return;
                act(
                  file
                    .arrayBuffer()
                    .then((b) => importTemplateFile(b))
                    .then((r) => {
                      setMessage(
                        r.ok
                          ? t('crs.manager.imported', { name: r.template.name })
                          : t(FILE_REFUSED[r.reason]),
                      );
                    }),
                  (err) => {
                    recordError(WHERE.fileImport, err);
                  },
                );
              }}
            />
          </label>
        </div>
        <p className="print-note">{t('crs.manager.importNote')}</p>
        {loaded && templates.length === 0 ? (
          <p className="crs-manager-empty">{t('crs.manager.empty')}</p>
        ) : null}
        <ul className="crs-manager-list" aria-label={t('crs.manager.listName')}>
          {templates.map((tpl) => (
            <li key={tpl.id} className="crs-manager-item" data-testid="crs-template-item">
              {renaming?.id === tpl.id ? (
                <form
                  className="crs-manager-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = renaming.name;
                    setRenaming(null);
                    act(renameCrsTemplate(tpl.id, name), (err) => {
                      recordError(WHERE.rename, err);
                    });
                  }}
                >
                  <TextField
                    label={t('crs.manager.newName')}
                    ref={focusOnMount}
                    value={renaming.name}
                    onChange={(e) => {
                      setRenaming({ id: tpl.id, name: e.currentTarget.value });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                  <Button
                    size="small"
                    type="submit"
                    variant="primary"
                    label={t('crs.manager.renameSave')}
                  />
                  <Button
                    size="small"
                    label={t('crs.manager.renameCancel')}
                    onClick={() => {
                      setRenaming(null);
                    }}
                  />
                </form>
              ) : (
                <div className="crs-manager-head">
                  <span className="crs-manager-name">{tpl.name}</span>
                  <span className="crs-manager-meta">
                    {t('crs.manager.meta', {
                      sheet: tpl.sheet,
                      row: format.number(tpl.startRow, 0),
                      fields: format.number(tpl.columns.filter((c) => c.on).length, 0),
                      date: format.date(tpl.modified),
                    })}
                  </span>
                  {tpl.fileName ? (
                    <span className="crs-manager-meta">
                      {t('crs.manager.file', { file: tpl.fileName })}
                    </span>
                  ) : null}
                </div>
              )}
              {deleting === tpl.id ? (
                <div
                  className="crs-manager-confirm"
                  role="group"
                  aria-label={t('crs.manager.deleteAsk', { name: tpl.name })}
                >
                  <span>{t('crs.manager.deleteAsk', { name: tpl.name })}</span>
                  <Button
                    size="small"
                    label={t('crs.manager.deleteYes')}
                    onClick={() => {
                      setDeleting(null);
                      act(deleteCrsTemplate(tpl.id), (err) => {
                        recordError(WHERE.delete, err);
                      });
                      setMessage(t('crs.manager.deleted', { name: tpl.name }));
                    }}
                  />
                  <Button
                    ref={focusOnMount}
                    size="small"
                    variant="primary"
                    label={t('crs.manager.deleteNo')}
                    onClick={() => {
                      setDeleting(null);
                    }}
                  />
                </div>
              ) : (
                <div className="crs-manager-buttons">
                  <Button
                    size="small"
                    label={t('crs.manager.edit')}
                    aria-label={t('crs.manager.editNamed', { name: tpl.name })}
                    disabled={busy}
                    onClick={() => {
                      act(
                        editTemplate(tpl.id).then((ok) => {
                          if (!ok) setMessage(t('crs.refused.unreadable'));
                        }),
                        (err) => {
                          recordError(WHERE.edit, err);
                        },
                      );
                    }}
                  />
                  <Button
                    size="small"
                    label={t('crs.manager.rename')}
                    aria-label={t('crs.manager.renameNamed', { name: tpl.name })}
                    onClick={() => {
                      setRenaming({ id: tpl.id, name: tpl.name });
                    }}
                  />
                  <Button
                    size="small"
                    label={t('crs.manager.duplicate')}
                    aria-label={t('crs.manager.duplicateNamed', { name: tpl.name })}
                    onClick={() => {
                      act(
                        duplicateCrsTemplate(tpl.id).then((copy) => {
                          if (copy) setMessage(t('crs.manager.duplicated', { name: copy.name }));
                        }),
                        (err) => {
                          recordError(WHERE.duplicate, err);
                        },
                      );
                    }}
                  />
                  <Button
                    size="small"
                    label={t('crs.manager.export')}
                    aria-label={t('crs.manager.exportNamed', { name: tpl.name })}
                    onClick={() => {
                      act(
                        exportTemplateFile(tpl.id).then((f) => {
                          if (!f) return;
                          downloadBytes(new Blob([f.bytes], { type: JSON_TYPE }), f.name);
                          setMessage(t('crs.manager.exported', { name: tpl.name }));
                        }),
                        (err) => {
                          recordError(WHERE.fileExport, err);
                        },
                      );
                    }}
                  />
                  <Button
                    size="small"
                    label={t('crs.manager.delete')}
                    aria-label={t('crs.manager.deleteNamed', { name: tpl.name })}
                    onClick={() => {
                      setDeleting(tpl.id);
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="crs-manager-message" role="status">
          {message}
        </p>
      </div>
    </Dialog>
  );
}
