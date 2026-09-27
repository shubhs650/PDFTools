// Custom icons (ADR-010 decision 3): created with Fluent's own factory, so they
// take the same props and styling as Fluent icons.
import { createFluentIcon } from '@fluentui/react-icons/utils';
import type { FluentGlyphs } from '../types';
import {
  CONTINUOUS_FACING_FILLED,
  CONTINUOUS_FACING_REGULAR,
  SAVE_OPTIMIZED_REGULAR,
  scalePath,
} from './paths';
import { M3_DESIGNS, type Design } from './m3';

const at32 = (paths: string[]): string[] => paths.map((d) => scalePath(d, 1.6));

export const SaveOptimized20Regular = createFluentIcon(
  'SaveOptimized20Regular',
  '20',
  SAVE_OPTIMIZED_REGULAR,
);
export const SaveOptimized32Regular = createFluentIcon(
  'SaveOptimized32Regular',
  '32',
  at32(SAVE_OPTIMIZED_REGULAR),
);
export const ContinuousFacing20Regular = createFluentIcon(
  'ContinuousFacing20Regular',
  '20',
  CONTINUOUS_FACING_REGULAR,
);
export const ContinuousFacing20Filled = createFluentIcon(
  'ContinuousFacing20Filled',
  '20',
  CONTINUOUS_FACING_FILLED,
);

/** Fluent-style components for one M3 design: 20 px, and 32 px for large buttons (M3-06). */
function glyphs(id: string, design: Design, large: boolean): FluentGlyphs {
  const name = id.replace(/[^A-Za-z0-9]/g, '_');
  const set = (variant: 'regular' | 'filled') => {
    const draw = design[variant];
    const small = createFluentIcon(`${name}20${variant}`, '20', draw(1));
    return large
      ? { small, large: createFluentIcon(`${name}32${variant}`, '32', draw(1.6)), largeNative: 32 }
      : { small };
  };
  return { regular: set('regular'), filled: set('filled') };
}

const M3_GLYPHS: Record<string, FluentGlyphs> = Object.fromEntries(
  Object.entries(M3_DESIGNS).map(([id, d]) => [id, glyphs(id, d.design, d.large === true)]),
);

/** Glyph sets for commands whose `custom` field names one of these ids. */
export const CUSTOM_GLYPHS: Record<string, FluentGlyphs> = {
  ...M3_GLYPHS,
  'file.saveOptimized': {
    regular: { small: SaveOptimized20Regular, large: SaveOptimized32Regular, largeNative: 32 },
  },
  'view.continuousFacing': {
    regular: { small: ContinuousFacing20Regular },
    filled: { small: ContinuousFacing20Filled },
  },
};
