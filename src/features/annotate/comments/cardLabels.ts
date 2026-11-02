// Texts and pointer actions of the Comments pane's rows (M6-05).
import type { TFunction } from 'i18next';
import { format } from '../../../i18n';
import type { GroupValue } from './commentsModel';
import { STATUS_KEYS } from './statusLabels';

/** `data-action` of the pointer-only marks on a card (CommentList handles them). */
export const ACTION = { reply: 'reply', edit: 'edit', deleteReply: 'delete-reply' } as const;

export function groupLabel(t: TFunction, v: GroupValue, count: number): string {
  switch (v.by) {
    case 'page':
      return t('comments.page', { page: format.number(v.page + 1, 0), count });
    case 'author':
      return t('comments.groupCount', {
        name: v.author || t('annotate.noAuthor'),
        count,
      });
    case 'type':
      return t('comments.groupCount', { name: t(v.type), count });
    case 'status':
      return t('comments.groupCount', { name: t(STATUS_KEYS[v.status]), count });
  }
}
