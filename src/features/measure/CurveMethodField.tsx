// How a Radius or Diameter is picked (M14-05, Q10), in "‹Tool› Tool
// Properties": the centre then a point on the edge, or three points on the
// curve. Remembered for each tool on this device (curveMethod.ts).
import { useTranslation } from 'react-i18next';
import type { CurveMethod } from '../../model/measureCurve';
import { SelectField } from '../annotate/properties/fields';
import { setCurveMethod, useCurveMethod, type CurveMethods } from './curveMethod';

export function CurveMethodField({ tool }: { tool: keyof CurveMethods }) {
  const { t } = useTranslation();
  const method = useCurveMethod(tool);
  const options: { value: CurveMethod; label: string }[] = [
    { value: 'centre', label: t('measure.props.methodCentre') },
    { value: 'three', label: t('measure.props.methodThree') },
  ];
  return (
    <SelectField
      label={t('measure.props.method')}
      value={method}
      options={options}
      onCommit={(m) => {
        setCurveMethod(tool, m);
      }}
    />
  );
}
