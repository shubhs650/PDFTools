import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { format, msg, type MessageKey } from '../../../i18n';
import { parseLocaleNumber } from '../../../i18n/format';
import type { ZoneSet } from '../../../model/compare/detect/zoneSets';
import { appDb } from '../../../storage/appDb';
import { Button, IconButton, ToggleButton } from '../../../ui/components';
import type { Sheet } from '../overlay/overlayState';
import {
  addZone,
  mmToPt,
  ptToMm,
  removeZone,
  updateDiff,
  useDiffView,
  type IgnoreZone,
} from './diffState';
import { loadZoneSets as loadSets, zoneSetsStore as setsStore } from './zoneSetsStore';

const ZONE_SCOPES = ['sheet', 'all'] as const;
const ZONE_SCOPE_LABEL: Record<(typeof ZONE_SCOPES)[number], MessageKey> = {
  sheet: msg('compare.diff.zoneScope_sheet'),
  all: msg('compare.diff.zoneScope_all'),
};

let setSeq = 0;
const newSetId = (): string => `set-${Date.now().toString(36)}-${String(++setSeq)}`;

/**
 * Ignore zones (M12-14, D-61, Q22): rectangles left out of the differences,
 * for the sheet shown or for every sheet, drawn on the overlay or typed in
 * millimetres (the keyboard path), and saved as named sets on this device to
 * use again.
 */
export function IgnoreZones({
  id,
  sheets,
  current,
}: {
  id: string;
  sheets: readonly Sheet[];
  current: number;
}) {
  const { t } = useTranslation();
  const view = useDiffView(id);
  const headingId = useId();
  const scopeId = useId();
  const setId = useId();
  const { sets, loaded } = useStore(setsStore);
  const [fields, setFields] = useState({ left: '', top: '', width: '', height: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [setName, setSetName] = useState('');
  const [picked, setPicked] = useState('');
  const pair = sheets[current]?.pair ?? null;

  useEffect(() => {
    if (!loaded) void loadSets();
  }, [loaded]);

  const sheetOfPair = (p: number): number => sheets.findIndex((s) => s.pair === p);

  const add = (): void => {
    const num = (text: string): number => parseLocaleNumber(text, format.locale) ?? NaN;
    const [l, tp, w, h] = [fields.left, fields.top, fields.width, fields.height].map(num) as [
      number,
      number,
      number,
      number,
    ];
    if (![l, tp, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || l < 0 || tp < 0) {
      setProblem(t('compare.diff.zoneInvalid'));
      return;
    }
    if (pair === null && view.zoneScope === 'sheet') return;
    setProblem(null);
    updateDiff(id, (v) => addZone(v, pair, [mmToPt(l), mmToPt(tp), mmToPt(l + w), mmToPt(tp + h)]));
    setFields({ left: '', top: '', width: '', height: '' });
  };

  const save = async (): Promise<void> => {
    const name = setName.trim();
    if (!name || view.zones.length === 0) return;
    const existing = sets.find((s) => s.name === name);
    const set: ZoneSet = {
      id: existing?.id ?? newSetId(),
      name,
      savedAt: Date.now(),
      zones: view.zones
        .map((z) =>
          z.pair === null
            ? { box: z.box, all: true }
            : { box: z.box, all: false, sheet: sheetOfPair(z.pair) },
        )
        .filter((z) => z.all || (z.sheet ?? -1) >= 0),
    };
    try {
      await (await appDb()).putZoneSet(set);
      await loadSets();
      setPicked(set.id);
      setSetName('');
      setNotice(t('compare.diff.setSaved', { name }));
    } catch (err) {
      recordError('compare.zoneSets', err);
    }
  };

  const apply = (): void => {
    const set = sets.find((s) => s.id === picked);
    if (!set) return;
    updateDiff(id, (v) => {
      let next = { ...v, zones: [] as IgnoreZone[] };
      for (const z of set.zones) {
        const p = z.all ? null : (sheets[z.sheet ?? -1]?.pair ?? undefined);
        if (p === undefined) continue;
        next = addZone({ ...next, zoneScope: z.all ? 'all' : 'sheet' }, p, z.box);
      }
      return { ...next, zoneScope: v.zoneScope };
    });
    setNotice(t('compare.diff.setApplied', { name: set.name }));
  };

  const remove = async (): Promise<void> => {
    if (!picked) return;
    try {
      await (await appDb()).deleteZoneSet(picked);
      setPicked('');
      await loadSets();
    } catch (err) {
      recordError('compare.zoneSets', err);
    }
  };

  const mm = (pt: number): string => format.number(ptToMm(pt), 0);
  const field = (key: keyof typeof fields, label: string) => (
    <label className="overlay-zone-field">
      <span className="ui-field-label">{label}</span>
      <input
        className="ui-field-input"
        inputMode="decimal"
        data-testid={`zone-${key}`}
        value={fields[key]}
        onChange={(e) => {
          const value = e.currentTarget.value;
          setFields((f) => ({ ...f, [key]: value }));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
    </label>
  );

  return (
    <section className="overlay-zones" aria-labelledby={headingId} data-testid="ignore-zones">
      <h3 id={headingId} className="overlay-side-title">
        {t('compare.diff.zones')}
      </h3>
      <p className="overlay-zone-hint">{t('compare.diff.zonesHint')}</p>
      <div className="overlay-diff-field">
        <label htmlFor={scopeId} className="ui-field-label">
          {t('compare.diff.zoneScope')}
        </label>
        <select
          id={scopeId}
          className="ui-field-input"
          data-testid="zone-scope"
          value={view.zoneScope}
          onChange={(e) => {
            const scope = e.currentTarget.value as 'sheet' | 'all';
            updateDiff(id, (v) => ({ ...v, zoneScope: scope }));
          }}
        >
          {ZONE_SCOPES.map((k) => (
            <option key={k} value={k}>
              {t(ZONE_SCOPE_LABEL[k])}
            </option>
          ))}
        </select>
      </div>
      <ToggleButton
        label={t('compare.diff.zoneDraw')}
        size="small"
        disabled={pair === null}
        pressed={view.drawing}
        onPressedChange={(on) => {
          updateDiff(id, (v) => ({ ...v, drawing: on }));
        }}
      />
      {view.drawing ? <p className="overlay-zone-hint">{t('compare.diff.zoneDrawHint')}</p> : null}
      <div className="overlay-zone-fields">
        {field('left', t('compare.diff.zoneLeft'))}
        {field('top', t('compare.diff.zoneTop'))}
        {field('width', t('compare.diff.zoneWidth'))}
        {field('height', t('compare.diff.zoneHeight'))}
      </div>
      <Button
        label={t('compare.diff.zoneAdd')}
        size="small"
        disabled={pair === null}
        onClick={add}
      />
      {problem ? (
        <p className="ui-field-error" role="alert">
          {problem}
        </p>
      ) : null}
      {view.zones.length === 0 ? (
        <p className="overlay-layer-empty">{t('compare.diff.zoneNone')}</p>
      ) : (
        <ul className="overlay-zone-list" data-testid="zone-list">
          {view.zones.map((z, i) => {
            const n = format.number(i + 1);
            const sheet = z.pair === null ? -1 : sheetOfPair(z.pair);
            return (
              <li key={z.id} className="overlay-zone">
                <span className="overlay-zone-name">
                  {t('compare.diff.zoneName', {
                    n,
                    width: mm(z.box[2] - z.box[0]),
                    height: mm(z.box[3] - z.box[1]),
                    left: mm(z.box[0]),
                    top: mm(z.box[1]),
                  })}
                  {' · '}
                  {z.pair === null
                    ? t('compare.diff.zoneOn_all')
                    : t('compare.diff.zoneOn_sheet', { sheet: format.number(sheet + 1) })}
                </span>
                <IconButton
                  label={t('compare.diff.zoneRemove', { n })}
                  icon={<Delete20Regular />}
                  size="small"
                  onClick={() => {
                    updateDiff(id, (v) => removeZone(v, z.id));
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="overlay-zone-sets" role="group" aria-label={t('compare.diff.sets')}>
        <label htmlFor={setId} className="ui-field-label">
          {t('compare.diff.setPick')}
        </label>
        <select
          id={setId}
          className="ui-field-input"
          data-testid="zone-set"
          value={picked}
          disabled={sets.length === 0}
          onChange={(e) => {
            setPicked(e.currentTarget.value);
          }}
        >
          <option value="">{sets.length ? '' : t('compare.diff.setNone')}</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="overlay-align-actions">
          <Button
            label={t('compare.diff.setApply')}
            size="small"
            disabled={!picked}
            onClick={apply}
          />
          <Button
            label={t('compare.diff.setDelete')}
            size="small"
            disabled={!picked}
            onClick={() => {
              void remove();
            }}
          />
        </div>
        <label className="overlay-zone-field">
          <span className="ui-field-label">{t('compare.diff.setName')}</span>
          <input
            className="ui-field-input"
            data-testid="zone-set-name"
            value={setName}
            maxLength={80}
            onChange={(e) => {
              setSetName(e.currentTarget.value);
            }}
          />
        </label>
        <Button
          label={t('compare.diff.setSave')}
          size="small"
          disabled={!setName.trim() || view.zones.length === 0}
          onClick={() => {
            void save();
          }}
        />
        <p className="overlay-diff-notice" role="status">
          {notice ?? ''}
        </p>
      </div>
    </section>
  );
}
