import { describe, expect, it, vi } from 'vitest';
import {
  contentsPatch,
  editorText,
  FIT_SLACK_PT,
  grownTextGeometry,
  pageDelta,
} from '../../src/features/annotate/textEditModel';
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

// M7-12 (B15): a text comment grows to show all of its text.
describe('grownTextGeometry', () => {
  const page = { width: 595, height: 842 };
  const rect = (x: number, y: number, w: number, h: number) => ({
    origin: { x, y },
    size: { width: w, height: h },
  });

  it('a text box gets taller (slack below the last line); its width stays', () => {
    expect(
      grownTextGeometry({ rect: rect(60, 100, 200, 40) }, { width: 0, height: 24 }, page),
    ).toEqual({ rect: rect(60, 100, 200, 40 + 24 + FIT_SLACK_PT.height) });
  });
  it('a typewriter gets wider and taller, with room after the longest line', () => {
    expect(
      grownTextGeometry(
        { rect: rect(60, 100, 100, 20), intent: 'FreeTextTypeWriter' },
        { width: 80, height: 12 },
        page,
      ),
    ).toEqual({
      rect: rect(60, 100, 100 + 80 + FIT_SLACK_PT.width, 20 + 12 + FIT_SLACK_PT.height),
    });
  });
  it('never shrinks; nothing to grow is no change', () => {
    expect(
      grownTextGeometry({ rect: rect(60, 100, 200, 40) }, { width: 0, height: 0 }, page),
    ).toBeNull();
    expect(
      grownTextGeometry({ rect: rect(60, 100, 200, 40) }, { width: -30, height: 0.3 }, page),
    ).toBeNull();
  });
  it('stays on the page', () => {
    expect(
      grownTextGeometry(
        { rect: rect(500, 800, 80, 20), intent: 'FreeTextTypeWriter' },
        { width: 300, height: 300 },
        page,
      ),
    ).toEqual({ rect: rect(500, 800, 95, 42) });
    expect(
      grownTextGeometry({ rect: rect(60, 822, 200, 20) }, { width: 0, height: 30 }, page),
    ).toBeNull();
  });
  it('a callout: the text box grows down, the line stays, the rect and /RD follow', () => {
    // Box (200, 100, 150 × 40) inside the rect (60, 100, 290 × 160): the line goes down-left.
    const callout = {
      intent: 'FreeTextCallout',
      rect: rect(60, 100, 290, 160),
      rectangleDifferences: { left: 140, top: 0, right: 0, bottom: 120 },
      calloutLine: [{}, {}, {}],
    };
    // 30 pt more: the box ends at 172, still inside the rect.
    expect(grownTextGeometry(callout, { width: 0, height: 30 }, page)).toEqual({
      rect: rect(60, 100, 290, 160),
      rectangleDifferences: { left: 140, top: 0, right: 0, bottom: 88 },
    });
    // 200 pt more: the box ends at 342, below the line: the rect grows with it.
    expect(grownTextGeometry(callout, { width: 0, height: 200 }, page)).toEqual({
      rect: rect(60, 100, 290, 242),
      rectangleDifferences: { left: 140, top: 0, right: 0, bottom: 0 },
    });
  });
  it('leaves a turned comment as it is', () => {
    expect(
      grownTextGeometry(
        { rect: rect(60, 100, 200, 40), rotation: 30 },
        { width: 0, height: 24 },
        page,
      ),
    ).toBeNull();
  });
});
