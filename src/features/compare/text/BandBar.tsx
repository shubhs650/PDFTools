import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../../i18n';
import type { HfBands } from '../../../model/compare/text/headers';
import { Button } from '../../../ui/components';
import type { Comparison, SideId } from '../model';
import { setRunOptions, updateTextView, useTextView } from './textFlow';

const MM_PER_PT = 25.4 / 72;
const BAND_SIDES: readonly SideId[] = ['a', 'b'];
const EDGES: readonly (keyof HfBands)[] = ['top', 'bottom'];

const FIELD: Record<`${keyof HfBands}_${SideId}`, MessageKey> = {
  top_a: msg('compare.text.bands.top_a'),
  bottom_a: msg('compare.text.bands.bottom_a'),
  top_b: msg('compare.text.bands.top_b'),
  bottom_b: msg('compare.text.bands.bottom_b'),
};

/**
 * Header and footer bands drawn by hand (D-63, Q28): while this bar is open
 * each page shows a header line and a footer line to drag; the fields here
 * are the keyboard path, in millimetres. Apply runs the comparison again
 * with the bands, which replace the automatic detection.
 */
export function BandBar({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const view = useTextView(c.id);
  const edit = view.bandEdit;
  if (!edit) return null;
  const set = (side: SideId, edge: keyof HfBands, mm: number): void => {
    if (!Number.isFinite(mm)) return;
    updateTextView(c.id, (v) =>
      v.bandEdit
        ? {
            ...v,
            bandEdit: {
              ...v.bandEdit,
              [side]: { ...v.bandEdit[side], [edge]: Math.max(0, mm / MM_PER_PT) },
            },
          }
        : v,
    );
  };
  const close = (): void => {
    updateTextView(c.id, (v) => ({ ...v, bandEdit: null }));
  };
  return (
    <div
      className="text-band-bar"
      role="group"
      aria-label={t('compare.text.bands.title')}
      data-testid="text-band-bar"
    >
      <p className="text-band-hint">{t('compare.text.bands.hint')}</p>
      <div className="text-band-fields">
        {BAND_SIDES.flatMap((side) =>
          EDGES.map((edge) => (
            <label key={`${side}-${edge}`} className="text-band-field">
              <span>{t(FIELD[`${edge}_${side}`])}</span>
              <input
                type="number"
                className="ui-input ui-focusable"
                min={0}
                step={1}
                // A number input's value is never localised: whole millimetres.
                value={Math.round(edit[side][edge] * MM_PER_PT)}
                onChange={(e) => {
                  set(side, edge, e.currentTarget.valueAsNumber);
                }}
              />
            </label>
          )),
        )}
        <Button
          label={t('compare.text.bands.apply')}
          variant="primary"
          size="small"
          onClick={() => {
            const bands = edit;
            close();
            setRunOptions(c, (o) => ({ ...o, headersFooters: true, bands }));
          }}
        />
        <Button label={t('compare.text.bands.cancel')} size="small" onClick={close} />
      </div>
    </div>
  );
}
