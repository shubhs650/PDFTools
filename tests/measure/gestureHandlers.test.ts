// M14-02 (D-78, ADR-035, Bug 1 / Q19): EmbedPDF makes new pointer handlers for
// a page on every zoom and whenever the page is laid out again. A measurement
// in progress must carry on in the new handler: the next click continues it.
// Test-first against the handler factories, with the plugin's context faked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PdfAnnotationObject } from '@embedpdf/models';
import type { HandlerContext } from '../../src/features/annotate/tools/drawTools';
import { cancelDrawing, finishDrawing } from '../../src/features/annotate/tools/drawTools';
import { dimensionHandlerFactory } from '../../src/features/measure/dimensionTool';
import { cancelMeasure, currentGesture, installGestures } from '../../src/features/measure/gesture';
import { measureStore } from '../../src/features/measure/measureStore';
import { vertexHandlerFactory } from '../../src/features/measure/vertexTool';

type Ctx = HandlerContext & {
  onPreview: ReturnType<typeof vi.fn>;
  onCommit: ReturnType<typeof vi.fn>;
};

function context(scale: number, pageIndex = 0): Ctx {
  return {
    pageIndex,
    pageSize: { width: 595, height: 842 },
    pageRotation: 0,
    scale,
    services: {},
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    getTool: () => ({ defaults: { strokeColor: '#E44234', strokeWidth: 1 } }),
    getToolContext: () => undefined,
  } as unknown as Ctx;
}

const evt = {} as never;
const click = (h: ReturnType<typeof dimensionHandlerFactory.create>, x: number, y: number) => {
  h.onPointerMove?.({ x, y }, evt, 'm');
  h.onClick?.({ x, y }, evt, 'm');
};

// Enter and Esc reach the gesture through drawTools' providers.
installGestures({ getPlugin: () => null } as never);

afterEach(() => {
  cancelMeasure();
});

describe('a view change between clicks keeps the measurement', () => {
  it('Area: two corners, zoom (a new handler), the third corner and a close make one polygon', () => {
    const factory = vertexHandlerFactory('area', 'measureArea');
    const before = context(1);
    const h1 = factory.create(before);
    click(h1, 100, 100);
    click(h1, 300, 100);
    // Zoom: the plugin makes a new handler for the page. It shows the preview again.
    const after = context(2);
    const h2 = factory.create(after);
    expect(after.onPreview).toHaveBeenCalled();
    expect(after.onPreview.mock.calls.at(-1)?.[0]).not.toBeNull();
    click(h2, 300, 300);
    // A click on the first corner (inside its handle at the new zoom) closes it.
    click(h2, 101, 101);
    expect(after.onCommit).toHaveBeenCalledTimes(1);
    const a = after.onCommit.mock.calls[0]?.[0] as PdfAnnotationObject & {
      vertices: { x: number; y: number }[];
    };
    expect(a.vertices).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    expect(before.onCommit).not.toHaveBeenCalled();
    expect(currentGesture()).toBeNull();
    expect(measureStore.getState().live).toBeNull();
  });

  it('Perimeter: Enter after a zoom places all the points', () => {
    const factory = vertexHandlerFactory('perimeter', 'measurePerimeter');
    const h1 = factory.create(context(1));
    click(h1, 10, 10);
    click(h1, 110, 10);
    const after = context(0.5);
    const h2 = factory.create(after);
    click(h2, 110, 110);
    expect(finishDrawing()).toBe(true);
    const a = after.onCommit.mock.calls[0]?.[0] as { vertices: unknown[] };
    // A Perimeter closes (ADR-035 Amendment 1): its first point again at the end.
    expect(a.vertices).toEqual([
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 110 },
      { x: 10, y: 10 },
    ]);
  });

  it('Distance: first point, zoom, second point, scroll away and back, offset click', () => {
    const h1 = dimensionHandlerFactory.create(context(1));
    click(h1, 100, 300);
    const h2 = dimensionHandlerFactory.create(context(1.5));
    click(h2, 300, 300);
    // The page was laid out again (scrolled out of view and back).
    const back = context(1.5);
    const h3 = dimensionHandlerFactory.create(back);
    click(h3, 200, 340);
    expect(back.onCommit).toHaveBeenCalledTimes(1);
    const a = back.onCommit.mock.calls[0]?.[0] as {
      linePoints: unknown;
      leader?: { ll: number };
    };
    expect(a.linePoints).toEqual({ start: { x: 100, y: 300 }, end: { x: 300, y: 300 } });
    expect(a.leader?.ll).toBeCloseTo(40);
  });
});

describe('only Esc, another tool or a page change ends it', () => {
  it('Esc drops it and takes the preview away', () => {
    const ctx = context(1);
    const h = vertexHandlerFactory('area', 'measureArea').create(ctx);
    click(h, 10, 10);
    click(h, 50, 10);
    expect(cancelDrawing()).toBe(true);
    expect(ctx.onPreview.mock.calls.at(-1)?.[0]).toBeNull();
    expect(currentGesture()).toBeNull();
    expect(cancelDrawing()).toBe(false);
  });

  it('a click on another page ends it there and starts a new one', () => {
    const factory = vertexHandlerFactory('perimeter', 'measurePerimeter');
    const p0 = context(1, 0);
    const p1 = context(1, 1);
    const h0 = factory.create(p0);
    const h1 = factory.create(p1);
    click(h0, 10, 10);
    click(h0, 60, 10);
    click(h1, 20, 20);
    expect(p0.onPreview.mock.calls.at(-1)?.[0]).toBeNull();
    expect(p0.onCommit).not.toHaveBeenCalled();
    expect(currentGesture()).toMatchObject({ page: 1, pts: [{ x: 20, y: 20 }] });
  });

  it('a new handler for another page does not pick it up', () => {
    const factory = vertexHandlerFactory('perimeter', 'measurePerimeter');
    const h0 = factory.create(context(1, 0));
    click(h0, 10, 10);
    const other = context(2, 3);
    factory.create(other);
    expect(other.onPreview).not.toHaveBeenCalled();
  });
});

describe('the document a handler is for', () => {
  it('is read from the plugin while it makes the handlers', () => {
    const seen: string[] = [];
    const plugin = {
      registerPageHandlers() {
        // While the plugin makes the handlers, the gesture knows the document.
        const ctx = context(1);
        vertexHandlerFactory('area', 'measureArea').create(ctx).onClick?.({ x: 1, y: 1 }, evt, 'm');
        seen.push(currentGesture()?.doc ?? '');
        return () => undefined;
      },
    };
    const remove = installGestures({ getPlugin: () => plugin } as never);
    (plugin.registerPageHandlers as (id: string) => unknown)('doc-7');
    expect(seen).toEqual(['doc-7']);
    remove();
  });
});
