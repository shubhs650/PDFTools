// The ribbon toolbar's roving stops per command (M6-07, M14-03).
import { PALETTE_COMMANDS } from '../../features/annotate/tools/stylePalette';

/** Home's and Comment's one Measure button (M14-03): a split button of two stops. */
export const MEASURE_SPLIT = 'measure.lastTool';

/** The toolbar stops of one command: two for a split button (a tool and its menu). */
export const stopsOf = (id: string): number =>
  PALETTE_COMMANDS[id] || id === MEASURE_SPLIT ? 2 : 1;
