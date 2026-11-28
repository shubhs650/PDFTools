import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { defaultShape, isCurveTool, type CurveShape } from '../../model/measureCurve';
import { metaOf, type CaptionPlace } from '../../model/measureMarkup';
import { measurePoints } from '../../model/measurement';
import { Button } from '../../ui/components';
import { SelectField, TextProp } from '../annotate/properties/fields';
import { GridSection } from '../annotate/properties/GridSection';
import { useSelectedAnnotations } from '../annotate/selection';
import { choiceFor, choiceText, kindOf, setMeasureMeta, withFileCurve } from './measurements';
import { useScales } from './scaleStore';

const TOP: CaptionPlace = 'top';

/**
 * The selected measurement in the Properties pane (M3-17, M14-03, §7.4): its
 * value and scale (its viewport, the page, its own from the file, or a warning
 * when it spans viewports), and for a measurement made as one markup its
 * Label, a Length's caption place (Above or In line) and Put the caption back
 * after a drag (Q27, Q40). An area's fill is the Style section's Fill. An
 * Angle needs no scale; a Radius or Diameter picked by three points is shown
 * as an arc or as the whole circle (M14-05, Q10).
 */
export function MeasureInfo({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const sel = useSelectedAnnotations(docId);
  // Re-read when scales or viewports change.
  useScales((s) => s.docs[docId]);
  const canEdit = useDocuments((s) => {
    const meta = s.docs[docId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const one = sel.length === 1 ? sel[0] : undefined;
  if (!one || !kindOf(docId, one)) return null;
  // A curve read from a file: its points and shape from its Triya data (M14-05).
  const a = withFileCurve(docId, one);
  const c = choiceFor(docId, a);
  const meta = metaOf(a);
  const locked = !canEdit || (a.flags?.includes('locked') ?? false);
  const cap: CaptionPlace = meta?.cap ?? TOP;
  const places: { value: CaptionPlace; label: string }[] = [
    { value: TOP, label: t('measure.props.above') },
    { value: 'inline', label: t('measure.props.inline') },
  ];
  const shapes: { value: CurveShape; label: string }[] = [
    { value: 'arc', label: t('measure.props.shapeArc') },
    { value: 'circle', label: t('measure.props.shapeCircle') },
  ];
  return (
    <div className="measure-info" data-testid="measure-info">
      <p className="prop-summary">{a.contents ?? ''}</p>
      <p className={c.kind === 'spanning' ? 'measure-warning' : 'prop-summary'} role="status">
        {meta?.tool === 'angle' ? t('measure.props.noScaleNeeded') : choiceText(c)}
      </p>
      {c.kind === 'spanning' ? <p className="prop-empty">{t('measure.spansHint')}</p> : null}
      {meta ? (
        <GridSection id="measurement" title={t('measure.props.heading')}>
          <TextProp
            label={t('measure.props.label')}
            value={meta.label ?? ''}
            disabled={locked}
            onCommit={(label) => {
              setMeasureMeta(docId, a.id, { label: label.trim() || undefined });
            }}
          />
          <p className="prop-empty-hint">{t('measure.props.labelHint')}</p>
          {meta.tool === 'length' ? (
            <SelectField
              label={t('measure.props.caption')}
              value={cap}
              options={places}
              disabled={locked}
              onCommit={(cap) => {
                setMeasureMeta(docId, a.id, { cap });
              }}
            />
          ) : null}
          {isCurveTool(meta.tool) && meta.tool !== 'angle' && measurePoints(a).length >= 3 ? (
            <SelectField
              label={t('measure.props.shape')}
              value={meta.shape ?? defaultShape(meta.tool)}
              options={shapes}
              disabled={locked}
              onCommit={(shape) => {
                setMeasureMeta(docId, a.id, { shape });
              }}
            />
          ) : null}
          {meta.capOffset ? (
            <div className="prop-field">
              <span className="prop-label">{t('measure.props.captionMoved')}</span>
              <Button
                size="small"
                disabled={locked}
                onClick={() => {
                  setMeasureMeta(docId, a.id, { capOffset: undefined });
                }}
                label={t('measure.props.resetCaption')}
              />
            </div>
          ) : null}
        </GridSection>
      ) : null}
    </div>
  );
}
