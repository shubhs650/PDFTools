// M13-07 (D-71): a snapshot's region is the markup's box as the page is
// shown, so a comment on a turned page (/Rotate) shows that comment, not the
// whole sheet.
import { describe, expect, it } from 'vitest';
import { displayBox } from '../../src/workers/work/crs';

// An A3 sheet stored portrait (842 × 1191 pt) and a box near its top left.
const box = { x: 100, y: 50, width: 40, height: 20 };

describe('displayBox', () => {
  it('leaves an unturned page alone', () => {
    expect(displayBox(box, { width: 842, height: 1191 }, 0)).toEqual(box);
  });

  it('turns the box with the page (the shown size is given)', () => {
    // 90° clockwise: the unrotated top left goes to the shown top right.
    expect(displayBox(box, { width: 1191, height: 842 }, 1)).toEqual({
      x: 1191 - 70,
      y: 100,
      width: 20,
      height: 40,
    });
    expect(displayBox(box, { width: 842, height: 1191 }, 2)).toEqual({
      x: 842 - 140,
      y: 1191 - 70,
      width: 40,
      height: 20,
    });
    expect(displayBox(box, { width: 1191, height: 842 }, 3)).toEqual({
      x: 50,
      y: 842 - 140,
      width: 20,
      height: 40,
    });
  });
});
