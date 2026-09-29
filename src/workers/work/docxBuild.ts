// Word export, the document builder (M4-07, §7.6, ADR-009 decision 5, M4-Q6):
// PDF Oxide's Markdown → mdast (mdast-util-from-markdown with GFM tables) →
// `docx`. Loaded lazily by the Work worker (its own chunk, background
// precache); nothing here runs on the main thread (rule 1). Images arrive
// already placed in reading order (imagePlacement.ts). Raw HTML in the
// Markdown is PDF text, so it becomes plain text; links keep only http(s) and
// mailto targets. Beta: headings, paragraphs, emphasis, lists, tables and
// images map to Word styles; column layout and fonts are not reproduced.
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import type { Nodes, PhrasingContent, Root, RootContent, TableRow as MdRow } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';

export type WordItem =
  | { kind: 'markdown'; text: string }
  | { kind: 'image'; png: Uint8Array; width: number; height: number; alt: string };

export interface WordPage {
  items: WordItem[];
}

export interface WordOptions {
  title: string;
  /** Start each PDF page on a new Word page. */
  pageBreaks: boolean;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/** Largest image width: the text width of a Letter/A4 page at 1 in margins, in pixels (96 dpi). */
export const MAX_IMAGE_PX = 600;
const SAFE_LINK = /^(https?:|mailto:)/i;

export function parseMarkdown(md: string): Root {
  return fromMarkdown(md, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] });
}

interface Style {
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
}

function runs(nodes: readonly PhrasingContent[], style: Style = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const text = (t: string, s: Style) =>
    new TextRun({
      text: t,
      ...(s.bold ? { bold: true } : {}),
      ...(s.italics ? { italics: true } : {}),
      ...(s.code ? { font: 'Consolas' } : {}),
    });
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out.push(text(n.value, style));
        break;
      case 'strong':
        out.push(...runs(n.children, { ...style, bold: true }));
        break;
      case 'emphasis':
        out.push(...runs(n.children, { ...style, italics: true }));
        break;
      case 'inlineCode':
        out.push(text(n.value, { ...style, code: true }));
        break;
      case 'break':
        out.push(new TextRun({ break: 1 }));
        break;
      case 'html':
        // PDF text that looks like markup: kept as text, never interpreted.
        out.push(text(n.value, style));
        break;
      case 'link': {
        const inner = runs(n.children, style);
        if (SAFE_LINK.test(n.url))
          out.push(new ExternalHyperlink({ link: n.url, children: inner }));
        else out.push(...inner);
        break;
      }
      default:
        if ('children' in n) out.push(...runs(n.children, style));
        else if ('value' in n) out.push(text(String(n.value), style));
    }
  }
  return out;
}

const plain = (n: Nodes): string =>
  'value' in n ? n.value : 'children' in n ? n.children.map((c) => plain(c as Nodes)).join('') : '';

class Builder {
  readonly children: (Paragraph | Table)[] = [];
  private lists = 0;

  block(n: RootContent, depth = 0): void {
    switch (n.type) {
      case 'heading':
        this.children.push(
          new Paragraph({
            heading: HEADINGS[Math.min(6, n.depth) - 1] ?? HeadingLevel.HEADING_6,
            children: runs(n.children),
          }),
        );
        break;
      case 'paragraph':
        this.children.push(new Paragraph({ children: runs(n.children) }));
        break;
      case 'list': {
        const instance = ++this.lists;
        for (const item of n.children)
          for (const [i, c] of item.children.entries()) {
            if (c.type === 'list') {
              this.block(c, depth + 1);
              continue;
            }
            const kids = c.type === 'paragraph' ? runs(c.children) : [new TextRun(plain(c))];
            this.children.push(
              new Paragraph({
                children: kids,
                ...(i > 0
                  ? { indent: { left: 720 * (depth + 1) } }
                  : n.ordered
                    ? { numbering: { reference: 'ordered', level: Math.min(depth, 8), instance } }
                    : { bullet: { level: Math.min(depth, 8) } }),
              }),
            );
          }
        break;
      }
      case 'table':
        this.children.push(this.table(n.children));
        break;
      case 'code':
        for (const line of n.value.split('\n'))
          this.children.push(
            new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }),
          );
        break;
      case 'blockquote':
        for (const c of n.children)
          this.children.push(
            new Paragraph({
              indent: { left: 720 },
              children: c.type === 'paragraph' ? runs(c.children) : [new TextRun(plain(c))],
            }),
          );
        break;
      case 'html':
        this.children.push(new Paragraph({ children: [new TextRun(n.value)] }));
        break;
      case 'thematicBreak':
        break;
      default:
        if (plain(n).trim()) this.children.push(new Paragraph(plain(n)));
    }
  }

  private table(rows: MdRow[]): Table {
    const cols = Math.max(1, ...rows.map((r) => r.children.length));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        (r, ri) =>
          new TableRow({
            tableHeader: ri === 0,
            children: Array.from({ length: cols }, (_, ci) => {
              const cell = r.children[ci];
              const kids = cell ? runs(cell.children, ri === 0 ? { bold: true } : {}) : [];
              return new TableCell({ children: [new Paragraph({ children: kids })] });
            }),
          }),
      ),
    });
  }

  image(it: Extract<WordItem, { kind: 'image' }>): void {
    const scale = Math.min(1, MAX_IMAGE_PX / Math.max(1, it.width));
    this.children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: it.png,
            transformation: {
              width: Math.round(it.width * scale),
              height: Math.round(it.height * scale),
            },
            altText: { name: it.alt, description: it.alt, title: it.alt },
          }),
        ],
      }),
    );
  }
}

export function buildDocument(pages: readonly WordPage[], o: WordOptions): Document {
  const b = new Builder();
  pages.forEach((page, pi) => {
    const start = b.children.length;
    for (const it of page.items) {
      if (it.kind === 'image') b.image(it);
      else for (const n of parseMarkdown(it.text).children) b.block(n);
    }
    if (o.pageBreaks && pi > 0) {
      const first = b.children[start];
      if (first instanceof Paragraph || first === undefined)
        b.children.splice(start, 0, new Paragraph({ pageBreakBefore: true, children: [] }));
    }
  });
  return new Document({
    title: o.title,
    creator: '',
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${String(level + 1)}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: b.children.length ? b.children : [new Paragraph('')] }],
  });
}

/** The .docx bytes (a ZIP built by `docx`, in the Work worker). */
export async function buildDocx(pages: readonly WordPage[], o: WordOptions): Promise<Uint8Array> {
  const blob = await Packer.toBlob(buildDocument(pages, o));
  return new Uint8Array(await blob.arrayBuffer());
}
