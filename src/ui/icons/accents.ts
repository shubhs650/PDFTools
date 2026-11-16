// Icon accents (M10-08·O1, ADR-027 D-47, review R16): a second icon colour on about ten
// key tools, so the ribbon gets a few landmarks without turning into a toy. The glyphs
// stay Fluent Regular (ADR-010, rule 15); only their colour changes, and only through the
// --color-icon-<role> tokens (src/ui/tokens.css), which are contrast-tested in both themes
// and hand over to the system colours in forced-colors mode.
//
// An accent shows only at rest and on hover: a pressed toggle keeps the one pressed look
// (brand tint plus brand Filled icon, D-47), and a disabled command stays grey (Q3).

/**
 * The accent roles and their hues: markup is amber (the yellow highlight and notes draw
 * on the page), sign is green, convert is violet, redact is red (it removes content for
 * good). Named by role, so a hue can change without renaming tokens.
 */
export const ICON_ACCENT_ROLES = ['markup', 'sign', 'convert', 'redact'] as const;
export type IconAccent = (typeof ICON_ACCENT_ROLES)[number];

/** Command id → accent role. Keep it short: landmarks, not decoration. */
export const ICON_ACCENTS: Readonly<Record<string, IconAccent>> = {
  'comment.highlight': 'markup',
  'comment.stickyNote': 'markup',
  'protect.signDocument': 'sign',
  'protect.signatures': 'sign',
  'convert.ocr': 'convert',
  'convert.word': 'convert',
  'convert.expressExtract': 'convert',
  'protect.markRedaction': 'redact',
  'protect.markRedactionArea': 'redact',
  'protect.applyRedactions': 'redact',
};

/** The accent a command's icon shows, if any; never while the command is pressed. */
export function iconAccentFor(commandId: string, pressed = false): IconAccent | undefined {
  return pressed ? undefined : ICON_ACCENTS[commandId];
}
