// Review status labels (M3-11, M3-12, M3-Q3): the standard /State values.
import { PdfAnnotationState } from '@embedpdf/models';
import { msg, type MessageKey } from '../../../i18n';

export const STATUS_KEYS: Record<PdfAnnotationState | 'none', MessageKey> = {
  none: msg('comments.status.none'),
  [PdfAnnotationState.Accepted]: msg('comments.status.accepted'),
  [PdfAnnotationState.Rejected]: msg('comments.status.rejected'),
  [PdfAnnotationState.Cancelled]: msg('comments.status.cancelled'),
  [PdfAnnotationState.Completed]: msg('comments.status.completed'),
  [PdfAnnotationState.None]: msg('comments.status.none'),
  [PdfAnnotationState.Marked]: msg('comments.status.marked'),
  [PdfAnnotationState.Unmarked]: msg('comments.status.unmarked'),
};

/** The statuses the filter offers ('none': no review state yet). */
export const STATUS_FILTERS: readonly (PdfAnnotationState | 'none')[] = [
  'none',
  PdfAnnotationState.Accepted,
  PdfAnnotationState.Rejected,
  PdfAnnotationState.Cancelled,
  PdfAnnotationState.Completed,
];
