// Left panes (§5, M2-08). Each pane is a `rail.*` command with a component;
// tasks add theirs here (search results M2-09, bookmarks M2-10, …). The rail
// shows a button for every registered pane, in this order.
import type { ComponentType } from 'react';
import { AttachmentsPane } from '../features/attachments/AttachmentsPane';
import { BookmarksPane } from '../features/bookmarks/BookmarksPane';
import { CommentsPane } from '../features/annotate/comments/CommentsPane';
import { LayersPane } from '../features/layers/LayersPane';
import { MeasurementsPane } from '../features/measure/pane/MeasurementsPane';
import { SearchPane } from '../features/search/SearchPane';
import { SignaturesPane } from '../features/signatures/SignaturesPane';
import { ThumbnailsPane } from '../features/thumbnails/ThumbnailsPane';

export interface PaneDef {
  /** The pane's `rail.*` command id (its label is `command.<id>`). */
  id: string;
  component: ComponentType;
}

export const PANES: readonly PaneDef[] = [
  { id: 'rail.bookmarks', component: BookmarksPane },
  { id: 'rail.thumbnails', component: ThumbnailsPane },
  { id: 'rail.comments', component: CommentsPane },
  // M14-08 (D-76, Q16): next to Comments and Bookmarks.
  { id: 'rail.measurements', component: MeasurementsPane },
  { id: 'rail.search', component: SearchPane },
  { id: 'rail.attachments', component: AttachmentsPane },
  { id: 'rail.layers', component: LayersPane },
  { id: 'rail.signatures', component: SignaturesPane },
];

export const paneById = (id: string): PaneDef | undefined => PANES.find((p) => p.id === id);
