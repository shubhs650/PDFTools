// i18n keys for commands, tabs and groups (rule 11), by convention from the
// command table. tests/icons.test.ts checks that every one exists in en.json,
// and the i18n completeness test counts them as used.
import type { MessageKey } from '../i18n';
import type { CommandDef, CommandTab } from './commands';

export const commandLabelKey = (id: string): MessageKey => `command.${id}` as MessageKey;
export const tabLabelKey = (tab: CommandTab): MessageKey => `ribbon.tab.${tab}` as MessageKey;
export const groupLabelKey = (c: Pick<CommandDef, 'tab' | 'group'>): MessageKey =>
  `ribbon.group.${c.tab}.${c.group}` as MessageKey;
