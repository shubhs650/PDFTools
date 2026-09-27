// Sanitizer for error-report text (D-22, §10.2, M2-17, rule 10): defense in
// depth on top of M1-03 (non-RpcError messages never cross a worker boundary
// and only stack frames are kept). Whatever could be document content or say
// something about the user's files is replaced by a placeholder: quoted text,
// blob: and other URLs, file-system paths, document file names and e-mail
// addresses. The app's own script locations are kept (without the origin),
// because they are what a stack frame is for. Pure.

/** Paths of the app's own code, kept in stack frames (built assets, dev sources). */
const OWN_PATH = /^\/(assets|src|node_modules)\/[\w@.\-/]*$|^\/(sw|registerSW)\.m?js$/;

/** Extensions of files people open or attach, never code. */
const DOC_EXT =
  'pdf|fdf|xfdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|tsv|md|xml|json|html?|eml|msg|zip|7z|rar|png|jpe?g|gif|bmp|tiff?|webp|heic|svg|dwg|dxf|dgn|step|stp|igs|iges';

const QUOTED =
  /"(?:\\.|[^"\\])*"|(?<![A-Za-z])'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|“[^”]*”|‘[^’]*’|«[^»]*»/g;
const URL_RE = /\b(?:blob:)?[a-z][a-z0-9+.-]*:\/\/[^\s)'"<>]*/gi;
const BLOB_RE = /\bblob:[^\s)'"<>]*/gi;
const DATA_RE = /\bdata:[^\s)'"<>]*/gi;
const WIN_PATH = /(?:\b[A-Za-z]:[\\/]|\\\\)[^\s:*?"<>|)]*(?:[\\/][^\s:*?"<>|)]*)*/g;
const POSIX_PATH = /(^|[\s(=])(\/[^\s():]+)/g;
const FILE_NAME = new RegExp(`[^\\s:()'"<>]+\\.(?:${DOC_EXT})\\b`, 'gi');
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** A URL as it may appear in a report: the app's own code by path, anything else hidden. */
function url(raw: string, origin: string | null): string {
  if (/^blob:/i.test(raw)) return '<blob>';
  try {
    const u = new URL(raw);
    if (origin && u.origin === origin && OWN_PATH.test(u.pathname)) return u.pathname;
  } catch {
    // not a URL after all: hidden below
  }
  return '<url>';
}

/**
 * Replaces anything that could be content in `text`. `origin` is the app's
 * own origin (its script URLs are kept as paths).
 */
export function redact(text: string, origin: string | null): string {
  // Control characters (but tab and newline) become spaces.
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    out += (n < 32 && n !== 9 && n !== 10) || n === 127 ? ' ' : text.charAt(i);
  }
  out = out.replace(QUOTED, '<text>');
  out = out.replace(URL_RE, (m) => {
    // A stack location may follow the URL: "https://…/a.js:1:2".
    const loc = /((?::\d+){1,2})$/.exec(m)?.[1] ?? '';
    const base = m.slice(0, m.length - loc.length);
    const kept = url(base, origin);
    return kept.startsWith('<') ? kept : kept + loc;
  });
  out = out.replace(BLOB_RE, '<blob>').replace(DATA_RE, '<data>');
  out = out.replace(WIN_PATH, '<path>');
  out = out.replace(POSIX_PATH, (all, pre: string, path: string) => {
    const bare = path.replace(/(?::\d+){1,2}$/, '');
    return OWN_PATH.test(bare) ? all : `${pre}<path>`;
  });
  out = out.replace(EMAIL, '<email>');
  out = out.replace(FILE_NAME, '<file>');
  return out;
}

/** Stack frames for a report: sanitized, trimmed, at most `max` frames of `width` chars. */
export function redactStack(
  stack: string | undefined,
  origin: string | null,
  max: number,
  width: number,
): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at\s|@/.test(l))
    .slice(0, max)
    .map((l) => {
      const clean = redact(l, origin);
      return clean.length > width ? `${clean.slice(0, width - 1)}…` : clean;
    });
}
