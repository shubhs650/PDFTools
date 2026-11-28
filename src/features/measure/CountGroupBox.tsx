// The Count group box (M14-07, D-75, Q14): in "Count Tool Properties" it
// chooses or makes the group the next clicks use (name, symbol shape, colour
// from the standard swatch picker, size), and shows the number the next count
// takes; for a selected count it shows that count's group, moves it to
// another one, and edits the group (every count of it follows, one undo
// step). Keyboard reachable, every control labelled (rule 12). No PDF work.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import {
  COUNT_SHAPES,
  COUNT_SIZES,
  sameGroupName,
  type CountShape,
} from '../../model/measureCount';
import { Button } from '../../ui/components';
import { useAnnotationMap } from '../annotate/comments/commentsStore';
import { ColorField, SelectField, TextProp } from '../annotate/properties/fields';
import { GridSection } from '../annotate/properties/GridSection';
import {
  countsOf,
  currentGroup,
  editGroup,
  groupsFor,
  moveToGroup,
  newGroup,
  nextCountNumber,
  selectGroup,
  useCountGroups,
  type GroupRefusal,
} from './countGroups';
import { countText } from './measurements';

const SHAPE_KEYS: Record<CountShape, MessageKey> = {
  circle: msg('measure.count.shape.circle'),
  square: msg('measure.count.shape.square'),
  triangle: msg('measure.count.shape.triangle'),
  diamond: msg('measure.count.shape.diamond'),
  cross: msg('measure.count.shape.cross'),
  tick: msg('measure.count.shape.tick'),
};

export function CountGroupBox({
  docId,
  countId,
  disabled = false,
}: {
  docId: string | null;
  /** A selected count: its group is the one shown, and choosing another moves it. */
  countId?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  // Re-read whenever the device's groups or the document's annotations change.
  const stored = useCountGroups((s) => s);
  const byUid = useAnnotationMap(docId);
  const [refusal, setRefusal] = useState<GroupRefusal>(null);
  const counts = useMemo(
    () => (docId ? countsOf(docId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, byUid],
  );
  const groups = useMemo(
    () => groupsFor(docId, counts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, counts, stored],
  );
  const own = countId ? counts.find((c) => c.annotation.id === countId) : undefined;
  const group = own
    ? (groups.find((g) => sameGroupName(g.name, own.meta.group ?? '')) ?? null)
    : currentGroup(docId, counts);
  if (!group) return null;
  const next = docId && !own ? nextCountNumber(docId, group.name, counts) : null;
  const edit = (change: Parameters<typeof editGroup>[2]): void => {
    setRefusal(editGroup(docId, group.name, change));
  };
  return (
    <GridSection id="countGroup" title={t('measure.count.groupBox')}>
      <SelectField
        label={t('measure.count.group')}
        value={group.name}
        options={groups.map((g) => ({ value: g.name, label: g.name }))}
        disabled={disabled}
        onCommit={(name) => {
          setRefusal(null);
          if (own && docId) moveToGroup(docId, own.annotation.id, name);
          else selectGroup(docId, name);
        }}
      />
      {own ? null : (
        <div className="prop-field">
          <span className="prop-label" aria-hidden="true" />
          <Button
            size="small"
            disabled={disabled}
            onClick={() => {
              setRefusal(null);
              newGroup(docId);
            }}
            label={t('measure.count.newGroup')}
          />
        </div>
      )}
      <TextProp
        label={t('measure.count.name')}
        value={group.name}
        disabled={disabled}
        onCommit={(name) => {
          edit({ name });
        }}
      />
      {refusal ? (
        <p className="ui-field-error" role="alert">
          {refusal === 'taken' ? t('measure.count.nameTaken') : t('measure.count.nameEmpty')}
        </p>
      ) : null}
      <SelectField
        label={t('measure.count.symbol')}
        value={group.shape}
        options={COUNT_SHAPES.map((s) => ({ value: s, label: t(SHAPE_KEYS[s]) }))}
        disabled={disabled}
        onCommit={(shape) => {
          edit({ shape });
        }}
      />
      <ColorField
        label={t('measure.count.colour')}
        value={group.color}
        disabled={disabled}
        onCommit={(color) => {
          edit({ color: color.toLowerCase() });
        }}
      />
      <SelectField
        label={t('measure.count.size')}
        value={group.size}
        options={[...new Set([...COUNT_SIZES, group.size])]
          .sort((a, b) => a - b)
          .map((s) => ({ value: s, label: t('measure.count.sizePt', { n: format.number(s, 1) }) }))}
        disabled={disabled}
        onCommit={(size) => {
          edit({ size });
        }}
      />
      {next !== null ? (
        <p className="prop-empty-hint" data-testid="count-next">
          {t('measure.count.next', {
            text: countText({ tool: 'count', group: group.name, n: next }),
          })}
        </p>
      ) : (
        <p className="prop-empty-hint">{t('measure.count.groupHint')}</p>
      )}
    </GridSection>
  );
}
