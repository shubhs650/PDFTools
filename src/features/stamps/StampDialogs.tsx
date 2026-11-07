import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appStore } from '../../app/store/appStore';
import { documentStore } from '../../app/store/documentStore';
import { msg, type MessageKey } from '../../i18n';
import type { StatusCode } from '../../model/statusScheme';
import { Button, Dialog, TextField } from '../../ui/components';
import { readStampImage, type ImageProblem } from './imageStamp';
import { activeScheme, openSchemes, useSchemes } from './schemes/schemeStore';
import { stampStore, useStamps } from './stampStore';
import { dialogHelp } from '../help/openHelp';

const IMAGE_PROBLEMS: Record<ImageProblem, MessageKey> = {
  tooLarge: msg('stamps.error.tooLarge'),
  unsupported: msg('stamps.error.unsupported'),
  pdfLocked: msg('stamps.error.pdfLocked'),
  pdfNoCopy: msg('stamps.error.pdfNoCopy'),
  pdfBroken: msg('stamps.error.pdfBroken'),
};

/** Comment → Stamp (M3-14): the active scheme's codes, the document number and revision. */
export function StampDialog() {
  const open = useStamps((s) => s.pickerOpen);
  if (!open) return null;
  return <StampForm />;
}

function StampForm() {
  const { t } = useTranslation();
  const ids = useId();
  useSchemes((s) => s.activeId); // re-render when the scheme changes
  const scheme = activeScheme();
  const docId = documentStore.getState().activeId ?? '';
  const saved = useStamps((s) => s.docInfo[docId]);
  const picked = useStamps((s) => s.code);
  const problem = useStamps((s) => s.problem);
  const [code, setCode] = useState(
    scheme.codes.find((c) => c.code === picked)?.code ?? scheme.codes[0]?.code ?? '',
  );
  const [docNo, setDocNo] = useState(saved?.docNo ?? '');
  const [rev, setRev] = useState(saved?.rev ?? '');
  const labelOf = (c: StatusCode): string =>
    c.labelKey ? t(c.labelKey as MessageKey) : (c.label ?? '');
  const close = (): void => {
    stampStore.setState({ pickerOpen: false });
  };
  const place = (): void => {
    stampStore.setState((s) => ({
      code,
      problem: null,
      pickerOpen: false,
      docInfo: { ...s.docInfo, [docId]: { docNo, rev } },
    }));
    appStore.getState().setTool('dynamicStamp');
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t('stamps.title')}
      description={t('stamps.description')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('stamps')}
      footer={
        <>
          <Button
            label={t('stamps.place')}
            variant="primary"
            disabled={!code}
            type="submit"
            form={`${ids}-form`}
          />
          <Button label={t('annotate.caret.cancel')} onClick={close} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="stamp-form"
        onSubmit={(e) => {
          e.preventDefault();
          place();
        }}
      >
        <fieldset className="stamp-codes">
          <legend className="ui-field-label">
            {t('stamps.code', {
              scheme: scheme.nameKey ? t(scheme.nameKey as MessageKey) : (scheme.name ?? ''),
            })}
          </legend>
          {scheme.codes.map((c) => (
            <label key={c.code} className="stamp-code">
              <input
                type="radio"
                name={`${ids}-code`}
                checked={code === c.code}
                onChange={() => {
                  setCode(c.code);
                }}
              />
              <span className="scheme-chip" style={{ borderColor: c.color, color: c.color }}>
                {c.code}
              </span>
              {labelOf(c)}
            </label>
          ))}
        </fieldset>
        <Button
          size="small"
          variant="subtle"
          label={t('stamps.schemes')}
          onClick={() => {
            close();
            openSchemes();
          }}
        />
        <TextField
          label={t('stamps.docNo')}
          value={docNo}
          maxLength={64}
          onChange={(e) => {
            setDocNo(e.currentTarget.value);
          }}
        />
        <TextField
          label={t('stamps.rev')}
          value={rev}
          maxLength={16}
          onChange={(e) => {
            setRev(e.currentTarget.value);
          }}
        />
        <p className="stamp-hint">{t('stamps.hint')}</p>
        {problem ? (
          <p className="ui-field-error" role="alert">
            {t(problem)}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Comment → Image Stamp (M3-14): a PNG, JPG or PDF page to place. */
export function ImageStampDialog() {
  const { t } = useTranslation();
  const open = useStamps((s) => s.imageOpen);
  const [problem, setProblem] = useState<ImageProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();
  if (!open) return null;
  const close = (): void => {
    setProblem(null);
    stampStore.setState({ imageOpen: false });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t('stamps.imageTitle')}
      description={t('stamps.imageDescription')}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('stamps')}
      footer={<Button label={t('annotate.caret.cancel')} onClick={close} />}
    >
      <div className="ui-field">
        <label className="ui-field-label" htmlFor={`${ids}-file`}>
          {t('stamps.chooseImage')}
        </label>
        <input
          id={`${ids}-file`}
          type="file"
          accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
          disabled={busy}
          aria-describedby={problem ? `${ids}-problem` : undefined}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!file) return;
            setBusy(true);
            void readStampImage(file)
              .then((r) => {
                if (r.image) {
                  stampStore.setState({ image: r.image, imageOpen: false });
                  setProblem(null);
                  appStore.getState().setTool('imageStamp');
                } else setProblem(r.problem);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        />
        {problem ? (
          <p id={`${ids}-problem`} className="ui-field-error" role="alert">
            {t(IMAGE_PROBLEMS[problem])}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
