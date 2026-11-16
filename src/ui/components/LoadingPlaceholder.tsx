/**
 * A page or thumbnail that is still rendering (M10-08·O5, ADR-027): a soft paper tint
 * with a slow shimmer, instead of blank white. It fills its (positioned) parent and
 * changes no layout; the image replaces it when it arrives. It appears only after a
 * short delay, so a page from the cache never flashes it, and prefers-reduced-motion
 * keeps the tint without the shimmer (ui.css). Decoration only: hidden from assistive
 * tech, like the page images it stands in for (alt="").
 */
export function LoadingPlaceholder() {
  return <div className="ui-placeholder" aria-hidden="true" />;
}
