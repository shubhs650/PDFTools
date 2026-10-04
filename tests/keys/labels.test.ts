import { describe, expect, it } from 'vitest';
import { shortcutText } from '../../src/app/keys/labels';
import { t } from '../../src/i18n';

// Preview review UI04: Help and the shortcut sheet share one platform-aware
// rendering of the keymap.
describe('shortcutText', () => {
  it('names the platform modifier', () => {
    expect(shortcutText('file.open', t, false)).toBe('Ctrl+O');
    expect(shortcutText('file.open', t, true)).toBe('Cmd+O');
    expect(shortcutText('file.saveAs', t, true)).toBe('Cmd+Shift+S');
  });

  it('prefers Plus over its = twin and names punctuation and keys', () => {
    expect(shortcutText('view.zoomIn', t, false)).toBe('Ctrl+Plus');
    expect(shortcutText('view.zoomOut', t, false)).toBe('Ctrl+Minus');
    expect(shortcutText('comment.delete', t, false)).toBe('Delete');
    expect(shortcutText('view.prevView', t, true)).toBe('Option+Left Arrow');
  });

  it('skips a browser-reserved first chord; empty when unbound', () => {
    expect(shortcutText('tab.close', t, false)).toBe('Ctrl+Alt+W');
    expect(shortcutText('comment.reply', t, false)).toBe('');
  });
});
