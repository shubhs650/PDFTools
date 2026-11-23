import { HelpButton } from '../../help/HelpButton';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { parseLocaleNumber } from '../../../i18n/format';
import { areaRegion, clampBox, type AreaBox } from '../../../model/compare/area';
import { Button, ToggleButton } from '../../../ui/components';
import { setPicking } from '../align/manualAlign';
import { mmToPt, ptToMm } from '../diff/diffState';
import type { Comparison, PageArea, SideId } from '../model';
import { frameOf } from '../overlay/frames';
import {
  placeOf,
  setLayout,
  updateView,
  useOverlayView,
  type Sheet,
} from '../overlay/overlayState';
import {
  DRAW_HINT,
  NO_PICK,
  compareAreas,
  pickReady,
  setArea,
  startDrawing,
  stopDrawing,
  updatePick,
  useAreaPick,
} from './areaPick';

const SIDE_IDS: readonly SideId[] = ['a', 'b'];
const DRAW: Record<SideId, MessageKey> = {
  a: msg('compare.area.draw_a'),
  b: msg('compare.area.draw_b'),
};
const SET: Record<SideId, MessageKey> = {
  a: msg('compare.area.set_a'),
  b: msg('compare.area.set_b'),
};

/** "RevA.pdf, page 3: 120 × 80 mm at 40, 60 mm". */
function useDescribe(): (area: PageArea | null) => string {
  const { t } = useTranslation();
  const names = useDocuments((s) =>
    JSON.stringify(Object.entries(s.docs).map(([id, d]) => [id, d.meta.name])),
  );
  const byId = new Map(JSON.parse(names) as [string, string][]);
  const mm = (pt: number): string => format.number(ptToMm(pt), 0);
  return (area) =>
    area
      ? t('compare.area.described', {
          name: byId.get(area.docId) ?? '',
          page: format.number(area.page + 1),
          width: mm(area.box[2] - area.box[0]),
          height: mm(area.box[3] - area.box[1]),
          left: mm(area.box[0]),
          top: mm(area.box[1]),
        })
      : t('compare.area.notDrawn');
}

/**
 * Compare an area (O1, ADR-031 D-60): a rectangle drawn on Document A's
 * window and one on Document B's — on the sheet shown or on another — or
 * typed in millimetres (the keyboard path); Compare the areas opens them as a
 * comparison of their own, overlaid through an alignment of their own.
 */
export function AreaPanel({ id, sheet }: { id: string; sheet: Sheet }) {
  const { t } = useTranslation();
  const pick = useAreaPick(id);
  const headingId = useId();
  const describe = useDescribe();
  const [fields, setFields] = useState({ left: '', top: '', width: '', height: '' });
  const [problem, setProblem] = useState<string | null>(null);

  const draw = (side: SideId, on: boolean): void => {
    if (on) {
      // Drawing happens in the Review layout's windows; picking alignment points stops.
      updateView(id, (v) => setLayout(v.manual?.picking ? setPicking(v, false) : v, 'review'));
      updatePick(id, (p) => startDrawing(p, side));
    } else updatePick(id, stopDrawing);
  };

  const typed = async (side: SideId): Promise<void> => {
    const page = sheet[side];
    if (!page) return;
    const num = (text: string): number => parseLocaleNumber(text, format.locale) ?? NaN;
    const [l, tp, w, h] = [fields.left, fields.top, fields.width, fields.height].map(num) as [
      number,
      number,
      number,
      number,
    ];
    const bad = (): void => {
      setProblem(t('compare.area.invalid'));
    };
    if (![l, tp, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || l < 0 || tp < 0) {
      bad();
      return;
    }
    const edits = documentStore.getState().docs[page.docId]?.edits ?? 0;
    let size;
    try {
      size = await frameOf(page.docId, page.page, edits);
    } catch {
      bad();
      return;
    }
    const want: AreaBox = [mmToPt(l), mmToPt(tp), mmToPt(l + w), mmToPt(tp + h)];
    const box = clampBox(want, size.width, size.height);
    // Typed values must fit the page as they are.
    if (!box || box.some((v, i) => Math.abs(v - (want[i] ?? v)) > 0.01)) {
      bad();
      return;
    }
    setProblem(null);
    updatePick(id, (p) => setArea({ ...p, drawing: null }, side, { ...page, box }));
  };

  const field = (key: keyof typeof fields, label: string) => (
    <label className="overlay-zone-field">
      <span className="ui-field-label">{label}</span>
      <input
        className="ui-field-input"
        inputMode="decimal"
        data-testid={`area-${key}`}
        value={fields[key]}
        onChange={(e) => {
          const value = e.currentTarget.value;
          setFields((f) => ({ ...f, [key]: value }));
        }}
      />
    </label>
  );

  return (
    <section
      className="overlay-area"
      aria-labelledby={headingId}
      data-testid="area-panel"
      data-help-topic="compare-differences"
    >
      <div className="pane-title-row">
        <h3 id={headingId} className="overlay-side-title">
          {t('compare.area.title')}
        </h3>
        <HelpButton topic="compare-differences" />
      </div>
      <p className="overlay-zone-hint">{t('compare.area.hint')}</p>
      {SIDE_IDS.map((side) => (
        <div key={side} className="overlay-area-side">
          <span className="ui-field-label">
            {t(side === 'a' ? 'compare.side.a' : 'compare.side.b')}
          </span>
          <span className="overlay-area-what" data-testid={`area-${side}`}>
            {describe(pick[side])}
          </span>
          <ToggleButton
            label={t(DRAW[side])}
            size="small"
            disabled={!sheet[side]}
            pressed={pick.drawing === side}
            onPressedChange={(on) => {
              draw(side, on);
            }}
          />
        </div>
      ))}
      <p className="overlay-zone-hint" role="status">
        {pick.drawing ? t(DRAW_HINT[pick.drawing]) : ''}
      </p>
      <fieldset className="overlay-area-typed">
        <legend className="ui-field-label">{t('compare.area.typed')}</legend>
        <div className="overlay-zone-fields">
          {field('left', t('compare.diff.zoneLeft'))}
          {field('top', t('compare.diff.zoneTop'))}
          {field('width', t('compare.diff.zoneWidth'))}
          {field('height', t('compare.diff.zoneHeight'))}
        </div>
        <div className="overlay-align-actions">
          {SIDE_IDS.map((side) => (
            <Button
              key={side}
              label={t(SET[side])}
              size="small"
              disabled={!sheet[side]}
              onClick={() => {
                void typed(side);
              }}
            />
          ))}
        </div>
      </fieldset>
      {problem ? (
        <p className="ui-field-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="overlay-align-actions">
        <Button
          label={t('compare.area.compare')}
          size="small"
          variant="primary"
          disabled={!pickReady(pick)}
          onClick={() => {
            compareAreas(id);
          }}
        />
        <Button
          label={t('compare.area.clear')}
          size="small"
          disabled={!pick.a && !pick.b && !pick.drawing}
          onClick={() => {
            updatePick(id, () => NO_PICK);
          }}
        />
      </div>
    </section>
  );
}

/**
 * An area comparison's own panel (O1): which two rectangles it compares, and
 * a note when the alignment puts A's rectangle off B's (then nothing is
 * compared: align by points).
 */
export function AreaInfo({ comparison: c, sheet }: { comparison: Comparison; sheet: Sheet }) {
  const { t } = useTranslation();
  const headingId = useId();
  const describe = useDescribe();
  const view = useOverlayView(c.id);
  const area = c.area;
  if (!area) return null;
  const on = (side: SideId): PageArea | null => {
    const p = sheet[side];
    return p ? { docId: p.docId, page: p.page, box: area[side] } : null;
  };
  const missed = areaRegion(area, placeOf(view, sheet)).length === 0;
  return (
    <section className="overlay-area" aria-labelledby={headingId} data-testid="area-info">
      <h3 id={headingId} className="overlay-side-title">
        {t('compare.area.infoTitle')}
      </h3>
      {SIDE_IDS.map((side) => (
        <p key={side} className="overlay-area-side">
          <span className="ui-field-label">
            {t(side === 'a' ? 'compare.side.a' : 'compare.side.b')}
          </span>
          <span className="overlay-area-what" data-testid={`area-${side}`}>
            {describe(on(side))}
          </span>
        </p>
      ))}
      {missed ? (
        <p className="ui-field-error" role="alert">
          {t('compare.area.missed')}
        </p>
      ) : null}
    </section>
  );
}
