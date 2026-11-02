import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { SignatureDrawPad, type SignatureDrawPadHandle } from '@embedpdf/plugin-signature/react';
import { uuidV4 } from '@embedpdf/models';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fromKeyboard } from '../../app/commands/inputSource';
import { recordError } from '../../app/diagnostics';
import { useDocuments } from '../../app/store/documentStore';
import { SIGNATURE_FONTS, type SignatureFontId } from '../../engine/fonts';
import { format, msg, type MessageKey } from '../../i18n';
import { deriveInitials } from '../../model/reviewerProfile';
import {
  inkPath,
  MAX_INITIALS_LENGTH,
  MAX_TYPED_LENGTH,
  PEN_WIDTHS,
  SIGNATURE_COLORS,
  SIGNATURE_UPLOAD_MAX_BYTES,
  typedText,
  type ImageField,
  type InkField,
  type PenWidth,
  type SignatureColor,
  type StoredEntry,
  type StoredField,
} from '../../model/visualSignature';
import { Button, Dialog, IconButton, TextField } from '../../ui/components';
import { useProfile } from '../settings/profile/profileStore';
import { canFlatten, placeAtCentre, startPlacement, type SignatureKind } from './signDocument';
import { pngDataUrl, typedField, uploadedField } from './signImages';
import { loadSignatureFonts } from './signImages';
import { closeSignDialog, deleteSignature, saveSignature, signStore, useSign } from './signStore';

// Protect → Sign Document (M6-13, ADR-021 D-40 b, §7.11): choose a saved
// signature or make one — Draw (pointer), Type (the reviewer's name in a
// handwriting font) or Upload (PNG/JPG) — then place it on the page. Native
// radios, inputs and buttons throughout; Type and Upload need no pointer
// (rule 12). The note says what this is: a picture, not a certificate-based
// digital signature.

type Source = 'saved' | 'draw' | 'type' | 'upload';

const SOURCE_LABEL: Record<Source, MessageKey> = {
  saved: msg('sign.source.saved'),
  draw: msg('sign.source.draw'),
  type: msg('sign.source.type'),
  upload: msg('sign.source.upload'),
};

const COLOR_LABEL: Record<SignatureColor, MessageKey> = {
  black: msg('sign.color.black'),
  blue: msg('sign.color.blue'),
};

const WIDTH_LABEL: Record<PenWidth, MessageKey> = {
  thin: msg('sign.width.thin'),
  medium: msg('sign.width.medium'),
  thick: msg('sign.width.thick'),
};

const FONT_LABEL: Record<SignatureFontId, MessageKey> = {
  'sig-allura': msg('sign.font.allura'),
  'sig-great-vibes': msg('sign.font.greatVibes'),
  'sig-caveat': msg('sign.font.caveat'),
};

type UploadProblem = 'tooLarge' | 'unsupported' | 'empty';
const UPLOAD_PROBLEM: Record<UploadProblem, MessageKey> = {
  tooLarge: msg('sign.upload.tooLarge'),
  unsupported: msg('sign.upload.unsupported'),
  empty: msg('sign.upload.empty'),
};

/** A field's picture: the strokes as SVG, or the PNG. */
export function FieldPreview({ field, className }: { field: StoredField; className?: string }) {
  if (field.creationType === 'draw') {
    const { size, strokeColor, strokeWidth } = field.inkData;
    return (
      <svg
        className={className}
        viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={inkPath(field.inkData)}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <img className={className} src={pngDataUrl(field.imageData)} alt="" />;
}

export function SignDocumentDialog() {
  const docId = useSign((s) => s.docId);
  if (!docId) return null;
  return <Body key={docId} docId={docId} />;
}

interface Upload {
  file: ArrayBuffer | null;
  field: ImageField<string> | null;
  problem: UploadProblem | null;
}

const NO_UPLOAD: Upload = { file: null, field: null, problem: null };

function Body({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const name = useDocuments((s) => s.docs[docId]?.meta.name ?? '');
  const saved = useSign((s) => s.saved);
  const loaded = useSign((s) => s.loaded);
  const flattenAfter = useSign((s) => s.flattenAfter);
  const profile = useProfile((s) => s.profile);
  const flattenAllowed = canFlatten(docId);

  const [source, setSource] = useState<Source | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveNew, setSaveNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  // Draw
  const [drawn, setDrawn] = useState<{ signature: InkField | null; initials: InkField | null }>({
    signature: null,
    initials: null,
  });
  const [color, setColor] = useState<SignatureColor>('black');
  const [width, setWidth] = useState<PenWidth>('medium');
  const pads = useRef<{
    signature: SignatureDrawPadHandle | null;
    initials: SignatureDrawPadHandle | null;
  }>({
    signature: null,
    initials: null,
  });
  // Type
  const [typedName, setTypedName] = useState(profile?.name ?? '');
  const [typedInitials, setTypedInitials] = useState(
    profile?.initials ?? deriveInitials(profile?.name ?? ''),
  );
  const [font, setFont] = useState<SignatureFontId>(SIGNATURE_FONTS[0].id);
  // Upload
  const [uploads, setUploads] = useState<{ signature: Upload; initials: Upload }>({
    signature: NO_UPLOAD,
    initials: NO_UPLOAD,
  });
  const [transparent, setTransparent] = useState(true);

  useEffect(() => {
    void loadSignatureFonts();
  }, []);

  // Saved signatures first when there are any; otherwise Type (no pointer needed).
  const shown: Source = source ?? (loaded && saved.length > 0 ? 'saved' : 'type');
  const chosen = saved.find((e) => e.id === savedId) ?? saved[0] ?? null;

  const toInk = (r: { inkData: InkField['inkData'] } | null): InkField | null =>
    r ? { creationType: 'draw', previewDataUrl: '', inkData: r.inkData } : null;
  const onDrawnSignature = useCallback((r: { inkData: InkField['inkData'] } | null) => {
    setDrawn((d) => ({ ...d, signature: toInk(r) }));
  }, []);
  const onDrawnInitials = useCallback((r: { inkData: InkField['inkData'] } | null) => {
    setDrawn((d) => ({ ...d, initials: toInk(r) }));
  }, []);
  const signaturePad = useCallback((h: SignatureDrawPadHandle | null) => {
    pads.current.signature = h;
  }, []);
  const initialsPad = useCallback((h: SignatureDrawPadHandle | null) => {
    pads.current.initials = h;
  }, []);

  const processUpload = async (kind: SignatureKind, file: ArrayBuffer, clear: boolean) => {
    setBusy(true);
    try {
      const field = await uploadedField(file, clear);
      setUploads((u) => ({ ...u, [kind]: { file, field, problem: field ? null : 'empty' } }));
    } catch {
      // Not an image the browser can decode: the user's file, not a fault to report.
      setUploads((u) => ({ ...u, [kind]: { file: null, field: null, problem: 'unsupported' } }));
    } finally {
      setBusy(false);
    }
  };

  /** The entry the chosen source makes (null: not ready). */
  const buildEntry = async (): Promise<{ entry: StoredEntry; isNew: boolean } | null> => {
    const now = Date.now();
    if (shown === 'saved') return chosen ? { entry: chosen, isNew: false } : null;
    if (shown === 'draw') {
      if (!drawn.signature) return null;
      return {
        entry: {
          id: uuidV4(),
          createdAt: now,
          signature: drawn.signature,
          ...(drawn.initials ? { initials: drawn.initials } : {}),
        },
        isNew: true,
      };
    }
    if (shown === 'type') {
      const text = typedText(typedName);
      if (!text) return null;
      const ini = typedText(typedInitials, MAX_INITIALS_LENGTH);
      const hex = SIGNATURE_COLORS[color];
      const [signature, initials] = await Promise.all([
        typedField(text, font, hex),
        ini ? typedField(ini, font, hex) : Promise.resolve(null),
      ]);
      if (!signature) return null;
      return {
        entry: { id: uuidV4(), createdAt: now, signature, ...(initials ? { initials } : {}) },
        isNew: true,
      };
    }
    const sig = uploads.signature.field;
    if (!sig) return null;
    const ini = uploads.initials.field;
    return {
      entry: { id: uuidV4(), createdAt: now, signature: sig, ...(ini ? { initials: ini } : {}) },
      isNew: true,
    };
  };

  const place = async (kind: SignatureKind): Promise<void> => {
    const keyboard = fromKeyboard();
    setProblem(null);
    setBusy(true);
    let built: Awaited<ReturnType<typeof buildEntry>>;
    try {
      built = await buildEntry();
    } catch (err) {
      recordError('sign.build', err);
      built = null;
    } finally {
      setBusy(false);
    }
    if (!built || (kind === 'initials' && !built.entry.initials)) {
      setProblem(msg('sign.error.notReady'));
      return;
    }
    const { entry, isNew } = built;
    const keep = isNew && saveNew;
    if (keep) await saveSignature(entry);
    const flatten = flattenAllowed && signStore.getState().flattenAfter;
    if (!startPlacement(docId, entry, kind, { transient: isNew && !keep, flatten })) {
      setProblem(msg('sign.error.place'));
      return;
    }
    closeSignDialog();
    // From the keyboard: straight into the middle of the current page (rule 12).
    if (keyboard) placeAtCentre(docId);
  };

  const ready = ((): { signature: boolean; initials: boolean } => {
    switch (shown) {
      case 'saved':
        return { signature: !!chosen, initials: !!chosen?.initials };
      case 'draw':
        return { signature: !!drawn.signature, initials: !!drawn.signature && !!drawn.initials };
      case 'type': {
        const ok = typedText(typedName) !== null;
        return {
          signature: ok,
          initials: ok && typedText(typedInitials, MAX_INITIALS_LENGTH) !== null,
        };
      }
      case 'upload':
        return {
          signature: !!uploads.signature.field,
          initials: !!uploads.signature.field && !!uploads.initials.field,
        };
    }
  })();

  const sources: Source[] =
    saved.length > 0 ? ['saved', 'draw', 'type', 'upload'] : ['draw', 'type', 'upload'];

  const colorPicker = (
    <fieldset className="sign-row">
      <legend>{t('sign.color.legend')}</legend>
      {(Object.keys(SIGNATURE_COLORS) as SignatureColor[]).map((c) => (
        <label key={c} className="scale-radio">
          <input
            type="radio"
            name={`${ids}-color`}
            checked={color === c}
            onChange={() => {
              setColor(c);
            }}
          />
          <span
            className="sign-swatch"
            style={{ background: SIGNATURE_COLORS[c] }}
            aria-hidden="true"
          />
          {t(COLOR_LABEL[c])}
        </label>
      ))}
    </fieldset>
  );

  const uploadField = (kind: SignatureKind, labelKey: MessageKey): ReactNode => {
    const u = uploads[kind];
    const inputId = `${ids}-${kind}-file`;
    return (
      <div className="ui-field sign-upload">
        <label className="ui-field-label" htmlFor={inputId}>
          {t(labelKey)}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          disabled={busy}
          aria-describedby={u.problem ? `${inputId}-problem` : undefined}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            if (file.size > SIGNATURE_UPLOAD_MAX_BYTES) {
              setUploads((x) => ({
                ...x,
                [kind]: { file: null, field: null, problem: 'tooLarge' },
              }));
              return;
            }
            void file.arrayBuffer().then((buf) => processUpload(kind, buf, transparent));
          }}
        />
        {u.field ? (
          <div className="sign-preview sign-preview--small">
            <FieldPreview field={u.field} className="sign-preview-image" />
          </div>
        ) : null}
        {u.problem ? (
          <p id={`${inputId}-problem`} className="ui-field-error" role="alert">
            {t(UPLOAD_PROBLEM[u.problem], { max: format.bytes(SIGNATURE_UPLOAD_MAX_BYTES) })}
          </p>
        ) : null}
      </div>
    );
  };

  const footer = (
    <>
      <Button
        label={t('sign.placeInitials')}
        disabled={busy || !ready.initials}
        onClick={() => void place('initials')}
      />
      <Button
        label={t('sign.placeSignature')}
        variant="primary"
        disabled={busy || !ready.signature}
        onClick={() => void place('signature')}
      />
      <Button label={t('sign.cancel')} onClick={closeSignDialog} />
    </>
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeSignDialog();
      }}
      title={t('sign.title')}
      description={t('sign.description', { name })}
      closeIcon={<Dismiss20Regular />}
      footer={footer}
    >
      <div className="print-dialog-form sign-form" data-testid="sign-document">
        <p className="sign-note" role="note">
          {t('sign.visualOnly')}
        </p>
        <fieldset className="sign-row">
          <legend>{t('sign.source.legend')}</legend>
          <div className="sign-inline">
            {sources.map((s) => (
              <label key={s} className="scale-radio">
                <input
                  type="radio"
                  name={`${ids}-source`}
                  checked={shown === s}
                  onChange={() => {
                    setSource(s);
                    setProblem(null);
                  }}
                />
                {t(SOURCE_LABEL[s], { n: format.number(saved.length, 0) })}
              </label>
            ))}
          </div>
        </fieldset>

        {shown === 'saved' ? (
          <fieldset>
            <legend>{t('sign.saved.legend')}</legend>
            <ul className="sign-saved" aria-label={t('sign.saved.legend')}>
              {saved.map((e, i) => {
                const n = format.number(i + 1, 0);
                const kind = t(SOURCE_LABEL[e.signature.creationType]);
                const when = format.date(new Date(e.createdAt));
                return (
                  <li key={e.id} className="sign-saved-item">
                    <label className="sign-saved-choice">
                      <input
                        type="radio"
                        name={`${ids}-saved`}
                        checked={chosen?.id === e.id}
                        onChange={() => {
                          setSavedId(e.id);
                        }}
                      />
                      <span className="ui-visually-hidden">
                        {t('sign.saved.item', { n, kind, when })}
                        {e.initials ? ` ${t('sign.saved.withInitials')}` : ''}
                      </span>
                      <span className="sign-preview">
                        <FieldPreview field={e.signature} className="sign-preview-image" />
                      </span>
                      {e.initials ? (
                        <span className="sign-preview sign-preview--small">
                          <FieldPreview field={e.initials} className="sign-preview-image" />
                        </span>
                      ) : null}
                    </label>
                    <IconButton
                      label={t('sign.saved.delete', { n })}
                      icon={<Delete20Regular />}
                      onClick={() => void deleteSignature(e.id)}
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {shown === 'draw' ? (
          <>
            <p className="print-note">{t('sign.draw.hint')}</p>
            <div className="sign-pads">
              <div className="ui-field">
                <span className="ui-field-label" id={`${ids}-pad-sig`}>
                  {t('sign.draw.signature')}
                </span>
                <div
                  className="sign-pad"
                  role="img"
                  aria-labelledby={`${ids}-pad-sig`}
                  data-testid="sign-pad-signature"
                >
                  <SignatureDrawPad
                    onResult={onDrawnSignature}
                    padRef={signaturePad}
                    strokeColor={SIGNATURE_COLORS[color]}
                    strokeWidth={PEN_WIDTHS[width]}
                  />
                </div>
                <Button
                  size="small"
                  variant="subtle"
                  label={t('sign.draw.clearSignature')}
                  onClick={() => pads.current.signature?.clear()}
                />
              </div>
              <div className="ui-field">
                <span className="ui-field-label" id={`${ids}-pad-ini`}>
                  {t('sign.draw.initials')}
                </span>
                <div
                  className="sign-pad sign-pad--initials"
                  role="img"
                  aria-labelledby={`${ids}-pad-ini`}
                  data-testid="sign-pad-initials"
                >
                  <SignatureDrawPad
                    onResult={onDrawnInitials}
                    padRef={initialsPad}
                    strokeColor={SIGNATURE_COLORS[color]}
                    strokeWidth={PEN_WIDTHS[width]}
                  />
                </div>
                <Button
                  size="small"
                  variant="subtle"
                  label={t('sign.draw.clearInitials')}
                  onClick={() => pads.current.initials?.clear()}
                />
              </div>
            </div>
            <div className="sign-options">
              {colorPicker}
              <fieldset className="sign-row">
                <legend>{t('sign.width.legend')}</legend>
                {(Object.keys(PEN_WIDTHS) as PenWidth[]).map((w) => (
                  <label key={w} className="scale-radio">
                    <input
                      type="radio"
                      name={`${ids}-width`}
                      checked={width === w}
                      onChange={() => {
                        setWidth(w);
                      }}
                    />
                    {t(WIDTH_LABEL[w])}
                  </label>
                ))}
              </fieldset>
            </div>
          </>
        ) : null}

        {shown === 'type' ? (
          <>
            <div className="security-passwords">
              <TextField
                label={t('sign.type.name')}
                value={typedName}
                maxLength={MAX_TYPED_LENGTH}
                autoComplete="name"
                onChange={(e) => {
                  setTypedName(e.currentTarget.value);
                }}
              />
              <TextField
                label={t('sign.type.initials')}
                value={typedInitials}
                maxLength={MAX_INITIALS_LENGTH}
                autoComplete="off"
                onChange={(e) => {
                  setTypedInitials(e.currentTarget.value);
                }}
              />
            </div>
            <fieldset>
              <legend>{t('sign.font.legend')}</legend>
              <div className="sign-fonts">
                {SIGNATURE_FONTS.map((f) => (
                  <label key={f.id} className="sign-font">
                    <input
                      type="radio"
                      name={`${ids}-font`}
                      checked={font === f.id}
                      onChange={() => {
                        setFont(f.id);
                      }}
                    />
                    <span className="sign-font-name">{t(FONT_LABEL[f.id])}</span>
                    <span
                      className="sign-font-sample"
                      style={{
                        fontFamily: `"${f.family}", cursive`,
                        color: SIGNATURE_COLORS[color],
                      }}
                      aria-hidden="true"
                    >
                      {typedText(typedName) ?? t('sign.type.sample')}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sign-options">{colorPicker}</div>
          </>
        ) : null}

        {shown === 'upload' ? (
          <>
            <div className="sign-pads">
              {uploadField('signature', msg('sign.upload.signature'))}
              {uploadField('initials', msg('sign.upload.initials'))}
            </div>
            <label className="scale-radio">
              <input
                type="checkbox"
                checked={transparent}
                disabled={busy}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setTransparent(on);
                  for (const kind of ['signature', 'initials'] as const) {
                    const file = uploads[kind].file;
                    if (file) void processUpload(kind, file, on);
                  }
                }}
              />
              {t('sign.upload.transparent')}
            </label>
          </>
        ) : null}

        <fieldset>
          <legend>{t('sign.options.legend')}</legend>
          {shown !== 'saved' ? (
            <label className="scale-radio">
              <input
                type="checkbox"
                checked={saveNew}
                onChange={(e) => {
                  setSaveNew(e.currentTarget.checked);
                }}
              />
              {t('sign.options.save')}
            </label>
          ) : null}
          <label className="scale-radio">
            <input
              type="checkbox"
              checked={flattenAllowed && flattenAfter}
              disabled={!flattenAllowed}
              aria-describedby={`${ids}-flatten-note`}
              onChange={(e) => {
                signStore.setState({ flattenAfter: e.currentTarget.checked });
              }}
            />
            {t('sign.options.flatten')}
          </label>
          <p id={`${ids}-flatten-note`} className="print-note">
            {t(
              flattenAllowed
                ? msg('sign.options.flattenNote')
                : msg('sign.options.flattenRestricted'),
            )}
          </p>
        </fieldset>
        {problem ? (
          <p className="print-error" role="alert">
            {t(problem)}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
