import { useTranslation } from 'react-i18next';
import { useApp } from '../../../app/store/appStore';
import { useDocuments } from '../../../app/store/documentStore';
import { msg, type MessageKey } from '../../../i18n';
import { curveMethodStore } from '../../measure/curveMethod';
import { useStore } from 'zustand';

/** How to use a tool whose gesture is not obvious, in the status bar while it is on. */
const HINTS: Partial<Record<string, MessageKey>> = {
  // M7-03 (ADR-023 D-43 f, B11): one drag, or the three clicks.
  freeTextCallout: msg('annotate.toolHint.callout'),
  // M13-10: every Measure tool is placed by clicks.
  measureLength: msg('annotate.toolHint.length'),
  measurePolylength: msg('annotate.toolHint.polylength'),
  measurePerimeter: msg('annotate.toolHint.perimeter'),
  measureArea: msg('annotate.toolHint.area'),
  measureVolume: msg('annotate.toolHint.volume'),
  measureCutout: msg('annotate.toolHint.cutout'),
  measureAngle: msg('annotate.toolHint.angle'),
  measureRadius: msg('annotate.toolHint.radiusCentre'),
  measureDiameter: msg('annotate.toolHint.diameterCentre'),
};

/** Radius and Diameter by three points (M14-05): their own hints. */
const THREE: Partial<Record<string, MessageKey>> = {
  measureRadius: msg('annotate.toolHint.radiusThree'),
  measureDiameter: msg('annotate.toolHint.diameterThree'),
};

/** Status bar (§5): the active tool's hint. */
export function ToolHint() {
  const { t } = useTranslation();
  const tool = useApp((s) => s.tool);
  const hasDoc = useDocuments((s) => s.activeId !== null);
  const methods = useStore(curveMethodStore);
  const three =
    (tool === 'measureRadius' && methods.radius === 'three') ||
    (tool === 'measureDiameter' && methods.diameter === 'three');
  const key = hasDoc ? ((three ? THREE[tool] : undefined) ?? HINTS[tool]) : undefined;
  if (!key) return null;
  return (
    <span className="status-text tool-hint" data-testid="tool-hint">
      {t(key)}
    </span>
  );
}
