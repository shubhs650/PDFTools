// Markups drawn as annotation tiles (M3-05, ADR-014 decision 3): one
// transparent image over each content tile, holding only the annotations that
// meet it, drawn by the Render worker from their own appearance streams. The
// tiles follow the tiling plugin's visible set (same rects and scales), are
// re-drawn after every committed edit of the document, and leave out the
// selected annotations, which the annotation plugin's layer draws while they
// are being edited. Encoding happens in the encoder worker (rule 1).
// Neighbouring tiles overlap (TILE_OVERLAP_PX); each annotation tile hides
// the strip it shares with the tile to its left and above (M7-07), as the
// images are transparent: a 50 % highlight would otherwise show darker seams.
import { useDocumentState } from '@embedpdf/core/react';
import type { Tile } from '@embedpdf/plugin-tiling';
import { useTilingCapability } from '@embedpdf/plugin-tiling/react';
import { useEffect, useRef, useState } from 'react';
import { useDocuments } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import { renderEngine } from '../view/host';
import { TILE_OVERLAP_PX } from '../view/plugins';
import { useSelectedIds } from './selection';

interface Frame {
  height: number;
  originX: number;
  originY: number;
}

function AnnotTileImg({
  documentId,
  pageIndex,
  tile,
  scale,
  frame,
  version,
  exclude,
}: {
  documentId: string;
  pageIndex: number;
  tile: Tile;
  scale: number;
  frame: Frame;
  version: number;
  exclude: readonly string[];
}) {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const excludeKey = exclude.join('\n');
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(tile.screenRect.size.width * dpr));
    const height = Math.max(1, Math.round(tile.screenRect.size.height * dpr));
    const r = renderEngine();
    const job = r.rpc.call('annotationTile', {
      docId: documentId,
      frame,
      pageIndex,
      x: tile.pageRect.origin.x,
      y: tile.pageRect.origin.y,
      w: tile.pageRect.size.width,
      h: tile.pageRect.size.height,
      width,
      height,
      exclude: excludeKey ? excludeKey.split('\n') : [],
    });
    let live = true;
    let encode: { cancel(): void } | null = null;
    const show = (next: string | null): void => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = next;
      setUrl(next);
    };
    job.promise.then(
      (pixels) => {
        if (!live) return;
        if (!pixels) {
          show(null);
          return;
        }
        const enc = r.encoder.call(
          'encode',
          { data: pixels.data, width, height, type: 'image/png' },
          { transfer: [pixels.data.buffer] },
        );
        encode = enc;
        enc.promise.then(
          (blob) => {
            if (live) show(URL.createObjectURL(blob));
          },
          (err: unknown) => {
            if (!isAbortError(err)) throw err;
          },
        );
      },
      (err: unknown) => {
        if (!isAbortError(err)) throw err;
      },
    );
    return () => {
      live = false;
      job.cancel();
      encode?.cancel();
    };
    // The frame is fixed per page; the tile id covers rect and scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, pageIndex, tile.id, version, excludeKey]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );
  if (!url) return null;
  const k = scale / tile.srcScale;
  // The strip shared with the tile to the left and above is left to that tile.
  // A box with overflow hidden, not a clip-path: the browser snaps a box to
  // whole pixels as it does the neighbour's image edge, so the two meet with
  // no pixel drawn twice and none half-covered (a clip-path edge is blended).
  const cutTop = tile.row > 0 ? TILE_OVERLAP_PX * k : 0;
  const cutLeft = tile.col > 0 ? TILE_OVERLAP_PX * k : 0;
  const width = tile.screenRect.size.width * k;
  const height = tile.screenRect.size.height * k;
  return (
    <div
      style={{
        position: 'absolute',
        left: tile.screenRect.origin.x * k + cutLeft,
        top: tile.screenRect.origin.y * k + cutTop,
        width: width - cutLeft,
        height: height - cutTop,
        overflow: 'hidden',
      }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: -cutLeft,
          top: -cutTop,
          width,
          height,
          display: 'block',
        }}
      />
    </div>
  );
}

export function AnnotationTileLayer({
  documentId,
  pageIndex,
  scale,
}: {
  documentId: string;
  pageIndex: number;
  scale: number;
}) {
  const { provides: tiling } = useTilingCapability();
  const [tiles, setTiles] = useState<Tile[]>([]);
  const doc = useDocumentState(documentId);
  const page = doc?.document?.pages[pageIndex];
  // Every committed edit of the document (M1-22's edit counter) re-draws the tiles.
  const version = useDocuments((s) => s.docs[documentId]?.edits ?? 0);
  const exclude = useSelectedIds(documentId, pageIndex);

  useEffect(() => {
    if (!tiling) return;
    return tiling.onTileRendering((event) => {
      if (event.documentId === documentId) setTiles(event.tiles[pageIndex] ?? []);
    });
  }, [tiling, documentId, pageIndex]);

  if (!page) return null;
  const crop = page.boxes?.crop;
  const frame: Frame = {
    height: page.size.height,
    originX: crop?.left ?? 0,
    originY: crop?.bottom ?? 0,
  };
  return (
    <div className="annotation-tiles" aria-hidden>
      {tiles.map((tile) => (
        <AnnotTileImg
          key={tile.id}
          documentId={documentId}
          pageIndex={pageIndex}
          tile={tile}
          scale={scale}
          frame={frame}
          version={version}
          exclude={exclude}
        />
      ))}
    </div>
  );
}
