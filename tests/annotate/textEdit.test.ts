import { describe, expect, it, vi } from 'vitest';
import { contentsPatch, editorText, pageDelta } from '../../src/features/annotate/textEditModel';
import { isTextTool, TEXT_TOOLS } from '../../src/features/annotate/tools/drawModel';
import { onBeforeCommand, registerCommand, runCommand } from '../../src/app/commands/dispatch';

// M7-02 (ADR-023 D-43 d): the text comment commit.

describe('editorText', () => {
  it('turns the no-break spaces the browser types into spaces', () => {
    expect(editorText('Hello  world')).toBe('Hello  world');
  });
  it('keeps line breaks', () => {
    expect(editorText('Line 1\nLine 2')).toBe('Line 1\nLine 2');
  });
  it('reads an emptied editor (a lone line break) as no text', () => {
    expect(editorText('\n')).toBe('');
    expect(editorText('')).toBe('');
  });
});

describe('contentsPatch', () => {
  it('writes the typed text', () => {
    expect(contentsPatch('Type here', 'Hello')).toEqual({ contents: 'Hello' });
  });
  it('writes nothing (no undo step) when the text did not change', () => {
    expect(contentsPatch('Hello', 'Hello')).toBeNull();
    expect(contentsPatch(undefined, '\n')).toBeNull();
  });
  it('writes an empty text: the comment stays, with an empty /Contents', () => {
    expect(contentsPatch('Hello', '')).toEqual({ contents: '' });
  });
});

describe('text tools', () => {
  it('are the text box, typewriter and callout', () => {
    expect([...TEXT_TOOLS].sort()).toEqual(['freeText', 'freeTextCallout', 'typewriter']);
    expect(isTextTool('square')).toBe(false);
  });
});

describe('onBeforeCommand', () => {
  it('runs before an enabled command, with its id', async () => {
    const order: string[] = [];
    const off = registerCommand('tool.enter', {
      run: () => {
        order.push('run');
      },
    });
    const stop = onBeforeCommand((id) => order.push(`before ${id}`));
    await runCommand('tool.enter');
    stop();
    await runCommand('tool.enter');
    off();
    expect(order).toEqual(['before tool.enter', 'run', 'run']);
  });
  it('does not run for a disabled command', async () => {
    const fn = vi.fn();
    const off = registerCommand('tool.enter', { run: () => undefined, requiresDocument: true });
    const stop = onBeforeCommand(fn);
    await runCommand('tool.enter');
    stop();
    off();
    expect(fn).not.toHaveBeenCalled();
  });
});

// M7-03: a press-and-drag moves a text comment; the pointer's way in page points.
describe('pageDelta', () => {
  it('undoes the zoom', () => {
    expect(pageDelta(30, -15, 1.5, 0)).toEqual({ x: 20, y: -10 });
  });
  it('undoes the page rotation, as the plugin’s own drag does', () => {
    expect(pageDelta(10, 20, 1, 1)).toEqual({ x: 20, y: -10 });
    expect(pageDelta(10, 20, 1, 2)).toEqual({ x: -10, y: -20 });
    expect(pageDelta(10, 20, 1, 3)).toEqual({ x: -20, y: 10 });
    expect(pageDelta(10, 20, 2, 4)).toEqual({ x: 5, y: 10 });
  });
});
