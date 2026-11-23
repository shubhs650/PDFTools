import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { dialogHelp } from '../../help/openHelp';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recordError } from '../../../app/diagnostics';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { MAX_PRESET_NAME } from '../../../model/compare/presets';
import { Button, Dialog, TextField } from '../../../ui/components';
import { useDiffPart } from '../diff/diffState';
import { closeSavePreset, savePreset, usePresets } from './presetStore';

/** The name field's test id (e2e). */
const NAME_TEST_ID = 'preset-name';

/**
 * Compare → Save as Preset… (M12-21, D-58, Q35): the result's settings under
 * a name, on this device; picked again in a new comparison's Options. Saving
 * under a name in use replaces that preset.
 */
export function SavePresetDialog() {
  const id = usePresets((s) => s.saving);
  const c = useDocuments((s) => (id ? s.comparisons[id] : undefined));
  if (!id || !c) return null;
  // A fresh form for each comparison the dialog opens on.
  return <SaveForm key={id} id={id} type={c.type} />;
}

function SaveForm({ id, type }: { id: string; type: 'overlay' | 'text' }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const presets = usePresets((s) => s.presets);
  const zones = useDiffPart(id, (v) => v.zones.length);
  const trimmed = name.trim();
  const exists = presets.some((p) => p.type === type && p.name === trimmed);
  const save = async (): Promise<void> => {
    if (!trimmed || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const comparison = documentStore.getState().comparisons[id];
      if (comparison && (await savePreset(comparison, trimmed))) closeSavePreset();
      else setFailed(true);
    } catch (err) {
      recordError('compare.presets', err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeSavePreset();
      }}
      title={t('compare.presets.saveTitle')}
      help={dialogHelp('compare-start')}
      description={t('compare.presets.saveDescription')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('compare.presets.save')}
            variant="primary"
            disabled={!trimmed || busy}
            onClick={() => {
              void save();
            }}
          />
          <Button label={t('compare.presets.cancel')} onClick={closeSavePreset} />
        </>
      }
    >
      <form
        className="print-dialog-form"
        data-testid="save-preset"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label={t('compare.presets.name')}
          value={name}
          maxLength={MAX_PRESET_NAME}
          autoComplete="off"
          data-testid={NAME_TEST_ID}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
        />
        <p className="print-note">
          {type === 'overlay'
            ? t('compare.presets.holds_overlay', { zones: format.number(zones) })
            : t('compare.presets.holds_text')}
        </p>
        {exists ? (
          <p className="print-note" role="note">
            {t('compare.presets.replace')}
          </p>
        ) : null}
        {failed ? (
          <p className="print-error" role="alert">
            {t('compare.presets.failed')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
