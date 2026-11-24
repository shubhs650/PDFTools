import { Checkmark20Regular } from '@fluentui/react-icons/svg/checkmark';
import { Target20Regular } from '@fluentui/react-icons/svg/target';
import { Warning20Regular } from '@fluentui/react-icons/svg/warning';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../ui/components';
import {
  needsCheck,
  setAlignChecked,
  updateView,
  useOverlayView,
  type Sheet,
} from '../overlay/overlayState';
import { toggleLineUp } from './manualAlign';

const BANNER_TEST_ID = 'align-banner';

/**
 * The banner across the top of the overlay on a sheet that needs checking
 * (M12-26, ADR-033, D-60): the automatic alignment is uncertain. **Line up by
 * hand** starts Line up; **It looks right** marks the sheet "Checked by you"
 * (saved with the comparison) and the banner goes.
 */
export function AlignBanner({ id, sheet }: { id: string; sheet: Sheet }) {
  const { t } = useTranslation();
  const view = useOverlayView(id);
  const titleId = useId();
  if (view.manual || !needsCheck(view, sheet) || sheet.pair === null) return null;
  const pair = sheet.pair;
  return (
    <section className="align-banner" aria-labelledby={titleId} data-testid={BANNER_TEST_ID}>
      <span className="align-banner-icon" aria-hidden="true">
        <Warning20Regular />
      </span>
      <div className="align-banner-text">
        <h3 id={titleId} className="align-banner-title">
          {t('compare.lineUp.banner')}
        </h3>
        <p className="align-banner-more">{t('compare.lineUp.bannerMore')}</p>
      </div>
      <div className="align-banner-actions">
        <Button
          label={t('compare.manual.start')}
          icon={<Target20Regular />}
          size="small"
          variant="primary"
          onClick={() => {
            toggleLineUp(id, sheet, true);
          }}
        />
        <Button
          label={t('compare.lineUp.looksRight')}
          icon={<Checkmark20Regular />}
          size="small"
          onClick={() => {
            updateView(id, (v) => setAlignChecked(v, pair));
          }}
        />
      </div>
    </section>
  );
}
