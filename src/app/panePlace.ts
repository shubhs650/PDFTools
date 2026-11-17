import { keepPlace } from '../features/view/controller';
import { appStore, type AppState } from './store/appStore';

/** Whether a store change changes the document view's width: a side pane shown, hidden or resized. */
export function panesChanged(a: AppState, b: AppState): boolean {
  return (
    a.leftPaneOpen !== b.leftPaneOpen ||
    a.leftPaneWidth !== b.leftPaneWidth ||
    a.propertiesOpen !== b.propertiesOpen ||
    a.propertiesWidth !== b.propertiesWidth
  );
}

/**
 * The document keeps its place while a side pane is shown, hidden or resized, from the
 * arrows, the splitters, the rail or the ribbon (M11-10, D-56). Returns the unsubscribe.
 */
export function followPanes(): () => void {
  return appStore.subscribe((next, prev) => {
    if (panesChanged(prev, next)) keepPlace();
  });
}
