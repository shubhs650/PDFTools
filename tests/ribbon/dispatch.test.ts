import { beforeEach, describe, expect, it } from 'vitest';
import {
  commandState,
  registerCommand,
  runCommand,
  subscribeCommands,
} from '../../src/app/commands/dispatch';
import { documentStore } from '../../src/app/store/documentStore';

beforeEach(() => {
  for (const id of documentStore.getState().order) documentStore.getState().close(id);
});

describe('command dispatch (D-01)', () => {
  it('a command without a handler is disabled as not ready', () => {
    expect(commandState('help.updates')).toEqual({
      enabled: false,
      pressed: false,
      reason: 'ribbon.notReady',
    });
  });

  it('document commands are disabled with a reason until a document is open', async () => {
    let runs = 0;
    const off = registerCommand('view.zoomIn', {
      requiresDocument: true,
      run: () => {
        runs++;
      },
    });
    expect(commandState('view.zoomIn')).toMatchObject({
      enabled: false,
      reason: 'ribbon.needsDocument',
    });
    expect(await runCommand('view.zoomIn')).toBe(false);
    documentStore
      .getState()
      .open({ id: 'd', name: 'd.pdf', pageCount: 1, permissions: -1, signatureCount: 0 });
    expect(commandState('view.zoomIn')).toEqual({ enabled: true, pressed: false });
    expect(await runCommand('view.zoomIn')).toBe(true);
    expect(runs).toBe(1);
    off();
    expect(commandState('view.zoomIn').enabled).toBe(false);
  });

  it('reports pressed state and notifies listeners after a run', async () => {
    let on = false;
    let notified = 0;
    const unsub = subscribeCommands(() => notified++);
    const off = registerCommand('view.leftPanes', {
      run: () => {
        on = !on;
      },
      isPressed: () => on,
    });
    await runCommand('view.leftPanes');
    expect(commandState('view.leftPanes').pressed).toBe(true);
    expect(notified).toBeGreaterThanOrEqual(2);
    off();
    unsub();
  });

  it('rejects handlers for unknown command ids', () => {
    expect(() => registerCommand('nope.nothing', { run: () => undefined })).toThrow(
      /Unknown command/,
    );
  });
});

describe('permission-gated commands (rule 9, D-19, M2-03)', () => {
  const open = (permissions: number, securityRevision?: number) => {
    documentStore.getState().open({
      id: 'r',
      name: 'r.pdf',
      pageCount: 1,
      permissions,
      ...(securityRevision === undefined ? {} : { securityRevision }),
      signatureCount: 0,
    });
  };

  it('a command whose capability the document denies is disabled with the restricted reason', () => {
    const off = registerCommand('file.print', { requires: 'print', run: () => undefined });
    expect(commandState('file.print')).toMatchObject({ reason: 'ribbon.needsDocument' });
    open(0xfffff2c0, 6); // qpdf R6: print denied
    expect(commandState('file.print')).toMatchObject({
      enabled: false,
      reason: 'protect.restricted',
    });
    documentStore.getState().setSecurity('r', { permissions: 0xfffffffc, ownerUnlocked: true });
    expect(commandState('file.print')).toEqual({ enabled: true, pressed: false });
    off();
  });

  it('an unencrypted document is never restricted, whatever its bits', () => {
    const off = registerCommand('file.print', { requires: 'print', run: () => undefined });
    open(0);
    expect(commandState('file.print').enabled).toBe(true);
    off();
  });

  it('Unlock is enabled only for a restricted document', async () => {
    const { registerProtectCommands } = await import('../../src/features/protect/commands');
    const off = registerProtectCommands();
    open(0xffffffff);
    expect(commandState('protect.unlock')).toMatchObject({ reason: 'protect.notRestricted' });
    documentStore.getState().close('r');
    open(0xffffffc0, 2);
    expect(commandState('protect.unlock').enabled).toBe(true);
    documentStore.getState().setSecurity('r', { permissions: 0xfffffffc, ownerUnlocked: true });
    expect(commandState('protect.unlock')).toMatchObject({ reason: 'protect.notRestricted' });
    off();
  });
});
