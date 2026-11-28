import { describe, expect, it } from 'vitest';
import {
  AUTO_SNAP_TOOLS,
  onSnapToggled,
  onToolChange,
  type AutoSnapSession,
} from '../../src/model/autoSnap';

// M13-02 (D-68, ADR-034, owner choice P3): picking a Measure tool or Calibrate
// turns snapping on; when the tool ends, snapping goes back to how it was,
// unless the person changed it meanwhile.

const change = (
  session: AutoSnapSession | null,
  from: string,
  to: string,
  enabled: boolean,
  autoSnap = true,
) => onToolChange(session, { from, to, enabled, autoSnap });

describe('auto snap', () => {
  it('covers the Measure tools, Calibrate and drawing a Scale Viewport', () => {
    expect([...AUTO_SNAP_TOOLS].sort()).toEqual(
      [
        'calibrate',
        'measureAngle',
        'measureRadius',
        'measureDiameter',
        'measureArea',
        'measureLength',
        'measurePolylength',
        'measurePerimeter',
        'scaleViewport',
      ].sort(),
    );
  });

  it('turns snapping on when a Measure tool is picked with snapping off, and says so', () => {
    const r = change(null, 'select', 'measureLength', false);
    expect(r.set).toBe(true);
    expect(r.note).toBe(true);
    expect(r.session).toEqual({ before: false, turnedOn: true, touched: false });
  });

  it('changes nothing when snapping is already on, and leaves it on afterwards', () => {
    const start = change(null, 'select', 'calibrate', true);
    expect(start.set).toBeNull();
    expect(start.note).toBe(false);
    const end = change(start.session, 'calibrate', 'select', true);
    expect(end.set).toBeNull();
    expect(end.session).toBeNull();
  });

  it('turns snapping back off when the tool ends (Esc or another tool)', () => {
    const start = change(null, 'hand', 'measureArea', false);
    const end = change(start.session, 'measureArea', 'highlight', true);
    expect(end.set).toBe(false);
    expect(end.note).toBe(false);
    expect(end.session).toBeNull();
  });

  it('keeps one session while moving between measuring tools', () => {
    const start = change(null, 'select', 'measureLength', false);
    const mid = change(start.session, 'measureLength', 'measurePerimeter', true);
    expect(mid.set).toBeNull();
    expect(mid.note).toBe(false);
    expect(mid.session).toEqual(start.session);
    const viewport = change(mid.session, 'measurePerimeter', 'scaleViewport', true);
    expect(viewport.session).toEqual(start.session);
    const end = change(viewport.session, 'scaleViewport', 'select', true);
    expect(end.set).toBe(false);
  });

  it('leaves snapping as the person set it when they switched it meanwhile', () => {
    const start = change(null, 'select', 'measureLength', false);
    // Switched off and on again: still their choice, so it stays on.
    const touched = onSnapToggled(onSnapToggled(start.session));
    expect(touched?.touched).toBe(true);
    const end = change(touched, 'measureLength', 'select', true);
    expect(end.set).toBeNull();
    expect(end.session).toBeNull();
    // Switched off during measuring: stays off.
    const s2 = change(null, 'select', 'measureArea', false);
    const off = change(onSnapToggled(s2.session), 'measureArea', 'select', false);
    expect(off.set).toBeNull();
  });

  it('does nothing with "Turn on snapping when measuring" cleared', () => {
    const r = change(null, 'select', 'measureLength', false, false);
    expect(r).toEqual({ session: null, set: null, note: false });
    expect(change(null, 'measureLength', 'select', false, false).set).toBeNull();
  });

  it('a switch outside a measuring session is not recorded', () => {
    expect(onSnapToggled(null)).toBeNull();
  });

  it('ignores tool changes that never touch a measuring tool', () => {
    const r = change(null, 'select', 'line', false);
    expect(r).toEqual({ session: null, set: null, note: false });
  });

  it('does not restore over a state that already matches', () => {
    const start = change(null, 'select', 'measureLength', false);
    // Something else (not the person's switch) already turned it off.
    const end = change(start.session, 'measureLength', 'select', false);
    expect(end.set).toBeNull();
    expect(end.session).toBeNull();
  });
});
