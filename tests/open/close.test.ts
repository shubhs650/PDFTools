import { describe, expect, it } from 'vitest';
import { documentStore } from '../../src/app/store/documentStore';
import { closeDocument } from '../../src/features/open/openDocument';
import { hostStore, startedWorkClient } from '../../src/features/view/host';

describe('closeDocument (M1-13)', () => {
  it('releases only what is running: closing never starts the engine or the Work worker', async () => {
    documentStore
      .getState()
      .open({ id: 'd1', name: 'a.pdf', pageCount: 1, permissions: 0, signatureCount: 0 });
    await closeDocument('d1');
    expect(documentStore.getState().docs.d1).toBeUndefined();
    expect(startedWorkClient()).toBeUndefined();
    expect(hostStore.getState().render).toBeNull();
  });
});
