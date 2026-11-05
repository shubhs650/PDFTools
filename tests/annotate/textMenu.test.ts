// The text menu (M7-05, ADR-023 D-43 e): its items are known commands showing
// the editor's keys (the document commands' chords, one keymap entry each),
// and Text Style reads and patches the whole comment (/DA font, size and
// colour; /Q alignment), changing nothing when the choice is the current one.
import {
  PdfAnnotationSubtype,
  PdfStandardFont as F,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import { menuItems } from '../../src/ui/components/contextMenuModel';
import { t } from '../../src/i18n';
import {
  FONT_SIZES,
  stylePatch,
  TEXT_EDIT_ENTRIES,
  TEXT_PROPERTIES_ENTRIES,
  textStyleOf,
} from '../../src/features/annotate/textMenuModel';
import { COMMANDS } from '../../src/app/commands';

const box = (extra: Record<string, unknown> = {}): PdfAnnotationObject =>
  ({
    type: PdfAnnotationSubtype.FREETEXT,
    id: 'ft-1',
    pageIndex: 0,
    rect: { origin: { x: 10, y: 10 }, size: { width: 100, height: 30 } },
    contents: 'Note',
    fontFamily: F.Helvetica,
    fontSize: 12,
    fontColor: '#000000',
    textAlign: 0,
    ...extra,
  }) as unknown as PdfAnnotationObject;

describe('text menu items', () => {
  it('are known commands with labels, in PDF-XChange’s order, Properties last', () => {
    const ids = [...TEXT_EDIT_ENTRIES, ...TEXT_PROPERTIES_ENTRIES].flatMap((e) =>
      e.kind === 'separator' ? [] : [e.id],
    );
    expect(ids).toEqual([
      'text.undo',
      'text.redo',
      'text.cut',
      'text.copy',
      'text.paste',
      'text.delete',
      'text.selectAll',
      'edit.properties',
    ]);
    const known = new Set(COMMANDS.map((c) => c.id));
    for (const id of [...ids, 'text.style']) {
      expect(known.has(id), id).toBe(true);
      expect(t(`command.${id}` as never), id).not.toBe(`command.${id}`);
    }
  });

  it('show the keys of the commands that own those chords (Ctrl+Z, Ctrl+X…)', () => {
    const items = menuItems(
      TEXT_EDIT_ENTRIES,
      () => ({ enabled: true, pressed: false }),
      (id) => `keys of ${id}`,
    );
    const shown = Object.fromEntries(
      items.flatMap((i) => (i.kind === 'separator' ? [] : [[i.id, i.shortcut]])),
    );
    expect(shown).toEqual({
      'text.undo': 'keys of qat.undo',
      'text.redo': 'keys of qat.redo',
      'text.cut': 'keys of edit.cut',
      'text.copy': 'keys of edit.copy',
      'text.paste': 'keys of edit.paste',
      'text.delete': 'keys of comment.delete',
      'text.selectAll': 'keys of edit.selectAll',
    });
  });
});

describe('Text Style', () => {
  it('reads the comment’s font, size, colour and alignment', () => {
    expect(
      textStyleOf(
        box({ fontFamily: F.Times_BoldItalic, fontSize: 18, fontColor: '#FF0000', textAlign: 2 }),
      ),
    ).toEqual({ family: 'times', bold: true, italic: true, size: 18, color: '#ff0000', align: 2 });
  });

  it('falls back to Helvetica 12 pt black, left, when the comment has none', () => {
    expect(
      textStyleOf(
        box({
          fontFamily: undefined,
          fontSize: undefined,
          fontColor: undefined,
          textAlign: undefined,
        }),
      ),
    ).toEqual({
      family: 'helvetica',
      bold: false,
      italic: false,
      size: 12,
      color: '#000000',
      align: 0,
    });
  });

  it('patches the whole comment; bold and italic keep the family, the family keeps them', () => {
    const a = box({ fontFamily: F.Courier_Bold });
    expect(stylePatch(a, { prop: 'italic', value: true })).toEqual({
      fontFamily: F.Courier_BoldOblique,
    });
    expect(stylePatch(a, { prop: 'fontFamily', value: 'times' })).toEqual({
      fontFamily: F.Times_Bold,
    });
    expect(stylePatch(a, { prop: 'bold', value: false })).toEqual({ fontFamily: F.Courier });
    expect(stylePatch(a, { prop: 'fontSize', value: 24 })).toEqual({ fontSize: 24 });
    expect(stylePatch(a, { prop: 'fontColor', value: '#0000ff' })).toEqual({
      fontColor: '#0000ff',
    });
    // With a border (a text box, a callout), the border keeps its own colour (ADR-024).
    expect(
      stylePatch(box({ strokeColor: '#ff0000' }), { prop: 'fontColor', value: '#0000ff' }),
    ).toEqual({ fontColor: '#0000ff' });
    expect(stylePatch(a, { prop: 'textAlign', value: 1 })).toEqual({ textAlign: 1 });
  });

  it('changes nothing when the choice is the current one (no empty undo step)', () => {
    const a = box({ fontColor: '#FF0000' });
    expect(stylePatch(a, { prop: 'fontColor', value: '#ff0000' })).toBeNull();
    expect(stylePatch(a, { prop: 'fontSize', value: 12 })).toBeNull();
    expect(stylePatch(a, { prop: 'fontFamily', value: 'helvetica' })).toBeNull();
    expect(stylePatch(a, { prop: 'textAlign', value: 0 })).toBeNull();
  });

  it('offers the usual sizes, within what the Properties pane accepts (4–144 pt)', () => {
    expect(FONT_SIZES).toContain(12);
    expect(Math.min(...FONT_SIZES)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...FONT_SIZES)).toBeLessThanOrEqual(144);
    expect([...FONT_SIZES].sort((x, y) => x - y)).toEqual(FONT_SIZES);
  });
});
