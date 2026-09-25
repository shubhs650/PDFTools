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

/** Glyph sets for commands whose `custom` field names one of these ids. */
export const CUSTOM_GLYPHS: Record<string, FluentGlyphs> = {
  'file.saveOptimized': {
    regular: { small: SaveOptimized20Regular, large: SaveOptimized32Regular, largeNative: 32 },
  },
  'view.continuousFacing': {
    regular: { small: ContinuousFacing20Regular },
    filled: { small: ContinuousFacing20Filled },
  },
};
