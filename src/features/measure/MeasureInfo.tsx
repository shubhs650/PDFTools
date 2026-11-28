import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { useTranslation } from 'react-i18next';
import type { PdfAnnotationObject } from '@embedpdf/models';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { defaultShape, isCurveTool, type CurveShape } from '../../model/measureCurve';
import { isAreaTool, metaOf, type CaptionPlace } from '../../model/measureMarkup';
import { measurePoints } from '../../model/measurement';
import {
  areaText,
  areaValue,
  autoAreaUnit,
  autoVolumeUnit,
  depthText,
  DEFAULT_DEPTH,
} from '../../model/measureQuantity';
import { format } from '../../i18n';
import { Button, IconButton } from '../../ui/components';
import { CheckField, SelectField, TextProp } from '../annotate/properties/fields';
import { CountGroupBox } from './CountGroupBox';
import { GridSection } from '../annotate/properties/GridSection';
import { useSelectedAnnotations } from '../annotate/selection';
import {
  choiceFor,
  choiceText,
  kindOf,
  metaFor,
  scaleForMeasurement,
  setMeasureMeta,
  withFileMeta,
} from './measurements';
import { QuantityFields } from './QuantityFields';
import { useScales } from './scaleStore';

const TOP: CaptionPlace = 'top';

/**
 * The selected measurement in the Properties pane (M3-17, M14-03, §7.4): its
 * value and scale (its viewport, the page, its own from the file, or a warning
 * when it spans viewports), and for a measurement made as one markup its
 * Label, a Length's caption place (Above or In line) and Put the caption back
 * after a drag (Q27, Q40). An area's fill is the Style section's Fill. An
 * Angle needs no scale; a Radius or Diameter picked by three points is shown
 * as an arc or as the whole circle (M14-05, Q10). An Area or Volume shows
 * its area, depth and cutouts (each can be deleted), and its own units and
 * decimals; a Volume's Depth can be changed (M14-06, Q7, Q8, Q28).
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
  const a = withFileMeta(docId, one);
  const c = choiceFor(docId, a);
  const meta = metaOf(a) ?? metaFor(docId, a);
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
        {meta?.tool === 'angle' || meta?.tool === 'count'
          ? t('measure.props.noScaleNeeded')
          : choiceText(c)}
      </p>
      {c.kind === 'spanning' && meta?.tool !== 'count' ? (
        <p className="prop-empty">{t('measure.spansHint')}</p>
      ) : null}
      {meta && isAreaTool(meta.tool) ? <AreaFacts docId={docId} a={a} /> : null}
      {meta?.tool === 'count' ? (
        // A Count (M14-07): its group, and whether its number shows (Q11, Q14).
        <>
          <GridSection id="measurement" title={t('measure.props.heading')}>
            <CheckField
              label={t('measure.count.showNumber')}
              value={!meta.hideN}
              disabled={locked}
              onCommit={(on) => {
                setMeasureMeta(docId, a.id, { hideN: on ? undefined : true });
              }}
            />
          </GridSection>
          <CountGroupBox docId={docId} countId={a.id} disabled={locked} />
        </>
      ) : meta ? (
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
          {isAreaTool(meta.tool) ? (
            <QuantityFields
              tool={meta.tool}
              value={meta}
              autoArea={autoAreaUnit(scaleForMeasurement(docId, a))}
              autoVolume={autoVolumeUnit(scaleForMeasurement(docId, a))}
              disabled={locked}
              onChange={(change) => {
                setMeasureMeta(docId, a.id, change);
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

/**
 * An Area's or Volume's facts (M14-06, Q40): a Volume's area and depth, the
 * area before its cutouts, and each cutout with its area and a Delete button
 * (one undo step each).
 */
function AreaFacts({ docId, a }: { docId: string; a: PdfAnnotationObject }) {
  const { t } = useTranslation();
  const canEdit = useDocuments((s) => {
    const m = s.docs[docId]?.meta;
    return m ? allows(securityOf(m), 'annotate') : false;
  });
  const meta = metaOf(a) ?? metaFor(docId, a);
  if (!meta || !isAreaTool(meta.tool)) return null;
  const locked = !canEdit || (a.flags?.includes('locked') ?? false);
  const s = scaleForMeasurement(docId, a);
  const pts = measurePoints(a);
  const holes = meta.holes ?? [];
  const units = { areaUnit: meta.areaUnit, areaDecimals: meta.areaDecimals };
  const net = areaText(areaValue(pts, { ...units, holes }, s), format);
  return (
    <div className="measure-facts" data-testid="measure-facts">
      {meta.tool === 'volume' ? (
        <>
          <p className="prop-summary">{t('measure.props.area', { value: net })}</p>
          <p className="prop-summary">
            {t('measure.props.depthLine', {
              value: depthText(meta.depth ?? DEFAULT_DEPTH, format),
            })}
          </p>
        </>
      ) : null}
      {holes.length > 0 ? (
        <>
          <p className="prop-summary">
            {t('measure.props.gross', { value: areaText(areaValue(pts, units, s), format) })}
          </p>
          <GridSection id="cutouts" title={t('measure.props.cutouts')}>
            <ul className="measure-cutouts" data-testid="measure-cutouts">
              {holes.map((h, i) => {
                const n = format.number(i + 1, 0);
                return (
                  <li key={i} className="measure-cutout">
                    <span>
                      {t('measure.props.cutout', {
                        n,
                        value: areaText(areaValue(h, units, s), format),
                      })}
                    </span>
                    <IconButton
                      size="small"
                      icon={<Delete20Regular />}
                      disabled={locked}
                      label={t('measure.props.deleteCutout', { n })}
                      onClick={() => {
                        const next = holes.filter((_, k) => k !== i);
                        setMeasureMeta(docId, a.id, { holes: next.length ? next : undefined });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </GridSection>
        </>
      ) : (
        <p className="prop-empty-hint">{t('measure.props.cutoutHint')}</p>
      )}
    </div>
  );
}
