import { useSnapping } from './snapping';

/**
 * Where the pointer snaps (M3-18): a marker whose shape tells the kind —
 * square endpoint, triangle midpoint, cross intersection, circle nearest (CAD
 * convention). Visual only; the snapped point is what the tool uses.
 */
export function SnapMarker({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const m = useSnapping((s) =>
    s.marker?.docId === documentId && s.marker.page === pageIndex ? s.marker : null,
  );
  if (!m) return null;
  return (
    <div className="snap-layer" aria-hidden="true">
      <span
        className={`snap-marker snap-marker--${m.kind}`}
        data-testid="snap-marker"
        data-kind={m.kind}
        style={{ left: m.x * scale, top: m.y * scale }}
      />
    </div>
  );
}
