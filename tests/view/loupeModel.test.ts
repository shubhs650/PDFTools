import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOUPE,
  LOUPE_SIDES,
  covers,
  loupePlace,
  loupeRegion,
  loupeShown,
  toggleLoupeHere,
  parseLoupeSettings,
} from '../../src/features/view/loupe/loupeModel';

// M13-02 (D-68, ADR-034): the shared loupe's geometry — where it sits beside
// the pointer, which region of the page it asks the Render worker for, and
// when the region drawn last still covers the spot (no new request).

describe('loupe placement', () => {
  const vw = { width: 1366, height: 768 };
  it('sits above and to the right of the pointer', () => {
    expect(loupePlace({ x: 500, y: 400 }, 160, vw)).toEqual({ left: 524, top: 216 });
  });
  it('flips below near the top of the window', () => {
    expect(loupePlace({ x: 500, y: 100 }, 160, vw).top).toBe(124);
  });
  it('flips to the left near the right edge', () => {
    expect(loupePlace({ x: 1300, y: 400 }, 160, vw).left).toBe(1300 - 24 - 160);
  });
  it('stays inside a tiny window', () => {
    const p = loupePlace({ x: 10, y: 10 }, 160, { width: 150, height: 150 });
    expect(p.left).toBeGreaterThanOrEqual(4);
    expect(p.top).toBeGreaterThanOrEqual(4);
  });
});

describe('loupe region', () => {
  it('asks for a square of the loupe side plus a margin, centred on the spot', () => {
    // 160 CSS px at dpr 2 → 320 device px; margin ½ side each way → 640 px.
    const r = loupeRegion({ x: 100, y: 50 }, 8, 320, 0.5);
    expect(r).toEqual({ x: 800 - 320, y: 400 - 320, width: 640, height: 640, scale: 8 });
  });
  it('rounds to whole device pixels', () => {
    const r = loupeRegion({ x: 10.3, y: 20.7 }, 3, 101, 0);
    expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true);
    expect(r.width).toBe(101);
  });
  it('reuses the region drawn while the loupe stays inside it', () => {
    const r = loupeRegion({ x: 100, y: 100 }, 4, 200, 0.5);
    expect(covers(r, { x: 100, y: 100 }, 4, 200)).toBe(true);
    // 40 points right = 160 device px: the loupe's right edge passes the region's.
    expect(covers(r, { x: 140, y: 100 }, 4, 200)).toBe(false);
    expect(covers(r, { x: 120, y: 100 }, 4, 200)).toBe(true);
    // Another scale never reuses.
    expect(covers(r, { x: 100, y: 100 }, 8, 200)).toBe(false);
  });
});

describe('loupe settings', () => {
  it('defaults: on, medium, 4×, snapping turned on when measuring', () => {
    expect(DEFAULT_LOUPE).toEqual({
      on: true,
      size: 'medium',
      mag: 4,
      autoSnap: true,
      anywhere: false,
    });
    expect(parseLoupeSettings(null)).toEqual(DEFAULT_LOUPE);
  });
  it('keeps valid stored values and drops anything else', () => {
    expect(parseLoupeSettings('{"on":false,"size":"large","mag":8,"autoSnap":false}')).toEqual({
      on: false,
      size: 'large',
      mag: 8,
      autoSnap: false,
      anywhere: false, // stored before View → Loupe (M13-02·O1)
    });
    expect(parseLoupeSettings('{"anywhere":true}')).toEqual({ ...DEFAULT_LOUPE, anywhere: true });
    expect(parseLoupeSettings('{"anywhere":1}')).toEqual(DEFAULT_LOUPE);
    expect(parseLoupeSettings('{"size":"huge","mag":3,"on":"yes"}')).toEqual(DEFAULT_LOUPE);
    expect(parseLoupeSettings('not json')).toEqual(DEFAULT_LOUPE);
  });
  it('has three sizes, growing', () => {
    expect(LOUPE_SIDES.small).toBeLessThan(LOUPE_SIDES.medium);
    expect(LOUPE_SIDES.medium).toBeLessThan(LOUPE_SIDES.large);
  });
});

// M13-02·O1 (D-68): View → Loupe shows the loupe in every tool; otherwise it
// shows only with the tools it serves, while the Measure ribbon's Loupe is on.
describe('loupeShown', () => {
  const served = new Set(['measureLength', 'calibrate']);
  it('shows with the served tools while the Measure loupe is on', () => {
    expect(loupeShown(DEFAULT_LOUPE, 'measureLength', served)).toBe(true);
    expect(loupeShown(DEFAULT_LOUPE, 'calibrate', served)).toBe(true);
    expect(loupeShown(DEFAULT_LOUPE, 'select', served)).toBe(false);
    expect(loupeShown({ ...DEFAULT_LOUPE, on: false }, 'measureLength', served)).toBe(false);
  });
  it('shows in every tool with View → Loupe, whatever the Measure loupe says', () => {
    const any = { ...DEFAULT_LOUPE, anywhere: true };
    for (const tool of ['select', 'hand', 'highlight', 'measureLength'])
      expect(loupeShown(any, tool, served)).toBe(true);
    expect(loupeShown({ ...any, on: false }, 'measureLength', served)).toBe(true);
  });
});

// M13-09 (D-68): the loupe's key (M) shows or hides the loupe where the person is:
// shown → off (both switches that show it here); hidden → on with the switch that
// serves this tool (the Measure loupe for Measure and line tools, View › Loupe otherwise).
describe('toggleLoupeHere', () => {
  const served = new Set(['measureLength', 'line']);
  it('turns the Measure loupe on in a tool it serves', () => {
    const off = { ...DEFAULT_LOUPE, on: false };
    expect(toggleLoupeHere(off, 'measureLength', served)).toEqual({ on: true });
  });
  it('turns the Measure loupe off in a tool it serves', () => {
    expect(toggleLoupeHere(DEFAULT_LOUPE, 'line', served)).toEqual({ on: false });
  });
  it('turns View › Loupe on in any other tool', () => {
    expect(toggleLoupeHere(DEFAULT_LOUPE, 'select', served)).toEqual({ anywhere: true });
  });
  it('turns View › Loupe off in any other tool', () => {
    const any = { ...DEFAULT_LOUPE, anywhere: true };
    expect(toggleLoupeHere(any, 'hand', served)).toEqual({ anywhere: false });
  });
  it('hides it in a served tool even when View › Loupe shows it', () => {
    const both = { ...DEFAULT_LOUPE, anywhere: true };
    expect(toggleLoupeHere(both, 'measureLength', served)).toEqual({
      on: false,
      anywhere: false,
    });
    const anyOnly = { ...DEFAULT_LOUPE, on: false, anywhere: true };
    expect(
      loupeShown({ ...anyOnly, ...toggleLoupeHere(anyOnly, 'line', served) }, 'line', served),
    ).toBe(false);
  });
  it('always flips what the person sees', () => {
    for (const on of [true, false])
      for (const anywhere of [true, false])
        for (const tool of ['measureLength', 'select']) {
          const s = { ...DEFAULT_LOUPE, on, anywhere };
          const next = { ...s, ...toggleLoupeHere(s, tool, served) };
          expect(loupeShown(next, tool, served)).toBe(!loupeShown(s, tool, served));
        }
  });
});
