// Protect tab commands (§7.12): Unlock with Owner Password (M2-03), Password
// Security and Remove Security (M6-12, D-40 a).
import { registerCommand } from '../../app/commands/dispatch';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { restrictions } from '../../model/permissions';
import { openSecurityInfo } from './securityInfoStore';
import { openUnlockDialog } from './unlock';
import { isEncrypted, openSecurityDialog, ownerRights } from './passwordSecurity';

export function registerProtectCommands(): () => void {
  const offs = [
    // Opens (never toggles) the Signatures pane (M2-13).
    registerCommand('protect.signatures', {
      requiresDocument: true,
      run: () => {
        const app = appStore.getState();
        if (!app.leftPaneOpen || app.leftPane !== 'rail.signatures')
          app.choosePane('rail.signatures');
      },
    }),
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
    // Setting or changing passwords and removing them need owner rights (rule 9,
    // ADR-022 decision 2): unencrypted, or opened with / unlocked by the owner password.
    registerCommand('protect.passwordSecurity', {
      requiresDocument: true,
      disabledReason: () => {
        const active = selectActive(documentStore.getState());
        return active && !ownerRights(active.meta) ? msg('passwordSecurity.needsOwner') : null;
      },
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openSecurityDialog(active.meta.id, 'apply');
      },
    }),
    registerCommand('protect.removeSecurity', {
      requiresDocument: true,
      disabledReason: () => {
        const active = selectActive(documentStore.getState());
        if (!active) return null;
        if (!isEncrypted(active.meta)) return msg('removeSecurity.notSecured');
        return ownerRights(active.meta) ? null : msg('passwordSecurity.needsOwner');
      },
      run: () => {
        const active = selectActive(documentStore.getState());
        if (active) openSecurityDialog(active.meta.id, 'remove');
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
