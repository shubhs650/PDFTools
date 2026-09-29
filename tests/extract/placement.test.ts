import { describe, expect, it } from 'vitest';
import {
  blockTops,
  placeImages,
  splitHtmlBlocks,
  splitMarkdownBlocks,
  textKey,
} from '../../src/workers/work/imagePlacement';
import { inertMarkdown } from '../../src/workers/work/markdownSafe';

const order = (
  blocks: string[],
  lines: { text: string; top: number }[],
  imgs: [string, number, number][],
) =>
  placeImages(
    blockTops(blocks, lines),
    imgs.map(([ref, top, left]) => ({ ref, top, left })),
  ).map((p) => (p.kind === 'image' ? `[${p.ref}]` : blocks[p.index]?.slice(0, 12)));

describe('image placement (M4-05, M4-Q6)', () => {
  const blocks = [
    '## Heading before image',
    'Paragraph one above the picture.',
    'Paragraph two below the picture.',
  ];
  const lines = [
    { text: 'Heading before image', top: 758 },
    { text: 'Paragraph one above the picture.', top: 711 },
    { text: 'Paragraph two below the picture.', top: 491 },
  ];

  it('puts an image between the paragraphs it sits between', () => {
    expect(order(blocks, lines, [['img', 670, 72]])).toEqual([
      '## Heading b',
      'Paragraph on',
      '[img]',
      'Paragraph tw',
    ]);
  });

  it('an image above all text comes first; one below all text comes last', () => {
    expect(
      order(blocks, lines, [
        ['top', 820, 72],
        ['end', 300, 72],
      ]),
    ).toEqual(['[top]', '## Heading b', 'Paragraph on', 'Paragraph tw', '[end]']);
  });

  it('a full-page image (top at the page top) comes first', () => {
    expect(order(blocks, lines, [['page', 842, 0]])[0]).toBe('[page]');
  });

  it('two images side by side: left one first', () => {
    expect(
      order(blocks, lines, [
        ['right', 600, 300],
        ['left', 600, 72],
      ]),
    ).toEqual(['## Heading b', 'Paragraph on', '[left]', '[right]', 'Paragraph tw']);
  });

  it('a block with no matching line inherits the previous top', () => {
    const b = [
      '## Heading before image',
      '| a | b |\n| --- | --- |',
      'Paragraph two below the picture.',
    ];
    expect(blockTops(b, lines)).toEqual([758, 758, 491]);
    expect(blockTops(['unmatched'], lines)).toEqual([Number.POSITIVE_INFINITY]);
  });

  it('matches through Markdown and HTML markup and entities', () => {
    expect(textKey('**Bold** _it_ [link](http://x) `code`')).toBe('bolditlinkcode');
    expect(textKey('<p>Tom &amp; Jerry</p>')).toBe('tomjerry');
    expect(blockTops(['<h2>Heading before image</h2>'], lines)).toEqual([758]);
  });

  it('two-column page: Oxide order kept, image by its top (documented limit)', () => {
    const cols = ['Left col one', 'Left col two', 'Right col one'];
    const colLines = [
      { text: 'Left col one', top: 700 },
      { text: 'Left col two', top: 500 },
      { text: 'Right col one', top: 700 },
    ];
    // An image at the top of the right column goes before the right column's
    // first block only if it is lower than the left column's blocks too.
    expect(order(cols, colLines, [['r', 690, 320]])).toEqual([
      'Left col one',
      '[r]',
      'Left col two',
      'Right col on', // (first 12 characters)
    ]);
  });
});

describe('block splitting (M4-05)', () => {
  it('splits Markdown at blank lines, keeps fenced code whole', () => {
    expect(
      splitMarkdownBlocks('# A\n\npara\nline 2\n\n```\ncode\n\nmore\n```\n\n\n- x\n- y\n'),
    ).toEqual(['# A', 'para\nline 2', '```\ncode\n\nmore\n```', '- x\n- y']);
  });

  it('splits Oxide HTML by element lines', () => {
    expect(splitHtmlBlocks('<h2>A</h2>\n<p>B</p>\n\n')).toEqual(['<h2>A</h2>', '<p>B</p>']);
  });
});

describe('inert Markdown (M4-05)', () => {
  it('escapes HTML-looking text and breaks unsafe link targets', () => {
    expect(inertMarkdown('<script>alert(1)</script> & a > b')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; & a &gt; b',
    );
    expect(
      inertMarkdown('[x](javascript:alert(3)) [y](https://e.com) [z](images/page-1-image-1.png)'),
    ).toBe('[x]\\(javascript:alert(3)) [y](https://e.com) [z](images/page-1-image-1.png)');
  });

  it('keeps Markdown structure: headings, lists, quotes, tables, emphasis', () => {
    const md = '## Title\n\n- item\n1. one\n> quote\n| a | b |\n| --- | --- |\n**bold**';
    expect(inertMarkdown(md)).toBe(md);
  });
});
