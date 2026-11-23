// The words a comparison file carries (M12-20, D-65): the attachments'
// descriptions, the marks' author and notes, the app that wrote it. Written
// into the file, so localized here on the main thread (rule 11).
import { t } from '../../../i18n';
import { APP_NAME as NAME } from '../../../i18n/appName';
import { APP_VERSION, versionParts } from '../../../app/version';
import type { MarkKind } from '../../../model/compare/file/format';
import type { MarkWords } from '../../../model/compare/file/textMarks';
import type { FileWords } from '../../../workers/work/comparisonFile/build';

/** "Triya PDF 1.1.0": the app that wrote the file. */
export const APP_NAME = (): string => `${NAME} ${versionParts(APP_VERSION).version}`;

export function fileWords(): FileWords {
  return {
    descA: t('compare.file.descA'),
    descB: t('compare.file.descB'),
    descData: t('compare.file.descData'),
    author: t('compare.file.author'),
  };
}

export function markWords(): MarkWords {
  return {
    subject: {
      inserted: t('compare.file.subject.inserted'),
      deleted: t('compare.file.subject.deleted'),
      replaced: t('compare.file.subject.replaced'),
      moved: t('compare.file.subject.moved'),
      header: t('compare.file.subject.header'),
      footer: t('compare.file.subject.footer'),
      renumbered: t('compare.file.subject.renumbered'),
      reference: t('compare.file.subject.reference'),
      figure: t('compare.file.subject.figure'),
    } satisfies Record<MarkKind, string>,
    inserted: t('compare.file.note.inserted'),
    moved: t('compare.file.note.moved'),
    figure: t('compare.file.note.figure'),
    was: (old) => t('compare.file.note.was', { old }),
    deleted: (old) => t('compare.file.note.deleted', { old }),
  };
}
