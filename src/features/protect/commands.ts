// Protect tab commands shipped in M2-03 (§7.12): Unlock with Owner Password.
import { registerCommand } from '../../app/commands/dispatch';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { restrictions } from '../../model/permissions';
import { openSecurityInfo } from './securityInfoStore';
import { openUnlockDialog } from './unlock';

export function registerProtectCommands(): () => void {
  const offs = [
    registerCommand('protect.securityInfo', {
      requiresDocument: true,
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openSecurityInfo(active.meta.id);
      },
    }),
    registerCommand('protect.unlock', {
      requiresDocument: true,
      // Only a restricted document has something to unlock.
      disabledReason: (ctx) =>
        ctx.security && restrictions(ctx.security).length > 0 ? null : msg('protect.notRestricted'),
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openUnlockDialog(active.meta.id);
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
