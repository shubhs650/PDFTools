import { describe, expect, it } from 'vitest';
import { accessStrategy } from '../../src/storage/fileAccess';

const noop = () => Promise.resolve();

describe('accessStrategy (M1-12, D-04)', () => {
  it('uses the File System Access API when both pickers exist (Chromium)', () => {
    expect(accessStrategy({ showOpenFilePicker: noop, showSaveFilePicker: noop })).toBe('fsa');
  });

  it('falls back to input + download without the pickers (Firefox, Safari)', () => {
    expect(accessStrategy({})).toBe('fallback');
    expect(accessStrategy({ showOpenFilePicker: noop })).toBe('fallback');
  });
});
