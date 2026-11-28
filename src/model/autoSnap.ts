// Automatic snapping while measuring (M13-02, D-68, ADR-034, owner choice P3).
// Picking a Measure tool, Calibrate or drawing a Scale Viewport turns snapping
// on (a short note says so); when the measuring ends (Esc or another tool),
// snapping goes back to how it was — unless the person switched snapping
// themselves meanwhile, which is then their choice and stays. Moving between
// measuring tools is one session. Pure: the caller applies `set`.

/** The tools that measure (tool ids as the app store names them). */
export const AUTO_SNAP_TOOLS: ReadonlySet<string> = new Set([
  'measureLength',
  'measurePolylength',
  'measurePerimeter',
  'measureArea',
  'measureAngle',
  'measureRadius',
  'measureDiameter',
  'calibrate',
  'scaleViewport',
]);

export interface AutoSnapSession {
  /** Snapping before the measuring started. */
  before: boolean;
  /** This session turned snapping on. */
  turnedOn: boolean;
  /** The person switched snapping during the session. */
  touched: boolean;
}

export interface AutoSnapStep {
  session: AutoSnapSession | null;
  /** Snapping to apply now (null: leave it). */
  set: boolean | null;
  /** Show the "snapping on for measuring" note. */
  note: boolean;
}

export function onToolChange(
  session: AutoSnapSession | null,
  { to, enabled, autoSnap }: { from: string; to: string; enabled: boolean; autoSnap: boolean },
): AutoSnapStep {
  const measuring = AUTO_SNAP_TOOLS.has(to);
  if (measuring) {
    // Already measuring (another measuring tool): the same session.
    if (session) return { session, set: null, note: false };
    if (!autoSnap) return { session: null, set: null, note: false };
    return {
      session: { before: enabled, turnedOn: !enabled, touched: false },
      set: enabled ? null : true,
      note: !enabled,
    };
  }
  if (!session) return { session: null, set: null, note: false };
  const restore = session.turnedOn && !session.touched && enabled !== session.before;
  return { session: null, set: restore ? session.before : null, note: false };
}

/** The person switched snapping (status bar, ribbon, key): their choice wins at the end. */
export function onSnapToggled(session: AutoSnapSession | null): AutoSnapSession | null {
  return session ? { ...session, touched: true } : null;
}
