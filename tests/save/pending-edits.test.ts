// M2-19: saves, prints and exports wait for form values still being committed.
import { describe, expect, it } from 'vitest';
import { editsSettled, trackEdit } from '../../src/features/save/pendingEdits';

describe('pending edits', () => {
  it('editsSettled waits for every tracked edit, failures included', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    void trackEdit(
      new Promise<void>((r) => {
        release = r;
      }).then(() => order.push('edit')),
    );
    void trackEdit(Promise.reject(new Error('refused'))).catch(() => undefined);
    const waited = editsSettled().then(() => order.push('save'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await waited;
    expect(order).toEqual(['edit', 'save']);
    await editsSettled(); // nothing pending: resolves at once
  });
});
