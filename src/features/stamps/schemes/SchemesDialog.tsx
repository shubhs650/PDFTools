import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { uuidV4 } from '@embedpdf/models';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../../i18n';
import {
  contrastOnWhite,
  duplicateScheme,
  exportScheme,
  importScheme,
  LIMITS,
  MAX_CODES,
  validateScheme,
  type SchemeError,
  type StatusCode,
  type StatusScheme,
} from '../../../model/statusScheme';
import { downloadBytes } from '../../../storage/fileAccess';
import { Button, ColorPicker, Dialog, TextField } from '../../../ui/components';
import {
  allSchemes,
  closeSchemes,
  deleteScheme,
  saveScheme,
  setActiveScheme,
  useSchemes,
} from './schemeStore';

const ERRORS: Record<SchemeError, MessageKey> = {
  name: msg('schemes.error.name'),
  noCodes: msg('schemes.error.noCodes'),
  tooManyCodes: msg('schemes.error.tooManyCodes'),
  code: msg('schemes.error.code'),
  label: msg('schemes.error.label'),
  color: msg('schemes.error.color'),
  duplicate: msg('schemes.error.duplicate'),
  tooLarge: msg('schemes.error.tooLarge'),
  json: msg('schemes.error.json'),
  format: msg('schemes.error.format'),
  version: msg('schemes.error.version'),
  unknownKey: msg('schemes.error.unknownKey'),
  codes: msg('schemes.error.codes'),
};

const JSON_TYPE = 'application/json';
const FALLBACK_FILE = 'scheme';
const FIRST_COLOR = '#1e7a34';
const NEXT_COLOR = '#1f5fa8';

/** Comment → Status Schemes (M3-13, D-23): choose, make, edit, export and import schemes. */
export function SchemesDialog() {
  const open = useSchemes((s) => s.dialogOpen);
  if (!open) return null;
  return <SchemesContent />;
}

function SchemesContent() {
  const { t } = useTranslation();
  const state = useSchemes((s) => s);
  const [editing, setEditing] = useState<StatusScheme | null>(null);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const schemes = allSchemes(state);
  const nameOf = (s: StatusScheme): string =>
    s.nameKey ? t(s.nameKey as MessageKey) : (s.name ?? '');
  const labelOf = (c: StatusCode): string =>
    c.labelKey ? t(c.labelKey as MessageKey) : (c.label ?? '');

  if (editing)
    return (
      <SchemeEditor
        scheme={editing}
        onDone={(saved) => {
          setEditing(null);
          if (saved) setMessage(t('schemes.saved', { name: nameOf(saved) }));
        }}
      />
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeSchemes();
      }}
      title={t('schemes.title')}
      description={t('schemes.description')}
      closeIcon={<Dismiss20Regular />}
      footer={<Button label={t('schemes.close')} onClick={closeSchemes} />}
    >
      <div className="schemes" data-testid="schemes-dialog">
        <label htmlFor={`${ids}-active`}>{t('schemes.active')}</label>
        <select
          id={`${ids}-active`}
          className="ui-field-input"
          value={state.activeId}
          onChange={(e) => {
            void setActiveScheme(e.currentTarget.value);
          }}
        >
          {schemes.map((s) => (
            <option key={s.id} value={s.id}>
              {nameOf(s)}
            </option>
          ))}
        </select>
        <ul className="scheme-list" aria-label={t('schemes.list')}>
          {schemes.map((s) => (
            <li key={s.id} className="scheme-item">
              <div className="scheme-head">
                <span className="scheme-name">{nameOf(s)}</span>
                {s.preset ? <span className="scheme-tag">{t('schemes.preset.tag')}</span> : null}
              </div>
              <ul className="scheme-codes" aria-label={t('schemes.codesOf', { name: nameOf(s) })}>
                {s.codes.map((c) => (
                  <li key={c.code}>
                    <span className="scheme-chip" style={{ borderColor: c.color, color: c.color }}>
                      {c.code}
                    </span>{' '}
                    {labelOf(c)}
                  </li>
                ))}
              </ul>
              <div className="scheme-actions">
                <Button
                  size="small"
                  label={t('schemes.duplicate')}
                  aria-label={t('schemes.duplicateNamed', { name: nameOf(s) })}
                  onClick={() => {
                    setEditing(
                      duplicateScheme(
                        s,
                        uuidV4(),
                        (k) => t(k as MessageKey),
                        t('schemes.copyOf', { name: nameOf(s) }),
                      ),
                    );
                  }}
                />
                {s.preset ? null : (
                  <>
                    <Button
                      size="small"
                      label={t('schemes.edit')}
                      aria-label={t('schemes.editNamed', { name: nameOf(s) })}
                      onClick={() => {
                        setEditing(s);
                      }}
                    />
                    <Button
                      size="small"
                      label={t('schemes.export')}
                      aria-label={t('schemes.exportNamed', { name: nameOf(s) })}
                      onClick={() => {
                        const blob = new Blob([exportScheme(s)], { type: JSON_TYPE });
                        const safe =
                          nameOf(s)
                            .replace(/[^\p{L}\p{N} _-]+/gu, '')
                            .trim() || FALLBACK_FILE;
                        downloadBytes(blob, `${safe}.pdftools-scheme.json`);
                      }}
                    />
                    <Button
                      size="small"
                      label={t('schemes.delete')}
                      aria-label={t('schemes.deleteNamed', { name: nameOf(s) })}
                      onClick={() => {
                        void deleteScheme(s.id);
                      }}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="scheme-new">
          <Button
            label={t('schemes.new')}
            onClick={() => {
              setEditing({
                id: uuidV4(),
                name: '',
                codes: [{ code: '', label: '', color: FIRST_COLOR }],
              });
            }}
          />
          <label className="ui-button scheme-import">
            {t('schemes.import')}
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="ui-visually-hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!file) return;
                void file.text().then((text) => {
                  const r = importScheme(text, uuidV4());
                  if (r.scheme) {
                    void saveScheme(r.scheme);
                    setMessage(t('schemes.imported', { name: r.scheme.name ?? '' }));
                  } else setMessage(r.errors.map((er) => t(ERRORS[er])).join(' '));
                });
              }}
            />
          </label>
        </div>
        <p className="scheme-message" role="status">
          {message}
        </p>
      </div>
    </Dialog>
  );
}

function SchemeEditor({
  scheme,
  onDone,
}: {
  scheme: StatusScheme;
  onDone: (saved: StatusScheme | null) => void;
}) {
  const { t } = useTranslation();
  const [s, setS] = useState<StatusScheme>(scheme);
  const [errors, setErrors] = useState<SchemeError[]>([]);
  const setCode = (i: number, patch: Partial<StatusCode>): void => {
    setS((p) => ({ ...p, codes: p.codes.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  };
  const move = (i: number, d: -1 | 1): void => {
    setS((p) => {
      const codes = [...p.codes];
      const [c] = codes.splice(i, 1);
      if (c) codes.splice(i + d, 0, c);
      return { ...p, codes };
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onDone(null);
      }}
      title={t('schemes.editTitle')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('schemes.save')}
            variant="primary"
            onClick={() => {
              const clean: StatusScheme = {
                ...s,
                name: (s.name ?? '').trim(),
                codes: s.codes.map((c) => ({
                  ...c,
                  code: c.code.trim(),
                  label: (c.label ?? '').trim(),
                })),
              };
              const e = validateScheme(clean);
              setErrors(e);
              if (e.length === 0)
                void saveScheme(clean).then(() => {
                  onDone(clean);
                });
            }}
          />
          <Button
            label={t('annotate.caret.cancel')}
            onClick={() => {
              onDone(null);
            }}
          />
        </>
      }
    >
      <div className="scheme-editor" data-testid="scheme-editor">
        <TextField
          label={t('schemes.name')}
          value={s.name ?? ''}
          maxLength={LIMITS.name}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setS((p) => ({ ...p, name: v }));
          }}
        />
        <ol className="scheme-rows" aria-label={t('schemes.codes')}>
          {s.codes.map((c, i) => {
            const n = i + 1;
            const low = /^#[0-9a-f]{6}$/iu.test(c.color) && contrastOnWhite(c.color) < 3;
            return (
              <li key={i} className="scheme-row">
                <TextField
                  label={t('schemes.code', { n })}
                  value={c.code}
                  maxLength={LIMITS.code}
                  onChange={(e) => {
                    setCode(i, { code: e.currentTarget.value });
                  }}
                />
                <TextField
                  label={t('schemes.label', { n })}
                  value={c.label ?? ''}
                  maxLength={LIMITS.label}
                  onChange={(e) => {
                    setCode(i, { label: e.currentTarget.value });
                  }}
                />
                <div className="ui-field">
                  <label className="ui-field-label" htmlFor={`${scheme.id}-color-${String(i)}`}>
                    {t('schemes.color', { n })}
                  </label>
                  <ColorPicker
                    id={`${scheme.id}-color-${String(i)}`}
                    label={t('schemes.color', { n })}
                    value={c.color}
                    onChange={(color) => {
                      setCode(i, { color });
                    }}
                  />
                </div>
                {low ? <p className="scheme-warning">{t('schemes.lowContrast')}</p> : null}
                <div className="scheme-actions">
                  <Button
                    size="small"
                    label={t('schemes.up', { n })}
                    disabled={i === 0}
                    onClick={() => {
                      move(i, -1);
                    }}
                  />
                  <Button
                    size="small"
                    label={t('schemes.down', { n })}
                    disabled={i === s.codes.length - 1}
                    onClick={() => {
                      move(i, 1);
                    }}
                  />
                  <Button
                    size="small"
                    label={t('schemes.remove', { n })}
                    disabled={s.codes.length === 1}
                    onClick={() => {
                      setS((p) => ({ ...p, codes: p.codes.filter((_, j) => j !== i) }));
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
        <Button
          label={t('schemes.addCode')}
          disabled={s.codes.length >= MAX_CODES}
          onClick={() => {
            setS((p) => ({
              ...p,
              codes: [...p.codes, { code: '', label: '', color: NEXT_COLOR }],
            }));
          }}
        />
        {errors.length ? (
          <p className="ui-field-error" role="alert">
            {errors.map((e) => t(ERRORS[e])).join(' ')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
