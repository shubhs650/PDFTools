// A comparison tab's name (M12-08, D-58): "RevA ↔ RevB", with "+2" when a side of an
// overlay is a set of files; the comparison type while a side is empty.
import { t } from '../../i18n';
import { nameParts, type Comparison, type CompareType } from './model';

export const typeLabel = (type: CompareType): string =>
  type === 'overlay' ? t('compare.type.overlay') : t('compare.type.text');

export function comparisonTitle(
  c: Comparison,
  nameOf: (docId: string) => string | undefined,
): string {
  const p = nameParts(c, nameOf);
  if (!p) return typeLabel(c.type);
  const side = (name: string, more: number): string =>
    more > 0 ? t('compare.tab.more', { name, count: more }) : name;
  return t('compare.tab.name', { a: side(p.a, p.aMore), b: side(p.b, p.bMore) });
}
