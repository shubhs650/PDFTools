// Display names for lower-case subtype names (M4-20: a source's types, from a
// PDF or our JSON export), the same labels as the Comments pane's (M3-05).
import { msg, type MessageKey } from '../../../i18n';

const BY_NAME: Record<string, MessageKey> = {
  text: msg('annotate.type.note'),
  freetext: msg('annotate.type.freeText'),
  line: msg('annotate.type.line'),
  square: msg('annotate.type.rectangle'),
  circle: msg('annotate.type.oval'),
  polygon: msg('annotate.type.polygon'),
  polyline: msg('annotate.type.polyline'),
  highlight: msg('annotate.type.highlight'),
  underline: msg('annotate.type.underline'),
  squiggly: msg('annotate.type.squiggly'),
  strikeout: msg('annotate.type.strikeout'),
  stamp: msg('annotate.type.stamp'),
  caret: msg('annotate.type.caret'),
  ink: msg('annotate.type.ink'),
};

export const typeLabelKey = (name: string): MessageKey =>
  BY_NAME[name] ?? msg('annotate.type.other');
