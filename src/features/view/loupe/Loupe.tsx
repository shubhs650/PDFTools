import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  covers,
  loupePlace,
  loupeRegion,
  loupeStats,
  type LoupeRegion,
  type Pt,
} from './loupeModel';

/** A region being drawn: the picture, or a rejection when cancelled or failed. */
export interface LoupeJob {
  promise: Promise<ImageBitmap>;
  cancel(): void;
}

/**
 * The loupe beside the pointer (M12-13's alignment magnifier made shared in
 * M13-02, D-68, ADR-034): the spot under the pointer drawn larger by the
 * Render worker — the caller's `draw` asks it; no pixel work here (rule 1) —
 * with a crosshair at the spot and the caller's marks over it (`children`,
 * placed from the lens's centre in CSS px). At most one request in flight and
 * at most one per animation frame, the latest spot wins; a region with a
 * margin is drawn, so small moves only shift the picture already drawn. It
 * flips sides near the window's edges and is hidden from assistive tech
 * (the pointer tools it serves say what they pick in words elsewhere).
 */
export function Loupe({
  client,
  side,
  center,
  zoom,
  sourceKey,
  draw,
  margin = 0.5,
  'data-testid': testId,
  className,
  label,
  children,
}: {
  /** The pointer (CSS px in the window). */
  client: Pt;
  /** The loupe's side (CSS px). */
  side: number;
  /** The spot shown in the middle, in points of the page as displayed. */
  center: Pt;
  /** CSS px per point inside the loupe (the window's zoom × magnification). */
  zoom: number;
  /** Changes when the drawing changes (a new version, another style): draws again. */
  sourceKey: string;
  draw: (region: LoupeRegion) => LoupeJob;
  margin?: number;
  'data-testid'?: string;
  className?: string;
  /** A short text under the lens (the snap kind). */
  label?: string | undefined;
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  /** What the canvas holds (state for the render; the ref for the effect's checks). */
  const [shown, setShown] = useState<{ region: LoupeRegion; key: string } | null>(null);
  const drawn = useRef<{ region: LoupeRegion; key: string } | null>(null);
  const job = useRef<LoupeJob | null>(null);
  const wanted = useRef<{ region: LoupeRegion; key: string } | null>(null);
  const frame = useRef(0);
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(side * dpr);
  const scale = zoom * dpr;

  useEffect(() => {
    const d = drawn.current;
    if (d?.key === sourceKey && covers(d.region, center, scale, px)) {
      wanted.current = null;
      return;
    }
    const w = wanted.current;
    if (w?.key === sourceKey && covers(w.region, center, scale, px)) return;
    wanted.current = { region: loupeRegion(center, scale, px, margin), key: sourceKey };
    const fire = (): void => {
      frame.current = 0;
      const next = wanted.current;
      if (!next || job.current) return;
      wanted.current = null;
      loupeStats.requests++;
      const j = drawRef.current(next.region);
      job.current = j;
      j.promise
        .then(
          (bitmap) => {
            const ctx = canvas.current?.getContext('bitmaprenderer');
            if (!ctx) {
              bitmap.close();
              return;
            }
            const c = canvas.current;
            if (c) {
              c.width = next.region.width;
              c.height = next.region.height;
            }
            ctx.transferFromImageBitmap(bitmap);
            loupeStats.drawn++;
            drawn.current = next;
            setShown(next);
          },
          () => undefined,
        )
        .finally(() => {
          if (job.current === j) job.current = null;
          if (wanted.current && !frame.current) frame.current = requestAnimationFrame(fire);
        });
    };
    if (!job.current && !frame.current) frame.current = requestAnimationFrame(fire);
  }, [center, scale, px, sourceKey, margin]);

  useEffect(
    () => () => {
      wanted.current = null;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      job.current?.cancel();
      job.current = null;
    },
    [],
  );

  const at = loupePlace(client, side, { width: window.innerWidth, height: window.innerHeight });
  // The drawn region placed so the spot sits in the lens's middle (it may lag a frame).
  const d = shown;
  const shift = d
    ? {
        left: (d.region.x - (center.x * scale - px / 2)) / dpr,
        top: (d.region.y - (center.y * scale - px / 2)) / dpr,
        width: d.region.width / dpr,
        height: d.region.height / dpr,
        // A picture of another zoom is hidden until the new one comes.
        visibility: d.region.scale === scale ? undefined : ('hidden' as const),
      }
    : { visibility: 'hidden' as const };
  return createPortal(
    <div
      className={`loupe${className ? ` ${className}` : ''}`}
      data-testid={testId}
      aria-hidden="true"
      style={{ left: at.left, top: at.top, width: side, height: side }}
    >
      <div className="loupe-lens">
        <canvas ref={canvas} className="loupe-picture" style={shift} />
        <span className="loupe-cross" />
        {children}
      </div>
      {label ? (
        <span className="loupe-label" data-testid={testId ? `${testId}-label` : undefined}>
          {label}
        </span>
      ) : null}
    </div>,
    document.body,
  );
}
