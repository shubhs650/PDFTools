// The last measuring tool used (M14-03, Q26): the face of Home's and Comment's
// one Measure split button. Kept for the session only.
import { createStore, useStore } from 'zustand';
import { appStore } from '../../app/store/appStore';
import { isMeasureTool, PLUGIN_TOOL, TOOL_OF, type MeasureTool } from './measureTools';

export const lastMeasureTool = createStore<{ tool: MeasureTool }>(() => ({
  tool: 'measureLength',
}));

export const useLastMeasureTool = (): MeasureTool => useStore(lastMeasureTool, (s) => s.tool);

/** The Measure tab command of a measuring tool. */
export const measureCommandOf = (tool: MeasureTool): string => `measure.${TOOL_OF[tool]}`;

/**
 * Every measuring tool's command, in the menu's order; Cutout (M14-06) after
 * Volume (it cuts into the selected Area or Volume, and is never the face).
 */
export const MEASURE_MENU = Object.values(PLUGIN_TOOL)
  .map(measureCommandOf)
  .flatMap((id) => (id === 'measure.volume' ? [id, 'measure.cutout'] : [id]));

/** Remember every measuring tool the user turns on. */
appStore.subscribe((s, prev) => {
  if (s.tool !== prev.tool && isMeasureTool(s.tool)) lastMeasureTool.setState({ tool: s.tool });
});
