// PDF text in Markdown, made inert (M4-05). PDF Oxide writes the page's text
// into Markdown as it is: text that looks like HTML (`<script>`) or a link
// with a `javascript:` target would become live markup in whatever renders the
// file. Oxide itself writes no HTML and no links, so every `<` and `>` is
// escaped, and link targets other than http(s), mailto, a fragment or our own
// relative image paths are broken up. Headings, lists, emphasis and tables
// stay Markdown.

const SAFE_TARGET = /^(https?:|mailto:|#|images\/)/i;

export function inertMarkdown(md: string): string {
  return md
    .replace(/</g, '&lt;')
    .replace(/>(?=[^\n]*)/g, (m, offset: number, s: string) =>
      // A ">" that starts a line is a block quote: keep it.
      offset === 0 || s[offset - 1] === '\n' ? m : '&gt;',
    )
    .replace(/\]\(\s*([^)\s]*)/g, (m, target: string) =>
      SAFE_TARGET.test(target) ? m : `]\\(${target}`,
    );
}
