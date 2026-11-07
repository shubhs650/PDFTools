// The keyboard shortcut table (§8.1), generated from the keymap: the Keyboard
// Shortcuts sheet (Help → Keyboard Shortcuts) and the Help window's Keyboard
// shortcuts topic (M9, ADR-026) both show it, so neither drifts from KEYMAP.
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../i18n';
import { commandLabelKey } from '../commandLabels';
import type { InternalAction } from '../commands/dispatch';
import { formatChord } from './chord';
import { keyLabels } from './labels';
import { KEYMAP } from './keymap';

// The sheet's own wording where a command's label is too short to explain its keys.
const ACTION_LABELS: Record<
  InternalAction | 'edit.copy' | 'edit.paste' | 'edit.selectAll',
  MessageKey
> = {
  'tab.close': msg('shortcuts.action.tabClose'),
  'tab.next': msg('shortcuts.action.tabNext'),
  'tab.prev': msg('shortcuts.action.tabPrev'),
  'tool.cancel': msg('shortcuts.action.toolCancel'),
  'tool.enter': msg('shortcuts.action.toolEnter'),
  'annotation.editText': msg('shortcuts.action.annotationEditText'),
  'menu.context': msg('shortcuts.action.menuContext'),
  'edit.copy': msg('shortcuts.action.editCopy'),
  'edit.paste': msg('shortcuts.action.editPaste'),
  'edit.selectAll': msg('shortcuts.action.editSelectAll'),
  'find.next': msg('shortcuts.action.findNext'),
  'find.prev': msg('shortcuts.action.findPrev'),
  'annotation.next': msg('shortcuts.action.annotationNext'),
  'annotation.prev': msg('shortcuts.action.annotationPrev'),
  'annotation.nudgeLeft': msg('shortcuts.action.annotationNudge'),
  'annotation.nudgeRight': msg('shortcuts.action.annotationNudge'),
  'annotation.nudgeUp': msg('shortcuts.action.annotationNudge'),
  'annotation.nudgeDown': msg('shortcuts.action.annotationNudge'),
  'annotation.nudgeLeftFar': msg('shortcuts.action.annotationNudgeFar'),
  'annotation.nudgeRightFar': msg('shortcuts.action.annotationNudgeFar'),
  'annotation.nudgeUpFar': msg('shortcuts.action.annotationNudgeFar'),
  'annotation.nudgeDownFar': msg('shortcuts.action.annotationNudgeFar'),
};

export function ShortcutTable({ testId = 'shortcut-sheet' }: { testId?: string }) {
  const { t } = useTranslation();
  const labels = keyLabels(t);
  const label = (target: string): string =>
    t((ACTION_LABELS as Record<string, MessageKey | undefined>)[target] ?? commandLabelKey(target));
  return (
    <table className="shortcut-sheet" data-testid={testId}>
      <thead>
        <tr>
          <th scope="col">{t('shortcuts.command')}</th>
          <th scope="col">{t('shortcuts.keys')}</th>
        </tr>
      </thead>
      <tbody>
        {KEYMAP.map((bnd) => (
          <tr key={bnd.target}>
            <th scope="row">
              {bnd.scope === 'bookmarks'
                ? t('shortcuts.inBookmarks', { command: label(bnd.target) })
                : label(bnd.target)}
            </th>
            <td>
              {bnd.chords.map((c, i) => (
                <span key={i}>
                  {i > 0 ? t('shortcuts.or') : null}
                  <kbd>{formatChord(c, labels)}</kbd>
                </span>
              ))}
              {bnd.reservedFirst ? (
                <span className="shortcut-note">{t('shortcuts.reservedNote')}</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
