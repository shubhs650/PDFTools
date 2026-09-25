import type { createFluentIcon } from '@fluentui/react-icons/utils';

/** A Fluent-compatible icon component (Fluent's own or ours, same props). */
export type IconComponent = ReturnType<typeof createFluentIcon>;

export interface GlyphSet {
  /** 20 px glyph: small buttons, panes, status bar, collapsed ribbon. */
  small: IconComponent;
  /** Large-button glyph (only for large commands). */
  large?: IconComponent;
  /** Native size of `large`; 24 or 28 are scaled to 32 px (ADR-010 d2). */
  largeNative?: number;
}

export interface FluentGlyphs {
  regular: GlyphSet;
  /** Filled variant for the pressed/active state of toggles (ADR-010). */
  filled?: GlyphSet;
}
