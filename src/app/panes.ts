// Left panes (§5, M2-08). Each pane is a `rail.*` command with a component;
// tasks add theirs here (search results M2-09, bookmarks M2-10, …). The rail
// shows a button for every registered pane, in this order.
import type { ComponentType } from 'react';
import { ThumbnailsPane } from '../features/thumbnails/ThumbnailsPane';

export interface PaneDef {
  /** The pane's `rail.*` command id (its label is `command.<id>`). */
  id: string;
  component: ComponentType;
}

export const PANES: readonly PaneDef[] = [{ id: 'rail.thumbnails', component: ThumbnailsPane }];

export const paneById = (id: string): PaneDef | undefined => PANES.find((p) => p.id === id);
