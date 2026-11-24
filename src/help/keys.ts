// Keys named in Help's text, from the keymap and for this platform (UI04): the
// text says Cmd on macOS and never drifts from KEYMAP.
import type { TFunction } from 'i18next';
import { formatChord } from '../app/keys/chord';
import { KEYMAP } from '../app/keys/keymap';
import { keyLabels, shortcutText } from '../app/keys/labels';

/** A binding's first keys, the browser-reserved ones the installed app gets (D-29). */
function firstChord(target: string, t: TFunction): string {
  const chord = KEYMAP.find((b) => b.target === target)?.chords[0];
  return chord ? formatChord(chord, keyLabels(t)) : '';
}

export function helpKeys(t: TFunction): Record<string, string> {
  const k = (target: string) => shortcutText(target, t);
  return {
    mod: keyLabels(t).ctrl,
    help: k('help.help'),
    tellMe: k('app.tellMe'),
    newDoc: k('file.new'),
    open: k('file.open'),
    save: k('file.save'),
    saveAs: k('file.saveAs'),
    print: k('file.print'),
    zoomIn: k('view.zoomIn'),
    zoomOut: k('view.zoomOut'),
    fitPage: k('view.fitPage'),
    fitWidth: k('view.fitWidth'),
    actualSize: k('view.actualSize'),
    prevView: k('view.prevView'),
    nextView: k('view.nextView'),
    // Thin Lines (M13-05): the key that works everywhere, and the installed app's own.
    thinLines: k('view.thinLines'),
    thinLinesApp: firstChord('view.thinLines', t),
    loupe: k('loupe.toggle'),
    fullScreen: k('view.fullScreen'),
    darkTheme: k('view.darkTheme'),
    find: k('home.find'),
    findNext: k('find.next'),
    advancedSearch: k('home.advancedSearch'),
    undo: k('qat.undo'),
    redo: k('qat.redo'),
    delete: k('comment.delete'),
    copy: k('edit.copy'),
    cut: k('edit.cut'),
    paste: k('edit.paste'),
    selectAll: k('edit.selectAll'),
    menu: k('menu.context'),
    hand: k('home.hand'),
    select: k('home.select'),
    editText: k('annotation.editText'),
    tabLeft: k('tab.moveLeft'),
    tabRight: k('tab.moveRight'),
  };
}
