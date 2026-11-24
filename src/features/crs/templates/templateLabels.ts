// Names the CRS template screens show for the workbook parts an import cannot keep (M13-08).
import { msg, type MessageKey } from '../../../i18n';
import type { LostPart } from '../../../workers/work/crsTemplate/kind';

export const LOST_KEYS: Record<LostPart, MessageKey> = {
  shapes: msg('crs.lost.shapes'),
  charts: msg('crs.lost.charts'),
  sparklines: msg('crs.lost.sparklines'),
  dropDowns2010: msg('crs.lost.dropDowns2010'),
  cellStyles: msg('crs.lost.cellStyles'),
  pivotTables: msg('crs.lost.pivotTables'),
  slicers: msg('crs.lost.slicers'),
  threadedComments: msg('crs.lost.threadedComments'),
  formControls: msg('crs.lost.formControls'),
  headerPictures: msg('crs.lost.headerPictures'),
  externalLinks: msg('crs.lost.externalLinks'),
};
