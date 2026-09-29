import { useTranslation } from 'react-i18next';
import { useSelectedAnnotations } from '../annotate/selection';
import { choiceFor, choiceText, kindOf } from './measurements';
import { useScales } from './scaleStore';

/**
 * The selected measurement's scale in the Properties pane (M3-17, §7.4): its
 * viewport, the page, its own from the file, or a warning when it spans
 * viewports (valued at the page scale then).
 */
export function MeasureInfo({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const sel = useSelectedAnnotations(docId);
  // Re-read when scales or viewports change.
  useScales((s) => s.docs[docId]);
  const a = sel.length === 1 ? sel[0] : undefined;
  if (!a || !kindOf(docId, a)) return null;
  const c = choiceFor(docId, a);
  return (
    <div className="measure-info" data-testid="measure-info">
      <p className="prop-summary">{a.contents ?? ''}</p>
      <p className={c.kind === 'spanning' ? 'measure-warning' : 'prop-summary'} role="status">
        {choiceText(c)}
      </p>
      {c.kind === 'spanning' ? <p className="prop-empty">{t('measure.spansHint')}</p> : null}
    </div>
  );
}
