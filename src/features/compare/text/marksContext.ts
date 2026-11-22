// The context every page's mark layer of a text comparison reads (M12-19, D-64).
import { createContext } from 'react';
import type { HfBands } from '../../../model/compare/text/headers';
import type { Mark, MarkColours, Side } from '../../../model/compare/textView';
import type { BandEdit } from './textFlow';

/** What every page's mark layer of one text comparison reads (M12-19, D-64). */
export interface MarksContext {
  marks: Record<Side, Map<number, Mark[]>>;
  colours: MarkColours;
  /** The entry in use: its marks are outlined. */
  selected: number | null;
  /** Hand-drawn header and footer bands being edited (null: not drawing). */
  bands: BandEdit | null;
  setBand: (side: Side, edge: keyof HfBands, pt: number) => void;
  sideName: (side: Side) => string;
}

const EMPTY: MarksContext = {
  marks: { a: new Map(), b: new Map() },
  colours: { deleted: '', inserted: '', replaced: '', moved: '' },
  selected: null,
  bands: null,
  setBand: () => undefined,
  sideName: () => '',
};

export const TextMarks = createContext<MarksContext>(EMPTY);
